export default function handler(req, res) {
  // Lista conversas em memória
  const lista = Object.entries(global.conversas || {}).map(([tel, chat]) => ({
    telefone: tel,
    nome: chat.nome,
    servico: chat.servico,
    pausado: chat.pausado,
    pediuHumanoEm: chat.pediuHumanoEm,
    desde: chat.pediuHumanoEm || new Date().toISOString()
  }));
  
  res.json(lista);
}
