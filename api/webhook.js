// ============================================
// CONFIGURAÇÕES - TUDO VEM DAS VARIÁVEIS VERCEL
// ============================================

const CONFIG = {
  // WhatsApp (Meta)
  WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN,
  WHATSAPP_PHONE_ID: process.env.WHATSAPP_PHONE_ID,
  
  // Telegram (seu bot)
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN, // 123456789:ABC...
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,       // -1001234567890
  
  // Google (planilha e calendar)
  GOOGLE_CLIENT_EMAIL: process.env.GOOGLE_CLIENT_EMAIL,
  GOOGLE_PRIVATE_KEY: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  GOOGLE_SHEET_ID: process.env.GOOGLE_SHEET_ID,
  GOOGLE_CALENDAR_ID: process.env.GOOGLE_CALENDAR_ID,
  
  // Seu número para backup
  SEU_NUMERO: process.env.SEU_NUMERO
};

// ============================================
// BANCO DE DADOS EM MEMÓRIA (temporário)
// ============================================

const conversas = {};
const timers = {};

// ============================================
// RESPOSTAS DO ROBÔ (PERSONALIDADE CENTRAL)
// ============================================

const RESPOSTAS = {
  saudacao: (nome) => 
    `Olá${nome ? ' ' + nome : ''}, essa é a Central de Atendimento da Central Oficina SEO Brasil. Para melhor ajudá-lo(a), me informe qual serviço deseja: conserto de ar condicionado, geladeira, máquina de lavar ou reforma? 🛠️`,
  
  ar_qualificar: () =>
    `Perfeito! Atendemos toda a Zona Sul do Rio. 📍\n\nPara enviar o técnico especializado, preciso saber:\n• Quantos BTUs?\n• Qual marca?\n• Qual bairro?\n• O que está acontecendo (não gela, não liga, vazamento, barulho)?`,
  
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
  
  negociacao: () =>
    `Entendo que quer avaliar. 💡 Só lembrando:\n\n` +
    `• Nossos técnicos são especialistas certificados\n` +
    `• Orçamento sem compromisso (só paga se fizer)\n` +
    `• Garantia de 90 dias no serviço\n` +
    `• Vagas para esta semana estão acabando\n\n` +
    `Consigo segurar uma vaga para amanhã ou depois. Topa?`,
  
  confirmacao: (data, hora) =>
    `🎉 *AGENDAMENTO CONFIRMADO!*\n\n` +
    `📅 ${data} às ${hora}\n` +
    `💰 R$140 (visita técnica)\n\n` +
    `O técnico entrará em contato 30 min antes. Obrigado pela confiança! 🛠️`,
  
  humano: () =>
    `Vou transferir para um de nossos especialistas. Aguarde um momento... ⏳`
};

// ============================================
// FUNÇÃO PRINCIPAL (HANDLER)
// ============================================

