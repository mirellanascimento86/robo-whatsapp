// ============================================
// CONFIGURAÇÕES
// ============================================
const CONFIG = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_KEY: process.env.SUPABASE_KEY,
  GROQ_KEY: process.env.GROQ_KEY,
  WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN,
  WHATSAPP_PHONE_ID: process.env.WHATSAPP_PHONE_ID,
  SEU_NUMERO: process.env.SEU_NUMERO
};

// MEMÓRIA DAS CONVERSAS
const conversas = {};
const timers = {}; // para follow-up

// ============================================
// PROMPT DA CENTRAL DE ATENDIMENTO
// ============================================

const PROMPT_SISTEMA = `Você é a Central de Atendimento da Conecta Serviços, empresa de consertos residenciais no Rio de Janeiro.

ESTILO DE COMUNICAÇÃO:
- Profissional, direto, consultivo
- NUNCA diga seu nome (você é uma central, não uma pessoa)
- NUNCA use "eu sou Carlos" ou identificação pessoal
- Sempre "nós", "nossa equipe", "o técnico"
- Tom de venda: criar urgência, valor, confiança

REGRAS DE PREÇO (ZONA SUL RJ):
- Ar condicionado: R$140 (visita técnica)
- Outros serviços: a definir

ESTRUTURA OBRIGATÓRIA:
1. SAUDAÇÃO: adaptada ao que cliente disse
2. QUALIFICAÇÃO: BTUs, marca, problema, bairro (para ar)
3. CONDIÇÃO DE PAGAMENTO: "Visita R$140, paga no ato. Se aprovar orçamento, vira crédito no serviço"
4. FECHAMENTO: data/hora ou encaminhar técnico

SE CLIENTE MANDAR FOTO/VÍDEO:
- Agradeça
- Peça para descrever o problema (foto ajuda mas não substitui diagnóstico)
- Continue qualificação

SE CLIENTE NÃO RESPONDER EM 1 MINUTO:
- Envie follow-up criando urgência

OBJEÇÕES COMUNS:
- "Caro": "Entendo. Só lembrando que inclui diagnóstico completo. Se aprovar, vira crédito."
- "Quero orçamento antes": "O técnico precisa avaliar no local para orçamento preciso. Por isso a visita."
- "Vou pensar": "Claro. Só aviso que vagas para esta semana estão acabando."`;

// ============================================
// FUNÇÃO PRINCIPAL
// ============================================

