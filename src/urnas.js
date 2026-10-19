const crypto = require('crypto');
const config = require('./config');
const { ErroEleicao } = require('./erros');

const ESTADOS_INFORMADOS = ['livre', 'aguardando', 'votando'];

// Liberações (persistidas no banco) + estado das conexões das urnas (em memória).
function criarUrnas(db, eleicao) {
  const conexoes = new Map(); // urna -> { socketId, estado }

  const urnaValida = (urna) => Number.isInteger(urna) && urna >= 1 && urna <= config.numUrnas;
  const pendente = (urna) => db.prepare('SELECT pendente FROM liberacoes WHERE urna = ?').get(urna)?.pendente || null;

  // Uma nova aba/computador com o mesmo número de urna substitui a anterior.
  function conectar(urna, socketId) {
    const anterior = conexoes.get(urna);
    conexoes.set(urna, { socketId, estado: 'livre' });
    return anterior && anterior.socketId !== socketId ? anterior.socketId : null;
  }

  function desconectar(urna, socketId) {
    if (conexoes.get(urna)?.socketId === socketId) conexoes.delete(urna);
  }

  function informarEstado(urna, socketId, estado) {
    const c = conexoes.get(urna);
    if (c && c.socketId === socketId && ESTADOS_INFORMADOS.includes(estado)) c.estado = estado;
  }

  const liberar = db.transaction((urna) => {
    if (!urnaValida(urna)) throw new ErroEleicao('Urna inválida.');
    if (eleicao.status() !== 'aberta') throw new ErroEleicao('A votação não está aberta.');
    if (!conexoes.has(urna)) throw new ErroEleicao(`A urna ${urna} está desconectada.`);
    if (pendente(urna)) throw new ErroEleicao(`A urna ${urna} já está liberada.`);
    const token = crypto.randomBytes(16).toString('hex');
    db.prepare('UPDATE liberacoes SET emitidas = emitidas + 1, pendente = ? WHERE urna = ?').run(token, urna);
    return token;
  });

  // Só quantidades: nunca em quem se votou.
  function painel() {
    const votos = Object.fromEntries(db.prepare('SELECT urna, COUNT(*) AS n FROM votos GROUP BY urna').all().map((l) => [l.urna, l.n]));
    const urnas = db.prepare('SELECT urna, emitidas, pendente FROM liberacoes ORDER BY urna').all().map((l) => {
      const c = conexoes.get(l.urna);
      let status = 'desconectada';
      if (c) status = l.pendente ? (c.estado === 'votando' ? 'votando' : 'aguardando') : 'livre';
      return { urna: l.urna, status, liberada: Boolean(l.pendente), votos: votos[l.urna] || 0 };
    });
    return {
      statusVotacao: eleicao.status(),
      urnas,
      totalVotantes: urnas.reduce((s, u) => s + u.votos, 0),
    };
  }

  return { urnaValida, pendente, conectar, desconectar, informarEstado, liberar, painel };
}

module.exports = { criarUrnas };
