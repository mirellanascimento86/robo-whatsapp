// ============================================
// CONFIGURAÇÕES
// ============================================
const CONFIG = {
  WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN,
  WHATSAPP_PHONE_ID: process.env.WHATSAPP_PHONE_ID,
  SEU_NUMERO: process.env.SEU_NUMERO
};

// BANCO DE DADOS EM MEMÓRIA (substituir por Supabase depois)
const conversas = {};
const timers = {};

// ============================================
// RESPOSTAS PRONTAS (PROFISSIONAIS)
// ============================================

const RESPOSTAS = {
  // SAUDAÇÃO
  saudacao: (nome) => 
    `Olá${nome ? ' ' + nome : ''}, essa é a Central de Atendimento da Conecta Serviços. Para melhor ajudá-lo(a), me informe qual serviço deseja: conserto de ar condicionado, geladeira, máquina de lavar ou reforma? 🛠️`,
  
  // PRIMEIRA PERGUNTA (AR CONDICIONADO)
  ar_qualificar: () =>
    `Perfeito! Atendemos toda a Zona Sul do Rio. 📍\n\nPara enviar o técnico especializado, preciso saber:\n• Quantos BTUs?\n• Qual marca?\n• Qual bairro?\n• O que está acontecendo (não gela, não liga, vazamento, barulho)?`,
  
  // OUTROS SERVIÇOS (você adiciona depois)
  geladeira_qualificar: () =>
    `Entendido! Para geladeira, preciso saber:\n• Frost free ou convencional?\n• Marca?\n• Bairro?\n• Problema (não gela, barulho, vazamento)?`,
  
  // APRESENTAR VALOR
  ar_valor: (btus, marca, bairro, problema) =>
    `✅ Obrigado pelas informações!\n\n` +
    `Resumo:\n` +
    `• Ar condicionado ${btus || ''} BTUs ${marca || ''}\n` +
    `• Problema: ${problema || 'a diagnosticar'}\n` +
    `• Bairro: ${bairro || 'Zona Sul'}\n\n` +
    `💰 Visita técnica: R$140\n\n` +
    `⚠️ IMPORTANTE:\n` +
    `• Paga no ato da visita (PIX, dinheiro ou cartão)\n` +
    `• Se aprovar o orçamento, R$140 vira crédito no serviço\n` +
    `• Se não aprovar, fica com diagnóstico completo por R$140\n\n` +
    `Podemos agendar? Qual dia e horário? 📅`,
  
  // NEGOCIAÇÃO
  negociacao: () =>
    `Entendo que quer avaliar. 💡 Só lembrando:\n\n` +
    `• Nossos técnicos são especialistas certificados\n` +
    `• Orçamento sem compromisso (só paga se fizer)\n` +
    `• Garantia de 90 dias no serviço\n` +
    `• Vagas para esta semana estão acabando\n\n` +
    `Consigo segurar uma vaga para amanhã ou depois. Topa?`,
  
  // CONFIRMAÇÃO
  confirmacao: (data, hora) =>
    `🎉 *AGENDAMENTO CONFIRMADO!*\n\n` +
    `📅 ${data} às ${hora}\n` +
    `💰 R$140 (visita técnica)\n\n` +
    `O técnico entrará em contato 30 min antes. Obrigado pela confiança! 🛠️`,
  
  // FOLLOW-UP (1 minuto)
  followup1: () =>
    `Ainda está por aí? Preciso confirmar os dados para reservar sua vaga. As vagas para Zona Sul estão acabando esta semana. 🏃‍♂️`,
  
  followup2: () =>
    `Não quero que fique sem atendimento. Posso agendar agora ou prefere que um especialista te ligue? 📞`,
  
  // HUMANO
  humano: () =>
    `Vou transferir para um atendente especialista. Aguarde um momento... ⏳`
};

// ============================================
// FUNÇÃO PRINCIPAL
// ============================================