export default async function handler(req, res) {
  
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    if (mode === 'subscribe' && token === 'agente123') {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  if (req.method === 'POST') {
    try {
      const entry = req.body.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const message = value?.messages?.[0];
      
      if (!message) return res.status(200).send('OK');
      
      const telefone = message.from;
      const nome = value.contacts?.[0]?.profile?.name || '';
      
      if (telefone === CONFIG.WHATSAPP_PHONE_ID) return res.status(200).send('OK');
      
      // Processar mensagem
      let entrada = {
        tipo: message.type,
        texto: '',
        midia_descricao: ''
      };
      
      if (message.type === 'text') {
        entrada.texto = message.text.body;
      } else if (message.type === 'image') {
        entrada.texto = '[imagem recebida]';
        entrada.midia_descricao = 'Cliente enviou foto do equipamento/problema';
      } else if (message.type === 'video') {
        entrada.texto = '[vídeo recebido]';
        entrada.midia_descricao = 'Cliente enviou vídeo mostrando o problema';
      } else if (message.type === 'audio') {
        entrada.texto = '[áudio recebido]';
        entrada.midia_descricao = 'Cliente enviou áudio descrevendo';
      }
      
      // Buscar ou criar conversa
      if (!conversas[telefone]) {
        conversas[telefone] = {
          nome: nome,
          etapa: 'inicio',
          historico: [],
          dados: {},
          ultima_msg: Date.now()
        };
      }
      
      const chat = conversas[telefone];
      chat.ultima_msg = Date.now();
      
      // Adicionar ao histórico
      chat.historico.push({
        role: 'user',
        content: entrada.texto,
        timestamp: new Date().toISOString()
      });
      
      // Montar contexto para IA
      const contexto = montarContexto(chat, nome, entrada);
      
      // Chamar IA Groq
      const respostaIA = await chamarGroq(contexto);
      
      // Adicionar resposta ao histórico
      chat.historico.push({
        role: 'assistant',
        content: respostaIA,
        timestamp: new Date().toISOString()
      });
      
      // Extrair dados da resposta
      const dadosExtraidos = extrairDados(entrada.texto, respostaIA);
      chat.dados = { ...chat.dados, ...dadosExtraidos };
      
      // Atualizar etapa
      chat.etapa = determinarEtapa(chat.etapa, chat.dados);
      
      // Enviar resposta
      await enviarWhatsApp(telefone, respostaIA);
      
      // Agendar follow-up em 1 minuto
      if (timers[telefone]) clearTimeout(timers[telefone]);
      timers[telefone] = setTimeout(() => {
        enviarFollowUp(telefone, chat);
      }, 60000); // 1 minuto
      
      // Se tem todos os dados, alertar técnico
      if (chat.etapa === 'pronto_enviar' && !chat.tecnico_alertado) {
        await alertarTecnico(telefone, chat);
        chat.tecnico_alertado = true;
      }
      
      return res.status(200).send('OK');
      
    } catch (erro) {
      console.error('Erro:', erro);
      return res.status(500).send('Erro');
    }
  }
}

// ============================================
// FUNÇÕES DE CONTEXTO E IA
// ============================================

function montarContexto(chat, nome, entrada) {
  let contexto = '';
  
  // Saudação adaptada
  if (chat.etapa === 'inicio' && chat.historico.length === 0) {
    contexto += `PRIMEIRA MENSAGEM DO CLIENTE: "${entrada.texto}"\n\n`;
    contexto += `INSTRUÇÃO: Se cliente disse apenas "oi", "olá", etc, responda EXATAMENTE:\n`;
    contexto += `"Olá, essa é a Central de Atendimento. Para melhor ajudá-lo(a), me informe qual serviço deseja?"\n\n`;
    contexto += `Se cliente já disse o serviço (ar, geladeira, etc), pule saudação e vá direto para qualificação.\n\n`;
  }
  
  contexto += `HISTÓRICO DA CONVERSA:\n`;
  chat.historico.slice(-6).forEach((msg, i) => {
    contexto += `${msg.role === 'user' ? 'Cliente' : 'Central'}: ${msg.content}\n`;
  });
  
  contexto += `\nDADOS JÁ COLETADOS: ${JSON.stringify(chat.dados)}\n`;
  contexto += `ETAPA ATUAL: ${chat.etapa}\n`;
  
  if (entrada.midia_descricao) {
    contexto += `\nMÍDIA RECEBIDA: ${entrada.midia_descricao}\n`;
  }
  
  contexto += `\nINSTRUÇÃO FINAL: Responda como Central de Atendimento. Não se identifique. Seja vendedor.`;
  
  return contexto;
}

async function chamarGroq(contexto) {
  try {
    const resposta = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CONFIG.GROQ_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama3-70b-8192',
        messages: [
          { role: 'system', content: PROMPT_SISTEMA },
          { role: 'user', content: contexto }
        ],
        temperature: 0.8,
        max_tokens: 400
      })
    });
    
    const dados = await resposta.json();
    return dados.choices?.[0]?.message?.content || 'Desculpe, tivemos um problema. Um atendente vai te ajudar.';
    
  } catch (erro) {
    console.error('Erro Groq:', erro);
    return 'Desculpe, estamos com instabilidade. Pode repetir?';
  }
}

// ============================================
// FUNÇÕES DE PROCESSAMENTO
// ============================================

