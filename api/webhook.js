// ============================================
// CONFIGURAÇÕES - PREENCHA NO VERCEL
// ============================================
const CONFIG = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_KEY: process.env.SUPABASE_KEY,
  GROQ_KEY: process.env.GROQ_KEY,
  WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN,
  WHATSAPP_PHONE_ID: process.env.WHATSAPP_PHONE_ID,
  SEU_NUMERO: process.env.SEU_NUMERO
};

// ============================================
// MEMÓRIA TEMPORÁRIA (substituir por Supabase depois)
// ============================================
const conversas = {}; // guarda no servidor

// ============================================
// FUNÇÃO PRINCIPAL
// ============================================
export default async function handler(req, res) {
  
  // Verificação do Facebook (GET)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    if (mode === 'subscribe' && token === 'agente123') {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  // Receber mensagem (POST)
  if (req.method === 'POST') {
    try {
      const entry = req.body.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const message = value?.messages?.[0];
      
      if (!message) return res.status(200).send('OK');
      
      const telefone = message.from;
      const nome = value.contacts?.[0]?.profile?.name || 'Cliente';
      
      // Ignorar eco
      if (telefone === CONFIG.WHATSAPP_PHONE_ID) return res.status(200).send('OK');
      
      // Pegar texto da mensagem
      let texto = '';
      if (message.type === 'text') {
        texto = message.text.body;
      } else if (message.type === 'audio') {
        texto = '[áudio - não processado]';
      } else if (message.type === 'image') {
        texto = '[imagem - não processada]';
      } else {
        texto = `[${message.type}]`;
      }
      
      console.log(`[${new Date().toLocaleTimeString()}] ${nome}: ${texto.substring(0, 50)}`);
      
      // ============================================
      // LÓGICA DO ATENDIMENTO (SEM IA POR ENQUANTO)
      // ============================================
      
      // Buscar ou criar conversa
      if (!conversas[telefone]) {
        conversas[telefone] = {
          nome: nome,
          etapa: 'inicio',
          servico: null,
          bairro: null,
          data: null,
          hora: null,
          especificacoes: {}
        };
      }
      
      const chat = conversas[telefone];
      let resposta = '';
      
      // ETAPA 1: INÍCIO - Identificar serviço
      if (chat.etapa === 'inicio') {
        const servico = detectarServico(texto);
        
        if (servico) {
          chat.servico = servico;
          chat.etapa = 'perguntar_bairro';
          
          resposta = `Olá ${nome}! 😊\n\nVi que precisa de ${formatarServico(servico)}. Sou Carlos, consultor técnico.\n\nPara agendar com o técnico certo, me diga:\n📍 Qual bairro?`;
        } else {
          resposta = `Olá ${nome}! Sou Carlos da Conecta Serviços. 🛠️\n\nPosso agendar para você:\n• Ar condicionado\n• Geladeira  \n• Máquina de lavar\n• Reforma\n\nQual serviço precisa?`;
        }
      }
      
      // ETAPA 2: PERGUNTAR BAIRRO
      else if (chat.etapa === 'perguntar_bairro') {
        const bairro = extrairBairro(texto);
        
        if (bairro && bairro.length > 2) {
          chat.bairro = bairro;
          chat.etapa = 'perguntar_especificacoes';
          
          // Pergunta específica conforme serviço
          if (chat.servico === 'ar_condicionado') {
            resposta = `Perfeito! ${bairro} anotado. 📍\n\nAgora me diga:\n❄️ Quantos BTUs? (ex: 9000, 12000, 18000)\n🏠 Quantos ambientes?`;
          } 
          else if (chat.servico === 'reforma') {
            resposta = `Ótimo! ${bairro} anotado. 📍\n\nPara orçamento preciso:\n📐 Metragem da área? (ex: 40m²)\n🚪 Quantos cômodos?\n⚡ É reforma simples ou completa?`;
          }
          else if (chat.servico === 'geladeira') {
            resposta = `${bairro} anotado. 📍\n\nQual tipo?\n• Frost free\n• Duplex/Side by side\n• Convencional\n\nE qual marca?`;
          }
          else {
            resposta = `${bairro} anotado. 📍\n\nQual a capacidade da máquina? (kg)\nE qual marca?`;
          }
        } else {
          resposta = `Não entendi o bairro. Pode digitar só o nome? Ex: "Moema" ou "Centro"`;
        }
      }
      
      // ETAPA 3: PERGUNTAR ESPECIFICAÇÕES
      else if (chat.etapa === 'perguntar_especificacoes') {
        // Salvar o que o cliente disse
        chat.especificacoes.resposta_cliente = texto;
        
        // Tentar extrair números
        const numeros = texto.match(/\d+/g);
        if (numeros) {
          if (chat.servico === 'ar_condicionado' && numeros[0]) {
            chat.especificacoes.btus = numeros[0];
          }
          if (chat.servico === 'reforma' && numeros[0]) {
            chat.especificacoes.metragem = numeros[0];
          }
        }
        
        chat.etapa = 'perguntar_data';
        resposta = `Entendi! Anotado: "${texto.substring(0, 30)}..."\n\nAgora a data:\n📅 Quando prefere? (pode dizer "amanhã", "segunda" ou "25/03")`;
      }
      
      // ETAPA 4: PERGUNTAR DATA
      else if (chat.etapa === 'perguntar_data') {
        const data = detectarData(texto);
        
        if (data) {
          chat.data = data;
          chat.etapa = 'perguntar_hora';
          resposta = `Data: ${formatarData(data)}. 📅\n\nHorário:\n🕐 "Manhã" (9h), "Tarde" (14h) ou digite horário (15h30)?`;
        } else {
          resposta = `Não entendi. Pode dizer:\n• "Amanhã"\n• "Segunda-feira"  \n• "25/03"`;
        }
      }
      
      // ETAPA 5: PERGUNTAR HORA
      else if (chat.etapa === 'perguntar_hora') {
        const hora = detectarHora(texto);
        
        if (hora) {
          chat.hora = hora;
          chat.etapa = 'apresentar_valor';
          
          // Calcular valor
          const valor = calcularValor(chat);
          
          resposta = `✅ Quase lá!\n\n` +
                     `Resumo:\n` +
                     `• ${formatarServico(chat.servico)}\n` +
                     `• ${chat.bairro}\n` +
                     `• ${formatarData(chat.data)} às ${hora}\n` +
                     `• Especificações: ${JSON.stringify(chat.especificacoes).substring(0, 50)}\n\n` +
                     `💰 Valor da visita técnica: R$${valor}\n\n` +
                     `Inclui: diagnóstico completo + orçamento detalhado. Se aprovar o serviço, a visita entra como crédito.\n\n` +
                     `Podemos confirmar?`;
        } else {
          resposta = `Pode dizer:\n• "Manhã"\n• "Tarde"\n• "14h30"`;
        }
      }
      
      // ETAPA 6: CONFIRMAR OU NEGOCIAR
      else if (chat.etapa === 'apresentar_valor') {
        const t = texto.toLowerCase();
        
        if (t.includes('sim') || t.includes('ok') || t.includes('pode') || t.includes('confirmo')) {
          chat.etapa = 'agendado';
          
          // ALERTA TÉCNICO E VOCÊ
          const msgTecnico = `🔧 NOVA OS\nCliente: ${chat.nome}\nTel: ${telefone}\nServiço: ${chat.servico}\nLocal: ${chat.bairro}\nData: ${chat.data} ${chat.hora}\nEspec: ${JSON.stringify(chat.especificacoes)}\nValor: R$${calcularValor(chat)}\n\nResponda SIM para aceitar.`;
          
          await enviarWhatsApp(CONFIG.SEU_NUMERO, msgTecnico);
          
          resposta = `🎉 *AGENDAMENTO CONFIRMADO!*\n\n` +
                     `📅 ${formatarData(chat.data)} às ${chat.hora}\n` +
                     `📍 ${chat.bairro}\n` +
                     `💰 R$${calcularValor(chat)}\n\n` +
                     `Nosso técnico entrará em contato 30 min antes. Obrigado pela confiança! 🛠️`;
        }
        else if (t.includes('caro') || t.includes('desconto') || t.includes('negocia') || t.includes('menos')) {
          const valorOriginal = calcularValor(chat);
          const valorNegociado = Math.floor(valorOriginal * 0.9); // 10% desconto
          
          resposta = `Entendo que precisa avaliar. 💡\n\n` +
                     `Consigo ajustar para R$${valorNegociado} se confirmarmos hoje para amanhã ou esta semana. É uma vaga que abriu na agenda.\n\n` +
                     `Topa?`;
        }
        else {
          resposta = `Sem problema! Posso:\n• Explicar o que inclui a visita\n• Ver outro horário (pode ser mais barato)\n• Passar para atendente humano\n\nO que prefere?`;
        }
      }
      
      // ETAPA 7: JÁ AGENDADO
      else if (chat.etapa === 'agendado') {
        resposta = `Seu agendamento está confirmado! ✅\n\nSe precisar remarcar ou cancelar, é só avisar.`;
      }
      
      // Se pediu humano em qualquer etapa
      if (texto.toLowerCase().includes('humano') || texto.toLowerCase().includes('atendente') || texto.toLowerCase().includes('pessoa')) {
        resposta = 'Vou chamar um atendente. Aguarde... ⏳';
        await enviarWhatsApp(CONFIG.SEU_NUMERO, `🚨 ${nome} pediu humano: ${telefone}`);
      }
      
      // Enviar resposta
      await enviarWhatsApp(telefone, resposta);
      
      // Log
      console.log(`Resposta: ${resposta.substring(0, 50)}...`);
      
      return res.status(200).send('OK');
      
    } catch (erro) {
      console.error('Erro:', erro);
      return res.status(500).send('Erro');
    }
  }
}