export default async function handler(req, res) {
  
  // Verificação Facebook
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
      
      // Ignorar eco
      if (telefone === CONFIG.WHATSAPP_PHONE_ID) return res.status(200).send('OK');
      
      // Extrair texto
      let texto = '';
      let tipo = message.type;
      
      if (tipo === 'text') {
        texto = message.text.body;
      } else if (tipo === 'image') {
        texto = '[imagem]';
      } else if (tipo === 'video') {
        texto = '[vídeo]';
      } else if (tipo === 'audio') {
        texto = '[áudio]';
      }
      
      console.log(`${new Date().toLocaleTimeString()} | ${telefone}: ${texto.substring(0, 40)}`);
      
      // Buscar ou criar conversa
      if (!conversas[telefone]) {
        conversas[telefone] = {
          nome: nome,
          etapa: 'inicio',
          dados: {},
          ultima_msg: Date.now()
        };
      }
      
      const chat = conversas[telefone];
      chat.ultima_msg = Date.now();
      
      // Limpar timer anterior
      if (timers[telefone]) clearTimeout(timers[telefone]);
      
      let resposta = '';
      
      // ==========================================
      // LÓGICA DO ATENDIMENTO (PASSO A PASSO)
      // ==========================================
      
      const t = texto.toLowerCase();
      
      // DETECTAR SE PEDIU HUMANO (em qualquer etapa)
      if (t.includes('humano') || t.includes('atendente') || t.includes('pessoa') || t.includes('ligar')) {
        resposta = RESPOSTAS.humano();
        await enviarWhatsApp(telefone, resposta);
        await enviarWhatsApp(CONFIG.SEU_NUMERO, `🚨 ${nome || 'Cliente'} pediu humano: ${telefone}`);
        return res.status(200).send('OK');
      }
      
      // ETAPA 1: INÍCIO
      if (chat.etapa === 'inicio') {
        // Detectar se já disse o serviço
        const servico = detectarServico(t);
        
        if (servico) {
          chat.dados.servico = servico;
          chat.etapa = 'qualificando';
          
          if (servico === 'ar_condicionado') {
            resposta = RESPOSTAS.ar_qualificar();
          } else if (servico === 'geladeira') {
            resposta = RESPOSTAS.geladeira_qualificar();
          } else {
            resposta = `Entendido! Para ${servico}, preciso de mais detalhes. Qual bairro e qual o problema?`;
          }
        } else {
          // Saudação padrão
          resposta = RESPOSTAS.saudacao(nome);
        }
      }
      
      // ETAPA 2: QUALIFICANDO (AR CONDICIONADO)
      else if (chat.etapa === 'qualificando' && chat.dados.servico === 'ar_condicionado') {
        // Extrair dados da mensagem
        const novosDados = extrairDadosAr(texto);
        chat.dados = { ...chat.dados, ...novosDados };
        
        const d = chat.dados;
        
        // Se tem todos os dados obrigatórios
        if (d.btus && d.marca && d.bairro && d.problema) {
          chat.etapa = 'apresentando_valor';
          resposta = RESPOSTAS.ar_valor(d.btus, d.marca, d.bairro, d.problema);
        }
        // Se tem alguns dados, pedir os faltantes
        else {
          const faltando = [];
          if (!d.btus) faltando.push('BTUs');
          if (!d.marca) faltando.push('marca');
          if (!d.bairro) faltando.push('bairro');
          if (!d.problema) faltando.push('o problema');
          
          resposta = `Anotei ${Object.keys(novosDados).join(', ') || 'alguns dados'}. Ainda preciso: ${faltando.join(', ')}.`;
        }
      }
      
      // ETAPA 3: APRESENTANDO VALOR
      else if (chat.etapa === 'apresentando_valor') {
        if (t.includes('sim') || t.includes('ok') || t.includes('pode') || t.includes('agenda')) {
          chat.etapa = 'agendando';
          resposta = `Perfeito! 📅 Qual dia e horário? (ex: "amanhã às 14h" ou "segunda de manhã")`;
        }
        else if (t.includes('caro') || t.includes('desconto') || t.includes('negocia')) {
          resposta = RESPOSTAS.negociacao();
        }
        else {
          resposta = `Sem problema. Posso:\n• Explicar melhor a garantia\n• Ver outro horário\n• Passar para atendente\n\nO que prefere?`;
        }
      }
      
      // ETAPA 4: AGENDANDO
      else if (chat.etapa === 'agendando') {
        const data = detectarData(texto);
        const hora = detectarHora(texto);
        
        if (data && hora) {
          chat.etapa = 'confirmado';
          chat.dados.data = data;
          chat.dados.hora = hora;
          
          resposta = RESPOSTAS.confirmacao(formatarData(data), hora);
          
          // ALERTAR TÉCNICO E VOCÊ
          await alertarSistema(telefone, chat);
        }
        else if (data) {
          resposta = `Data: ${formatarData(data)}. E o horário? (manhã/tarde/noite ou hora específica)`;
        }
        else {
          resposta = `Não entendi. Pode dizer:\n• "Amanhã às 14h"\n• "Segunda de manhã"\n• "25/03 às 15h30"`;
        }
      }
      
      // ETAPA 5: CONFIRMADO
      else if (chat.etapa === 'confirmado') {
        resposta = `Seu agendamento está confirmado! O técnico entrará em contato 30 min antes. Qualquer dúvida, estamos aqui. ✅`;
      }
      
      // Fallback (não deveria acontecer)
      if (!resposta) {
        resposta = `Entendi. Para agilizar, preciso saber: qual serviço, qual bairro na Zona Sul, e qual o problema? 🛠️`;
      }
      
      // Enviar resposta
      await enviarWhatsApp(telefone, resposta);
      console.log(`Resposta: ${resposta.substring(0, 50)}...`);
      
      // Agendar follow-up
      timers[telefone] = setTimeout(() => {
        enviarFollowUp(telefone, chat);
      }, 60000); // 1 minuto
      
      return res.status(200).send('OK');
      
    } catch (erro) {
      console.error('ERRO CRÍTICO:', erro);
      // Mesmo com erro, tenta enviar algo
      try {
        await enviarWhatsApp(message?.from, 'Tivemos um problema técnico. Um atendente vai te ajudar em instantes.');
      } catch(e) {}
      return res.status(200).send('OK');
    }
  }
}