function extrairDados(textoCliente, respostaIA) {
  const t = textoCliente.toLowerCase();
  const dados = {};
  
  // Detectar serviço
  if (t.includes('ar') || t.includes('condicionado') || t.includes('split')) {
    dados.servico = 'ar_condicionado';
    dados.valor_visita = 140;
  } else if (t.includes('geladeira')) {
    dados.servico = 'geladeira';
  } else if (t.includes('máquina') || t.includes('lavar')) {
    dados.servico = 'maquina_lavar';
  } else if (t.includes('reforma')) {
    dados.servico = 'reforma';
  }
  
  // Extrair BTUs
  const btusMatch = t.match(/(\d+)\s*(btus?|btu)/);
  if (btusMatch) dados.btus = btusMatch[1];
  
  // Extrair marca
  const marcas = ['samsung', 'lg', 'electrolux', 'consul', 'brastemp', 'panasonic', 'fujitsu', 'gree', 'carrier'];
  for (const marca of marcas) {
    if (t.includes(marca)) dados.marca = marca;
  }
  
  // Extrair bairro (Zona Sul RJ)
  const bairrosZS = ['copacabana', 'ipanema', 'leblon', 'botafogo', 'flamengo', 'laranjeiras', 'cosme velho', 'jardim botânico', 'gávea', 'são conrado', 'vidigal', 'rocinha', 'humaitá', 'urca'];
  for (const bairro of bairrosZS) {
    if (t.includes(bairro)) dados.bairro = bairro;
  }
  
  // Extrair problema
  if (t.includes('não liga') || t.includes('nao liga')) dados.problema = 'nao_liga';
  if (t.includes('não gela') || t.includes('nao gela')) dados.problema = 'nao_gela';
  if (t.includes('vazamento') || t.includes('pingando')) dados.problema = 'vazamento';
  if (t.includes('barulho') || t.includes('ruido')) dados.problema = 'barulho';
  
  return dados;
}

function determinarEtapa(etapaAtual, dados) {
  if (etapaAtual === 'inicio' && dados.servico) return 'qualificando';
  if (etapaAtual === 'qualificando' && dados.servico === 'ar_condicionado') {
    if (dados.btus && dados.marca && dados.bairro && dados.problema) return 'apresentando_valor';
  }
  if (etapaAtual === 'apresentando_valor') return 'negociando';
  if (etapaAtual === 'negociando') return 'pronto_enviar';
  return etapaAtual;
}

async function enviarFollowUp(telefone, chat) {
  // Só envia se última mensagem foi do cliente (esperando resposta)
  const ultima = chat.historico[chat.historico.length - 1];
  if (ultima?.role !== 'user') return;
  
  const followUps = [
    'Ainda está por aí? Preciso confirmar alguns detalhes para garantir a vaga esta semana. 🛠️',
    'Só lembrando: as vagas para Zona Sul estão acabando. Consegue me responder rapidinho?',
    'Não quero que fique sem atendimento. Posso agendar agora ou prefere outro dia?'
  ];
  
  const msg = followUps[Math.min(chat.historico.filter(m => m.role === 'assistant').length, 2)];
  
  await enviarWhatsApp(telefone, msg);
  
  chat.historico.push({
    role: 'assistant',
    content: msg,
    timestamp: new Date().toISOString(),
    tipo: 'follow_up'
  });
}

async function alertarTecnico(telefone, chat) {
  const d = chat.dados;
  
  const msgTecnico = `🔧 *NOVA OPORTUNIDADE - ZONA SUL*\n\n` +
    `Cliente: ${chat.nome || 'Não informado'}\n` +
    `Tel: ${telefone}\n` +
    `Serviço: ${d.servico}\n` +
    `BTUs: ${d.btus || '?'}\n` +
    `Marca: ${d.marca || '?'}\n` +
    `Problema: ${d.problema || '?'}\n` +
    `Bairro: ${d.bairro || '?'}\n` +
    `Valor visita: R$${d.valor_visita || 140}\n\n` +
    `Responda SIM para aceitar ou NÃO para recusar.`;
  
  // Envia para você (substituir por lista de técnicos depois)
  await enviarWhatsApp(CONFIG.SEU_NUMERO, msgTecnico);
}

async function enviarWhatsApp(telefone, mensagem) {
  try {
    await fetch(`https://graph.facebook.com/v18.0/${CONFIG.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CONFIG.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: telefone,
        type: 'text',
        text: { body: mensagem }
      })
    });
    console.log(`Enviado para ${telefone}: ${mensagem.substring(0, 50)}...`);
  } catch (e) {
    console.error('Erro enviar:', e);
  }
}
