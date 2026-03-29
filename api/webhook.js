// CONFIGURAÇÕES
const CONFIG = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_KEY: process.env.SUPABASE_KEY,
  GROQ_KEY: process.env.GROQ_KEY,
  WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN,
  WHATSAPP_PHONE_ID: process.env.WHATSAPP_PHONE_ID,
  SEU_NUMERO: process.env.SEU_NUMERO
};

// PREÇOS BASE (podem ser ajustados conforme qualificação)
const TABELA_PRECOS = {
  ar_condicionado: {
    base: 120,
    variaveis: ['btus', 'ambientes', 'marca'],
    multiplicador: (dados) => {
      let valor = 120;
      if (dados.btus > 12000) valor += 50;
      if (dados.ambientes > 1) valor += 30 * (dados.ambientes - 1);
      if (dados.andar && dados.andar > 3) valor += 40; // prédio alto
      return valor;
    }
  },
  geladeira: {
    base: 80,
    variaveis: ['tipo', 'marca', 'problema'],
    multiplicador: (dados) => {
      let valor = 80;
      if (dados.tipo === 'side_by_side' || dados.tipo === 'frost_free') valor += 40;
      if (dados.marca === 'importada') valor += 30;
      return valor;
    }
  },
  maquina_lavar: {
    base: 80,
    variaveis: ['kg', 'tipo', 'marca'],
    multiplicador: (dados) => {
      let valor = 80;
      if (dados.kg > 10) valor += 30;
      return valor;
    }
  },
  reforma: {
    base: 150,
    variaveis: ['metragem', 'comodos', 'tipo_reforma', 'urgencia'],
    multiplicador: (dados) => {
      let valor = 150;
      if (dados.metragem > 50) valor += (dados.metragem - 50) * 2;
      if (dados.comodos > 2) valor += 50 * (dados.comodos - 2);
      if (dados.urgencia === 'sim') valor += 100;
      return valor;
    }
  }
};