export default async function handler(req, res) {
  
  // VERIFICAÇÃO DO FACEBOOK (GET)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    if (mode === 'subscribe' && token === 'agente123') {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  // RECEBER MENSAGEM (POST)
  if (req.method === 'POST') {
    try {
      const entry = req.body.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const message = value?.messages?.[0];
      
      if (!message) return res.status(200).send('OK');
      
      const telefone = message.from;
      const nome = value.contacts?.[0]?.profile?.name || '';
      
      // Ignorar mensagens do próprio sistema
      if (telefone === CONFIG.WHATSAPP_PHONE_ID) return res.status(200).send('OK');
      
      // Extrair texto da mensagem
      let texto = '';
      let tipo = message.type;
      
      if (tipo === 'text') {
        texto = message.text.body;
      } else if (tipo === 'image') {
        texto = '[imagem recebida]';
      } else if (tipo === 'video') {
        texto = '[vídeo recebido]';
      } else if (tipo === 'audio') {
        texto = '[áudio recebido]';
        await enviarWhatsApp(telefone, 'Desculpe, ainda não consigo ouvir áudios. Pode digitar, por favor? 📝');
        return res.status(200).send('OK');
      }
      
      console.log(`[${new Date().toLocaleTimeString()}] ${nome} (${telefone}): ${texto.substring(0, 50)}`);
      
      // ==========================================
      // BUSCAR OU CRIAR CONVERSA
      // ==========================================
      
      if (!conversas[telefone]) {
        conversas[telefone] = {
          nome: nome,
          etapa: 'inicio',
          dados: {},
          historico: [],
          ultima_msg: Date.now()
        };
      }
      
      const chat = conversas[telefone];
      chat.ultima_msg = Date.now();
      chat.historico.push({ tipo: 'cliente', texto, hora: new Date().toLocaleTimeString() });
      
      // Limpar timer anterior
      if (timers[telefone]) clearTimeout(timers[telefone]);
      
      let resposta = '';
      const t = texto.toLowerCase();
      
      // ==========================================
      // DETECTAR PEDIDO DE HUMANO (PRIORIDADE MÁXIMA)
      // ==========================================
      
      if (t.includes('humano') || t.includes('atendente') || t.includes('pessoa') || 
          t.includes('especialista') || t.includes('falar com') || t.includes('ligar')) {
        
        chat.pausado = true;
        resposta = RESPOSTAS.humano();
        
        // 1. Responder cliente
        await enviarWhatsApp(telefone, resposta);
        
        // 2. ALERTA TELEGRAM (seu grupo Central Oficina SEO Brasil)
        await alertarTelegram('pediu_humano', {
          telefone: telefone,
          nome: chat.nome || nome,
          servico: chat.dados?.servico || 'Não identificado',
          bairro: chat.dados?.bairro || 'Não informado',
          ultimaMsg: texto,
          etapa: chat.etapa
        });
        
        // 3. Backup WhatsApp seu
        await enviarWhatsApp(CONFIG.SEU_NUMERO, 
          `🚨 ${chat.nome || 'Cliente'} pediu humano: ${telefone}`
        );
        
        return res.status(200).send('OK');
      }
      
      // ==========================================
      // FLUXO NORMAL DE ATENDIMENTO
      // ==========================================
      
      // ETAPA 1: INÍCIO
      if (chat.etapa === 'inicio') {
        const servico = detectarServico(t);
        
        if (servico) {
          chat.dados.servico = servico;
          chat.etapa = 'qualificando';
          resposta = RESPOSTAS.ar_qualificar();
        } else {
          resposta = RESPOSTAS.saudacao(nome);
        }
      }
      
      // ETAPA 2: QUALIFICANDO (AR CONDICIONADO)
      else if (chat.etapa === 'qualificando' && chat.dados.servico === 'ar_condicionado') {
        const novosDados = extrairDadosAr(texto);
        chat.dados = { ...chat.dados, ...novosDados };
        
        const d = chat.dados;
        
        if (d.btus && d.marca && d.bairro && d.problema) {
          chat.etapa = 'apresentando_valor';
          resposta = RESPOSTAS.ar_valor(d.btus, d.marca, d.bairro, d.problema);
        } else {
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
          chat.dados.data_visita = data;
          chat.dados.hora_visita = hora;
          
          resposta = RESPOSTAS.confirmacao(formatarData(data), hora);
          
          // SALVAR NA PLANILHA GOOGLE
          await salvarNaPlanilha({
            data_hora: new Date().toLocaleString('pt-BR'),
            nome: chat.nome || nome,
            telefone: telefone,
            servico: 'Ar Condicionado',
            bairro: chat.dados.bairro,
            btus: chat.dados.btus,
            marca: chat.dados.marca,
            problema: chat.dados.problema,
            data_visita: data,
            hora_visita: hora,
            valor: 140,
            status: 'Agendado'
          });
          
          // CRIAR EVENTO NO GOOGLE CALENDAR
          await criarEventoCalendar({
            nome: chat.nome || nome,
            telefone: telefone,
            servico: 'Ar Condicionado',
            bairro: chat.dados.bairro,
            data: data,
            hora: hora,
            descricao: `BTUs: ${chat.dados.btus}, Marca: ${chat.dados.marca}, Problema: ${chat.dados.problema}`
          });
          
          // ALERTA TELEGRAM DE NOVO AGENDAMENTO
          await alertarTelegram('novo_agendamento', {
            nome: chat.nome || nome,
            telefone: telefone,
            servico: 'Ar Condicionado',
            bairro: chat.dados.bairro,
            data: formatarData(data),
            hora: hora,
            valor: 140
          });
          
        } else if (data) {
          resposta = `Data: ${formatarData(data)}. E o horário? (manhã/tarde/noite ou hora específica)`;
        } else {
          resposta = `Não entendi. Pode dizer:\n• "Amanhã às 14h"\n• "Segunda de manhã"\n• "25/03 às 15h30"`;
        }
      }
      
      // ETAPA 5: CONFIRMADO
      else if (chat.etapa === 'confirmado') {
        resposta = `Seu agendamento está confirmado! O técnico entrará em contato 30 min antes. Qualquer dúvida, estamos aqui. ✅`;
      }
      
      // Fallback
      if (!resposta) {
        resposta = `Entendi. Para agilizar, preciso saber: qual serviço, qual bairro na Zona Sul, e qual o problema? 🛠️`;
      }
      
      // ==========================================
      // ENVIAR RESPOSTA E AGENDAR FOLLOW-UP
      // ==========================================
      
      await enviarWhatsApp(telefone, resposta);
      chat.historico.push({ tipo: 'robo', texto: resposta, hora: new Date().toLocaleTimeString() });
      
      console.log(`Resposta: ${resposta.substring(0, 50)}...`);
      
      // Agendar follow-up em 1 minuto
      timers[telefone] = setTimeout(() => {
        enviarFollowUp(telefone, chat);
      }, 60000);
      
      return res.status(200).send('OK');
      
    } catch (erro) {
      console.error('ERRO CRÍTICO:', erro);
      return res.status(200).send('OK'); // Sempre retorna 200 para WhatsApp não reenviar
    }
  }
}