// ============================================
// FUNÇÕES AUXILIARES
// ============================================

function detectarServico(texto) {
  if (texto.includes('ar') || texto.includes('condicionado') || texto.includes('split')) return 'ar_condicionado';
  if (texto.includes('geladeira')) return 'geladeira';
  if (texto.includes('máquina') || texto.includes('lavar')) return 'maquina_lavar';
  if (texto.includes('reforma')) return 'reforma';
  return null;
}

function extrairDadosAr(texto) {
  const t = texto.toLowerCase();
  const dados = {};
  
  // BTUs
  const btusMatch = t.match(/(\d{3,5})\s*(btus?|btu)/);
  if (btusMatch) dados.btus = btusMatch[1];
  
  // Marca
  const marcas = ['samsung', 'lg', 'electrolux', 'consul', 'brastemp', 'panasonic', 'fujitsu', 'gree', 'carrier', 'elgin', 'philco'];
  for (const m of marcas) {
    if (t.includes(m)) dados.marca = m.toUpperCase();
  }
  
  // Bairro Zona Sul RJ
  const bairros = ['copacabana', 'ipanema', 'leblon', 'botafogo', 'flamengo', 'laranjeiras', 'cosme velho', 'jardim botanico', 'jardim botânico', 'gavea', 'gávea', 'sao conrado', 'são conrado', 'vidigal', 'humaita', 'humaitá', 'urca'];
  for (const b of bairros) {
    if (t.includes(b)) dados.bairro = b.charAt(0).toUpperCase() + b.slice(1);
  }
  
  // Problema
  if (t.includes('nao gela') || t.includes('não gela') || t.includes('quente')) dados.problema = 'não gela';
  else if (t.includes('nao liga') || t.includes('não liga') || t.includes('desligado')) dados.problema = 'não liga';
  else if (t.includes('vazamento') || t.includes('pingando') || t.includes('agua')) dados.problema = 'vazamento';
  else if (t.includes('barulho') || t.includes('ruido') || t.includes('estranho')) dados.problema = 'barulho';
  
  return dados;
}

function detectarData(texto) {
  const hoje = new Date();
  const t = texto.toLowerCase();
  
  if (t.includes('hoje')) return hoje.toISOString().split('T')[0];
  
  if (t.includes('amanhã') || t.includes('amanha')) {
    const amanha = new Date(hoje);
    amanha.setDate(amanha.getDate() + 1);
    return amanha.toISOString().split('T')[0];
  }
  
  // Dias da semana
  const dias = {
    'domingo': 0, 'segunda': 1, 'terça': 2, 'terca': 2, 'quarta': 3, 
    'quinta': 4, 'sexta': 5, 'sábado': 6, 'sabado': 6
  };
  
  for (const [dia, num] of Object.entries(dias)) {
    if (t.includes(dia)) {
      const hojeNum = hoje.getDay();
      let add = num - hojeNum;
      if (add <= 0) add += 7;
      const data = new Date(hoje);
      data.setDate(data.getDate() + add);
      return data.toISOString().split('T')[0];
    }
  }
  
  // DD/MM ou DD-MM
  const match = texto.match(/(\d{1,2})[\/\-](\d{1,2})/);
  if (match) {
    const [, dia, mes] = match;
    const ano = hoje.getFullYear();
    return `${ano}-${mes.padStart(2,'0')}-${dia.padStart(2,'0')}`;
  }
  
  return null;
}

function detectarHora(texto) {
  const t = texto.toLowerCase();
  
  if (t.includes('manhã') || t.includes('manha')) return '09:00';
  if (t.includes('tarde')) return '14:00';
  if (t.includes('noite')) return '18:00';
  
  const match = texto.match(/(\d{1,2})[h:](\d{2})?/);
  if (match) {
    return `${match[1].padStart(2,'0')}:${match[2] || '00'}`;
  }
  
  return null;
}