// PROMPT DO VENDEDOR PROFISSIONAL
const PROMPT_VENDEDOR = `Você é Carlos, consultor técnico sênior da Conecta Serviços há 8 anos. 
Perfil: profissional, confiante, consultivo, nunca desesperado por venda.

PRINCÍPIOS DE VENDA:
1. PRIMEIRO entender, DEPOIS propor
2. Nunca dê preço antes de qualificar (saber o que precisa)
3. Crie valor antes de falar de dinheiro
3.5. Use técnicas de vendas: escassez, autoridade, prova social
4. Negocie com elegância (nunca desconto fácil)
5. Sempre tenha próximo passo claro

ESTRUTURA DE ATENDIMENTO:
1. SAUDAÇÃO: calorosa, profissional, curta
2. DIAGNÓSTICO: entender situação (perguntas específicas)
3. QUALIFICAÇÃO: BTUs, metragem, bairro, urgência, etc
4. CONSTRUÇÃO DE VALOR: "entendo que isso está te causando..."
5. PROPOSTA: valor da visita + o que inclui
6. NEGOCIAÇÃO: se necessário, com condições
7. FECHAMENTO: agendamento com data/hora
8. ENCAMINHAMENTO: passar para técnico com contexto completo

REGRAS DE OURO:
- NUNCA diga "só um minuto", "deixa eu ver"
- NUNCA peça desculpas excessivas
- SEMPRE assuma controle da conversa (você guia, cliente responde)
- Use "porque" sempre que possível (autoridade científica)
- Limite de 3 mensagens curtas, não textão

PREÇOS DE VISITA (só informar na etapa proposta):
- Ar condicionado: R$120-250 (conforme BTUs/dificuldade)
- Geladeira: R$80-150 (conforme tipo)
- Máquina: R$80-140 (conforme capacidade)
- Reforma: R$150-500 (conforme metragem/complexidade)

Se cliente pedir desconto: "Consigo ajustar para R$X se confirmarmos hoje para [data próxima]."

Se cliente hesitar: "Entendo que quer avaliar. Só lembrando que [fator urgência/escassez]. Qual sua maior dúvida?"

Se cliente mandar foto/vídeo: "Perfeito, consigo ver [descrever]. Isso confirma que [diagnóstico]."`;

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
      const nome = value.contacts?.[0]?.profile?.name || 'Cliente';
      
      // Ignorar mensagens do próprio sistema
      if (telefone === CONFIG.WHATSAPP_PHONE_ID) return res.status(200).send('OK');
      
      // ========== PROCESSAR MENSAGEM (QUALQUER TIPO) ==========
      
      let conteudoProcessado = {
        tipo: message.type,
        texto: '',
        descricao_midia: ''
      };
      
      if (message.type === 'text') {
        conteudoProcessado.texto = message.text.body;
      } 
      else if (message.type === 'audio') {
        // Transcrever com AssemblyAI (implementar depois)
        conteudoProcessado.texto = '[áudio do cliente]';
        conteudoProcessado.descricao_midia = 'Cliente enviou áudio, possivelmente descrevendo o problema';
      }
      else if (message.type === 'image') {
        conteudoProcessado.texto = '[imagem do cliente]';
        conteudoProcessado.descricao_midia = await analisarImagem(message.image.id);
      }
      else if (message.type === 'video') {
        conteudoProcessado.texto = '[vídeo do cliente]';
        conteudoProcessado.descricao_midia = 'Cliente enviou vídeo mostrando o problema';
      }
      
      // ========== BUSCAR CONTEXTO ==========
      
      const conversa = await buscarConversa(telefone);
      
      // Atualizar histórico
      const novoHistorico = [...(conversa.historico_msg || []), {
        role: 'user',
        content: conteudoProcessado.texto,
        timestamp: new Date().toISOString()
      }].slice(-10);
      
      // ========== IA PROCESSAR ==========
      
      const contextoCompleto = montarContexto(conversa, nome, conteudoProcessado);
      
      const respostaIA = await chamarGroq(contextoCompleto);
      
      // ========== PROCESSAR RESPOSTA DA IA ==========
      
      const acao = interpretarResposta(respostaIA);
      
      // Salvar no banco
      await salvarConversa(telefone, {
        ...conversa,
        nome_cliente: nome,
        historico_msg: [...novoHistorico, {
          role: 'assistant',
          content: respostaIA,
          timestamp: new Date().toISOString()
        }],
        etapa: acao.novaEtapa || conversa.etapa,
        dados_json: { ...conversa.dados_json, ...acao.novosDados }
      });
      
      // ========== EXECUTAR AÇÕES ==========
      
      // 1. Responder cliente
      await enviarWhatsApp(telefone, respostaIA);
      
      // 2. Se identificou serviço completo, alertar técnicos
      if (acao.encaminharTecnico) {
        const tecnicos = await buscarTecnicosDisponiveis(
          acao.novosDados.servico_detectado,
          acao.novosDados.bairro
        );
        
        for (const tecnico of tecnicos) {
          await enviarWhatsApp(tecnico.telefone, 
            `🔧 *NOVA OPORTUNIDADE*\n\n` +
            `Cliente: ${nome}\n` +
            `Serviço: ${acao.novosDados.servico_detectado}\n` +
            `Bairro: ${acao.novosDados.bairro}\n` +
            `Especificações: ${JSON.stringify(acao.novosDados)}\n` +
            `Valor visita: R$${acao.valorCalculado}\n\n` +
            `Responda SIM para aceitar ou NÃO para recusar.`
          );
        }
        
        // Notificar você também
        await enviarWhatsApp(CONFIG.SEU_NUMERO,
          `🎯 *LEAD QUALIFICADO*\n\n` +
          `Cliente: ${nome} (${telefone})\n` +
          `Serviço: ${acao.novosDados.servico_detectado}\n` +
          `Valor: R$${acao.valorCalculado}\n` +
          `Técnicos alertados: ${tecnicos.length}`
        );
      }
      
      // 3. Log para treinamento
      await salvarLog({
        telefone,
        tipo_msg: message.type,
        conteudo_original: conteudoProcessado.texto,
        interpretacao_ia: conteudoProcessado.descricao_midia,
        resposta_enviada: respostaIA,
        etapa_conversa: acao.novaEtapa
      });
      
      return res.status(200).send('OK');
      
    } catch (erro) {
      console.error('Erro:', erro);
      return res.status(500).send('Erro');
    }
  }
}

// ========== FUNÇÕES AUXILIARES ==========