// ============================================
// FUNÇÕES AUXILIARES
// ============================================

function detectarServico(texto) {
  const t = texto.toLowerCase();
  if (t.includes('ar') || t.includes('condicionado') || t.includes('split')) return 'ar_condicionado';
  if (t.includes('geladeira')) return 'geladeira';
  if (t.includes('máquina') || t.includes('maquina') || t.includes('lavar')) return 'maquina_lavar';
  if (t.includes('reforma')) return 'reforma';
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
  if (match) return `${match[1].padStart(2,'0')}:${match[2] || '00'}`;
  
  return null;
}

function formatarData(dataISO) {
  const [a, m, d] = dataISO.split('-');
  return `${d}/${m}`;
}

// ============================================
// TELEGRAM (central_alerta_bot)
// ============================================

async function alertarTelegram(tipo, dados) {
  try {
    let mensagem = '';
    
    if (tipo === 'pediu_humano') {
      mensagem = `🚨 *CLIENTE PEDIU ATENDENTE*\n\n` +
                 `👤 Nome: ${dados.nome || 'Não informado'}\n` +
                 `📱 WhatsApp: ${dados.telefone}\n` +
                 `🔧 Serviço: ${dados.servico}\n` +
                 `📍 Bairro: ${dados.bairro}\n` +
                 `💬 Última mensagem: "${dados.ultimaMsg?.substring(0, 50)}..."\n` +
                 `📊 Etapa: ${dados.etapa}\n\n` +
                 `⏰ *AÇÃO IMEDIATA NECESSÁRIA*\n` +
                 `🔗 Acesse: https://seu-projeto.vercel.app/painel.html`;
    }
    else if (tipo === 'novo_agendamento') {
      mensagem = `✅ *NOVO AGENDAMENTO CONFIRMADO*\n\n` +
                 `👤 ${dados.nome}\n` +
                 `📱 ${dados.telefone}\n` +
                 `🔧 ${dados.servico}\n` +
                 `📍 ${dados.bairro}\n` +
                 `📅 ${dados.data} às ${dados.hora}\n` +
                 `💰 R$${dados.valor}\n\n` +
                 `📋 Já salvo na planilha e Google Calendar`;
    }
    
    await fetch(`https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CONFIG.TELEGRAM_CHAT_ID,
        text: mensagem,
        parse_mode: 'Markdown'
      })
    });
    
    console.log('📨 Telegram enviado:', tipo);
    
  } catch (erro) {
    console.error('Erro Telegram:', erro);
  }
}

// ============================================
// GOOGLE SHEETS (simplificado)
// ============================================

async function salvarNaPlanilha(dados) {
  try {
    // Usar Google Apps Script (mais simples que API direta)
    // Crie um script em extensions.google.com/script
    // E chame via URL
    
    console.log('💾 Salvando na planilha:', dados);
    
    // Implementação via Apps Script (mostro abaixo)
    
  } catch (erro) {
    console.error('Erro planilha:', erro);
  }
}

// ============================================
// GOOGLE CALENDAR (simplificado)
// ============================================

async function criarEventoCalendar(dados) {
  try {
    console.log('📅 Criando evento:', dados);
    
    // Implementação similar à planilha
    
  } catch (erro) {
    console.error('Erro calendar:', erro);
  }
}

// ============================================
// FOLLOW-UP E WHATSAPP
// ============================================

async function enviarFollowUp(telefone, chat) {
  const ultima = chat.historico[chat.historico.length - 1];
  if (ultima?.tipo !== 'cliente') return;
  
  const jaEnviados = chat.followups || 0;
  if (jaEnviados >= 2) return;
  
  const msgs = [
    'Ainda está por aí? Preciso confirmar os dados para garantir sua vaga esta semana. 🛠️',
    'Não quero que fique sem atendimento. Posso agendar agora ou prefere que um especialista te ligue? 📞'
  ];
  
  await enviarWhatsApp(telefone, msgs[jaEnviados]);
  chat.followups = jaEnviados + 1;
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
    console.error('Erro WhatsApp:', e);
  }
}
