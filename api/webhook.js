// CONFIGURAÇÕES - O VERCEL VAI PREENCHER AUTOMATICAMENTE
const CONFIG = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_KEY: process.env.SUPABASE_KEY,
  GROQ_KEY: process.env.GROQ_KEY,
  WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN,
  WHATSAPP_PHONE_ID: process.env.WHATSAPP_PHONE_ID,
  SEU_NUMERO: process.env.SEU_NUMERO
};

export default async function handler(req, res) {
  // Facebook verifica com GET
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    if (mode === 'subscribe' && token === 'agente123') {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  // Receber mensagem com POST
  if (req.method === 'POST') {
    try {
      const entry = req.body.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const message = value?.messages?.[0];
      
      if (!message) return res.status(200).send('OK');
      
      const telefone = message.from;
      const nome = value.contacts?.[0]?.profile?.name || 'Cliente';
      
      // Ignorar mensagens do próprio sistema
      if (telefone === CONFIG.WHATSAPP_PHONE_ID) return res.status(200).send('OK');
      
      let texto = '';
      
      if (message.type === 'text') {
        texto = message.text.body;
      } else if (message.type === 'audio') {
        await enviarWhatsApp(telefone, 'Desculpe, ainda não consigo ouvir áudios. Pode digitar? 📝');
        return res.status(200).send('OK');
      } else {
        texto = `[${message.type}]`;
      }
      
      console.log(`${nome} (${telefone}): ${texto.substring(0, 50)}`);
      
      // Verificar se quer falar com humano
      const querHumano = /humano|atendente|pessoa/i.test(texto);
      
      let resposta = '';
      
      if (querHumano) {
        resposta = 'Vou chamar um atendente. Aguarde... ⏳';
        await enviarWhatsApp(CONFIG.SEU_NUMERO, `🚨 ${nome} pediu humano: ${telefone}`);
      } else {
        // Responder com IA
        resposta = await responderIA(texto, nome);
      }
      
      await enviarWhatsApp(telefone, resposta);
      
      return res.status(200).send('OK');
      
    } catch (erro) {
      console.error('Erro:', erro);
      return res.status(500).send('Erro');
    }
  }
}

async function responderIA(mensagem, nomeCliente) {
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
          {
            role: 'system',
            content: `Você é atendente da Conecta Serviços. Serviços: Ar-cond (R$120), Geladeira (R$80), Máquina (R$80), Reforma (R$100). Seja direto, profissional, use emojis. Colete: nome, bairro, data, horário.`
          },
          {
            role: 'user',
            content: mensagem
          }
        ],
        temperature: 0.7,
        max_tokens: 300
      })
    });
    
    const dados = await resposta.json();
    return dados.choices?.[0]?.message?.content || 'Desculpe, tive um problema. Um atendente vai ajudar.';
    
  } catch (erro) {
    return 'Desculpe, estou com dificuldades. Vou chamar um atendente.';
  }
}

async function enviarWhatsApp(telefone, mensagem) {
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
}