function formatarData(dataISO) {
  const [a, m, d] = dataISO.split('-');
  return `${d}/${m}`;
}

async function enviarFollowUp(telefone, chat) {
  // Só envia se última foi do cliente
  // Simplificado: sempre envia após 1 minuto de silêncio
  
  const jaEnviados = chat.followups || 0;
  
  if (jaEnviados === 0) {
    await enviarWhatsApp(telefone, RESPOSTAS.followup1());
    chat.followups = 1;
  } else if (jaEnviados === 1) {
    await enviarWhatsApp(telefone, RESPOSTAS.followup2());
    chat.followups = 2;
  }
  
  // Para de enviar após 2 follow-ups
}

async function alertarSistema(telefone, chat) {
  const d = chat.dados;
  
  const msg = `🔧 *NOVA OS - ZONA SUL*\n\n` +
    `Cliente: ${chat.nome || 'Não informado'}\n` +
    `Tel: ${telefone}\n` +
    `Serviço: ${d.servico}\n` +
    `BTUs: ${d.btus || '?'}\n` +
    `Marca: ${d.marca || '?'}\n` +
    `Problema: ${d.problema || '?'}\n` +
    `Bairro: ${d.bairro || '?'}\n` +
    `Data: ${formatarData(d.data)} ${d.hora}\n` +
    `Valor: R$140\n\n` +
    `Responda SIM para aceitar.`;
  
  await enviarWhatsApp(CONFIG.SEU_NUMERO, msg);
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
  } catch (e) {
    console.error('Erro enviar:', e);
  }
}

// LISTAR CONVERSAS (para o painel)
app.get('/api/conversas', (req, res) => {
    // Converter objeto de conversas para array
    const lista = Object.entries(conversas).map(([tel, chat]) => ({
        telefone: tel,
        nome: chat.nome,
        etapa: chat.etapa,
        ultima_msg: chat.ultima_msg,
        esperando: Date.now() - chat.ultima_msg > 60000 // 1 minuto sem resposta
    }));
    
    res.json(lista);
});

// PAUSAR/RETOMAR ROBÔ
app.post('/api/pausar', express.json(), (req, res) => {
    const { telefone, pausar } = req.body;
    
    if (pausar) {
        conversas[telefone].pausado = true;
        // Enviar msg ao cliente
        enviarWhatsApp(telefone, 'Você está sendo transferido para um de nossos especialistas. Aguarde...');
    } else {
        conversas[telefone].pausado = false;
    }
    
    res.json({ ok: true });
});

// ENVIAR COMO HUMANO
app.post('/api/enviar', express.json(), async (req, res) => {
    const { telefone, mensagem } = req.body;
    
    await enviarWhatsApp(telefone, mensagem);
    
    // Registrar no histórico
    if (conversas[telefone]) {
        conversas[telefone].historico.push({
            de: 'humano',
            texto: mensagem,
            hora: new Date().toLocaleTimeString()
        });
    }
    
    res.json({ ok: true });
});
// ============================================
// GOOGLE SHEETS - ALIMENTAÇÃO AUTOMÁTICA
// ============================================

const GOOGLE_SHEETS = {
  ID: process.env.GOOGLE_SHEET_ID, // da URL da planilha
  RANGE: 'A1:G1000', // onde escrever
  CLIENT_EMAIL: process.env.GOOGLE_CLIENT_EMAIL,
  PRIVATE_KEY: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
};

async function adicionarNaPlanilha(dados) {
  try {
    // Autenticar com JWT
    const token = await gerarTokenJWT();
    
    // Preparar linha
    const linha = [
      new Date().toLocaleString('pt-BR'), // Data/Hora
      dados.nome || '',
      dados.telefone || '',
      dados.servico || '',
      dados.bairro || '',
      dados.status || 'Novo',
      dados.valor || '',
      dados.data_visita || '',
      dados.hora_visita || '',
      dados.tecnico || ''
    ];
    
    // Enviar para Google Sheets
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS.ID}/values/A1:append?valueInputOption=RAW`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        values: [linha]
      })
    });
    
    console.log('✅ Planilha atualizada');
    
  } catch (erro) {
    console.error('Erro planilha:', erro);
  }
}

async function gerarTokenJWT() {
  // Simplificado - use biblioteca google-auth-library em produção
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: GOOGLE_SHEETS.CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };
  
  // Na prática, usar biblioteca:
  // const { GoogleAuth } = require('google-auth-library');
  // const auth = new GoogleAuth({...});
  
  // Por enquanto, retorna token fixo (implementar JWT completo)
  return 'TOKEN_JWT_AQUI';
}

// CHAMAR quando confirmar agendamento:
// await adicionarNaPlanilha(chat.dados);