function montarContexto(conversa, nome, conteudo) {
  let contexto = `VOCÊ É CARLOS, CONSULTOR TÉCNICO.\n\n`;
  contexto += `CLIENTE ATUAL: ${nome}\n`;
  contexto += `ETAPA DA CONVERSA: ${conversa.etapa || 'saudacao'}\n`;
  
  if (conversa.servico_detectado) {
    contexto += `SERVIÇO IDENTIFICADO: ${conversa.servico_detectado}\n`;
    contexto += `DADOS COLETADOS: ${JSON.stringify(conversa.dados_json || {})}\n`;
  }
  
  if (conteudo.descricao_midia) {
    contexto += `ANÁLISE DA MÍDIA: ${conteudo.descricao_midia}\n`;
  }
  
  contexto += `\nMENSAGEM DO CLIENTE: ${conteudo.texto}\n`;
  
  contexto += `\nHISTÓRICO RECENTE:\n`;
  (conversa.historico_msg || []).slice(-3).forEach(msg => {
    contexto += `${msg.role === 'user' ? 'Cliente' : 'Você'}: ${msg.content.substring(0, 100)}\n`;
  });
  
  return contexto;
}

async function chamarGroq(contexto) {
  const resposta = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CONFIG.GROQ_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama3-70b-8192',
      messages: [
        { role: 'system', content: PROMPT_VENDEDOR },
        { role: 'user', content: contexto }
      ],
      temperature: 0.8,
      max_tokens: 400
    })
  });
  
  const dados = await resposta.json();
  return dados.choices?.[0]?.message?.content || 'Entendo. Pode me dar mais detalhes?';
}

function interpretarResposta(texto) {
  const t = texto.toLowerCase();
  const resultado = {
    novaEtapa: null,
    novosDados: {},
    encaminharTecnico: false,
    valorCalculado: 0
  };
  
  // Detectar etapa pela resposta
  if (t.includes('qual seu bairro') || t.includes('onde fica')) {
    resultado.novaEtapa = 'qualificacao_bairro';
  }
  else if (t.includes('btus') || t.includes('metragem') || t.includes('m²')) {
    resultado.novaEtapa = 'qualificacao_tecnica';
  }
  else if (t.includes('valor') || t.includes('preço') || t.includes('custa')) {
    resultado.novaEtapa = 'proposta';
  }
  else if (t.includes('r$') && (t.includes('visita') || t.includes('orçamento'))) {
    resultado.novaEtapa = 'negociacao';
    
    // Tentar extrair valor mencionado
    const match = texto.match(/R\$\s*(\d+)/);
    if (match) resultado.valorCalculado = parseInt(match[1]);
  }
  else if (t.includes('agendado') || t.includes('confirmado') || t.includes('fechado')) {
    resultado.novaEtapa = 'fechamento';
    resultado.encaminharTecnico = true;
  }
  
  // Detectar dados na resposta (quando cliente responde)
  // Isso seria processado na próxima mensagem
  
  return resultado;
}

async function analisarImagem(imageId) {
  // Implementar com Hugging Face ou GPT-4 Vision
  // Por enquanto, retorna genérico
  return 'Imagem recebida para análise técnica';
}

async function buscarTecnicosDisponiveis(servico, bairro) {
  const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/tecnicos?especialidades=cs.{${servico}}&ativo=eq.true`, {
    headers: {
      'apikey': CONFIG.SUPABASE_KEY,
      'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`
    }
  });
  
  const tecnicos = await res.json();
  
  // Filtrar por bairro se possível
  const comBairro = tecnicos.filter(t => 
    t.bairros_atendidos?.includes(bairro?.toLowerCase())
  );
  
  return comBairro.length > 0 ? comBairro : tecnicos;
}

// ========== SUPABASE ==========

async function buscarConversa(telefone) {
  const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/conversas?telefone=eq.${telefone}`, {
    headers: {
      'apikey': CONFIG.SUPABASE_KEY,
      'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`
    }
  });
  const dados = await res.json();
  return dados[0] || { telefone, etapa: 'saudacao', dados_json: {}, historico_msg: [] };
}

async function salvarConversa(telefone, dados) {
  const existe = await buscarConversa(telefone);
  
  const body = {
    ...dados,
    atualizado_em: new Date().toISOString()
  };
  
  if (existe.telefone) {
    await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/conversas?telefone=eq.${telefone}`, {
      method: 'PATCH',
      headers: {
        'apikey': CONFIG.SUPABASE_KEY,
        'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
  } else {
    await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/conversas`, {
      method: 'POST',
      headers: {
        'apikey': CONFIG.SUPABASE_KEY,
        'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ...body, criado_em: new Date().toISOString() })
    });
  }
}

async function salvarLog(dados) {
  await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/logs_mensagens`, {
    method: 'POST',
    headers: {
      'apikey': CONFIG.SUPABASE_KEY,
      'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(dados)
  });
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