// ============================================
// FUNÇÕES AUXILIARES
// ============================================

function detectarServico(texto) {
  const t = texto.toLowerCase();
  if (t.includes('geladeira')) return 'geladeira';
  if (t.includes('ar') || t.includes('condicionado') || t.includes('split')) return 'ar_condicionado';
  if (t.includes('máquina') || t.includes('maquina') || t.includes('lavar')) return 'maquina_lavar';
  if (t.includes('reforma') || t.includes('pintura') || t.includes('azulejo')) return 'reforma';
  return null;
}

function formatarServico(s) {
  const map = {
    'geladeira': 'conserto de geladeira',
    'ar_condicionado': 'ar condicionado',
    'maquina_lavar': 'máquina de lavar',
    'reforma': 'reforma residencial'
  };
  return map[s] || s;
}

function extrairBairro(texto) {
  // Remove palavras comuns
  let limpo = texto
    .toLowerCase()
    .replace(/bairro|rua|av|avenida|travessa|moro|fica|em|no|na|no\s|na\s/g, '')
    .replace(/[^\w\s]/g, '')
    .trim();
  
  // Capitaliza primeira letra
  return limpo.charAt(0).toUpperCase() + limpo.slice(1);
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
  const dias = ['domingo','segunda','terça','terca','quarta','quinta','sexta','sábado','sabado'];
  for (let i = 0; i < dias.length; i++) {
    if (t.includes(dias[i])) {
      const hojeNum = hoje.getDay();
      let diasAdd = i - hojeNum;
      if (diasAdd <= 0) diasAdd += 7;
      const data = new Date(hoje);
      data.setDate(data.getDate() + diasAdd);
      return data.toISOString().split('T')[0];
    }
  }
  
  // Formato DD/MM ou DD-MM
  const match = texto.match(/(\d{1,2})[\/\-](\d{1,2})/);
  if (match) {
    const [_, dia, mes] = match;
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
  if (!dataISO) return '';
  const [a, m, d] = dataISO.split('-');
  return `${d}/${m}`;
}

function calcularValor(chat) {
  const base = {
    'geladeira': 80,
    'ar_condicionado': 120,
    'maquina_lavar': 80,
    'reforma': 150
  };
  
  let valor = base[chat.servico] || 100;
  
  // Ajustes por especificações
  if (chat.servico === 'ar_condicionado' && chat.especificacoes.btus) {
    if (parseInt(chat.especificacoes.btus) > 12000) valor += 50;
  }
  
  if (chat.servico === 'reforma' && chat.especificacoes.metragem) {
    const m2 = parseInt(chat.especificacoes.metragem);
    if (m2 > 50) valor += (m2 - 50) * 2;
  }
  
  return valor;
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
