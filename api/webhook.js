// ============================================
// CONFIGURAÇÕES
// ============================================

const CONFIG = {
  WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN,
  WHATSAPP_PHONE_ID: process.env.WHATSAPP_PHONE_ID,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  SEU_NUMERO: process.env.SEU_NUMERO
};

// Banco em memória
const conversas = {};

// ============================================
// HANDLER PRINCIPAL
// ============================================

export default async function handler(req, res) {
  
  // Verificação Facebook (GET)
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
      const nome = value.contacts?.[0]?.profile?.name || '';
      
      // Ignorar eco
      if (telefone === CONFIG.WHATSAPP_PHONE_ID) return res.status(200).send('OK');
      
      // Extrair texto
      let texto = '';
      if (message.type === 'text') {
        texto = message.text.body;
      } else if (message.type === 'image') {
        texto = '[imagem]';
      } else if (message.type === 'audio') {
        texto = '[áudio]';
        await enviarWhatsApp(telefone, 'Não entendo áudio. Pode digitar?');
        return res.status(200).send('OK');
      }
      
      console.log(`📩 ${telefone}: ${texto.substring(0, 30)}`);
      
      // ==========================================
      // DETECTAR "HUMANO" - PRIORIDADE MÁXIMA
      // ==========================================
      
      const t = texto.toLowerCase();
      const pediuHumano = t.includes('humano') || 
                          t.includes('atendente') || 
                          t.includes('pessoa') ||
                          t.includes('especialista') ||
                          t.includes('falar com');
      
      if (pediuHumano) {
        console.log('🚨 DETECTADO: Pedido de humano');
        
        // 1. Responder cliente
        await enviarWhatsApp(telefone, 'Vou transferir para um especialista. Aguarde... ⏳');
        
        // 2. ENVIAR TELEGRAM (com log detalhado)
        console.log('📤 Enviando Telegram...');
        console.log('Token:', CONFIG.TELEGRAM_BOT_TOKEN?.substring(0, 10) + '...');
        console.log('Chat ID:', CONFIG.TELEGRAM_CHAT_ID);
        
        const telegramOk = await enviarTelegram(nome, telefone, texto);
        console.log('Telegram resultado:', telegramOk);
        
        // 3. Backup WhatsApp
        if (CONFIG.SEU_NUMERO) {
          await enviarWhatsApp(CONFIG.SEU_NUMERO, `🚨 ${nome} pediu humano: ${telefone}`);
        }
        
        // 4. Marcar como pausado no banco
        conversas[telefone] = {
          nome: nome,
          pausado: true,
          pediuHumanoEm: new Date().toISOString()
        };
        
        return res.status(200).send('OK');
      }
      
      // ==========================================
      // FLUXO NORMAL (simplificado)
      // ==========================================
      
      if (!conversas[telefone]) {
        conversas[telefone] = { etapa: 'inicio' };
      }
      
      const chat = conversas[telefone];
      let resposta = '';
      
      if (chat.etapa === 'inicio') {
        const servico = detectarServico(t);
        if (servico) {
          chat.servico = servico;
          chat.etapa = 'qualificando';
          resposta = 'Perfeito! Para agendar, preciso: BTUs, marca, bairro e problema.';
        } else {
          resposta = 'Olá, essa é a Central de Atendimento. Qual serviço: ar, geladeira, máquina ou reforma?';
        }
      }
      else if (chat.etapa === 'qualificando') {
        const dados = extrairDados(t);
        chat.dados = { ...chat.dados, ...dados };
        
        if (chat.dados.btus && chat.dados.bairro) {
          chat.etapa = 'proposta';
          resposta = `✅ Resumo: ${chat.dados.btus} BTUs, ${chat.dados.bairro}. Visita: R$140. Podemos agendar?`;
        } else {
          resposta = 'Ainda preciso: ' + 
            (!chat.dados.btus ? 'BTUs, ' : '') +
            (!chat.dados.bairro ? 'bairro, ' : '') +
            'para confirmar.';
        }
      }
      else if (chat.etapa === 'proposta') {
        if (t.includes('sim') || t.includes('ok')) {
          resposta = 'Agendado! Técnico entra em contato 30min antes. Obrigado! ✅';
          // Aqui salvaria planilha
        } else {
          resposta = 'Entendo. Quer remarcar ou falar com atendente?';
        }
      }
      
      await enviarWhatsApp(telefone, resposta);
      return res.status(200).send('OK');
      
    } catch (erro) {
      console.error('❌ ERRO:', erro.message);
      console.error(erro.stack);
      return res.status(200).send('OK');
    }
  }
}

// ============================================
// FUNÇÃO TELEGRAM (VERSÃO GARANTIDA)
// ============================================

async function enviarTelegram(nome, telefone, mensagemCliente) {
  try {
    const texto = `🚨 *CLIENTE PEDIU ATENDENTE*

👤 Nome: ${nome || 'Não informado'}
📱 WhatsApp: ${telefone}
💬 Disse: "${mensagemCliente.substring(0, 100)}"

⏰ *AGIR AGORA*
🔗 Painel: https://seu-projeto.vercel.app/painel.html`;

    const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`;
    
    console.log('URL Telegram:', url.substring(0, 50) + '...');
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CONFIG.TELEGRAM_CHAT_ID,
        text: texto,
        parse_mode: 'Markdown'
      })
    });
    
    const resultado = await response.json();
    console.log('Resposta Telegram:', JSON.stringify(resultado));
    
    if (resultado.ok) {
      console.log('✅ Telegram enviado com sucesso');
      return true;
    } else {
      console.error('❌ Telegram erro:', resultado.description);
      return false;
    }
    
  } catch (erro) {
    console.error('❌ Erro ao enviar Telegram:', erro.message);
    return false;
  }
}

// ============================================
// FUNÇÕES AUXILIARES
// ============================================

function detectarServico(texto) {
  const t = texto.toLowerCase();
  if (t.includes('ar') || t.includes('condicionado')) return 'ar';
  if (t.includes('geladeira')) return 'geladeira';
  if (t.includes('máquina') || t.includes('lavar')) return 'maquina';
  if (t.includes('reforma')) return 'reforma';
  return null;
}

function extrairDados(texto) {
  const t = texto.toLowerCase();
  const dados = {};
  
  const btus = t.match(/(\d+)\s*(btus?|btu)/);
  if (btus) dados.btus = btus[1];
  
  const bairros = ['copacabana', 'ipanema', 'leblon', 'botafogo', 'flamengo', 'laranjeiras'];
  for (const b of bairros) {
    if (t.includes(b)) dados.bairro = b;
  }
  
  return dados;
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
    console.error('Erro WhatsApp:', e.message);
  }
}
