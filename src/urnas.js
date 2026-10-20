const crypto = require('crypto');
const { ErroEleicao } = require('./erros');

const ESTADOS_INFORMADOS = ['livre', 'aguardando', 'votando'];
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

/*
 * Urnas cadastradas no Admin, o vínculo de cada uma com um único computador
 * e as liberações (persistidos no banco) + o estado das conexões (em memória).
 *
 * Vínculo: cada urna sem computador tem um código de 6 dígitos, mostrado ao
 * mesário. O computador que digita esse código recebe um token secreto
 * (guardado no navegador dele) e passa a ser o único aceito por aquela urna.
 */
function criarUrnas(db, eleicao) {
  const conexoes = new Map(); // urna -> { socketId, estado }

  const existe = (urna) => Boolean(db.prepare('SELECT 1 FROM urnas WHERE id = ?').get(urna));
  const urnaValida = (urna) => Number.isInteger(urna) && existe(urna);
  const pendente = (urna) => db.prepare('SELECT pendente FROM liberacoes WHERE urna = ?').get(urna)?.pendente || null;

  function novoCodigo() {
    const emUso = db.prepare('SELECT 1 FROM urnas WHERE codigo = ?');
    for (;;) {
      const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      if (!emUso.get(codigo)) return codigo;
    }
  }

  // Bancos criados antes do cadastro de urnas tinham só a tabela de liberações.
  db.transaction(() => {
    for (const { urna } of db.prepare('SELECT urna FROM liberacoes WHERE urna NOT IN (SELECT id FROM urnas)').all()) {
      db.prepare('INSERT INTO urnas (id, codigo) VALUES (?, ?)').run(urna, novoCodigo());
    }
  })();

  // ---- Cadastro (só na preparação, como as chapas) ----
  const adicionar = db.transaction(() => {
    eleicao.exigirPreparacao();
    const id = db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS id FROM urnas').get().id;
    db.prepare('INSERT INTO urnas (id, codigo) VALUES (?, ?)').run(id, novoCodigo());
    db.prepare('INSERT INTO liberacoes (urna) VALUES (?)').run(id);
    eleicao.invalidarZeresima();
    return id;
  });

  // Só a última, para a numeração das urnas não ficar com buracos.
  const removerUltima = db.transaction(() => {
    eleicao.exigirPreparacao();
    const ultima = db.prepare('SELECT MAX(id) AS id FROM urnas').get().id;
    if (!ultima) throw new ErroEleicao('Não há urnas para remover.');
    db.prepare('DELETE FROM urnas WHERE id = ?').run(ultima);
    db.prepare('DELETE FROM liberacoes WHERE urna = ?').run(ultima);
    eleicao.invalidarZeresima();
    return ultima;
  });

  // ---- Vínculo com o computador ----
  const vincular = db.transaction((codigo) => {
    const linha = /^\d{6}$/.test(String(codigo)) && db.prepare('SELECT id FROM urnas WHERE codigo = ?').get(String(codigo));
    if (!linha) throw new ErroEleicao('Código inválido. Confira o código mostrado na tela do mesário.');
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('UPDATE urnas SET codigo = NULL, dispositivo = ? WHERE id = ?').run(hashToken(token), linha.id);
    return { urna: linha.id, token };
  });

  // Libera a urna para outro computador (o atual deixa de ser aceito).
  function desvincular(urna) {
    if (!existe(urna)) throw new ErroEleicao('Urna não encontrada.');
    db.prepare('UPDATE urnas SET codigo = ?, dispositivo = NULL WHERE id = ?').run(novoCodigo(), urna);
  }

  function dispositivoValido(urna, token) {
    const linha = Number.isInteger(urna) && db.prepare('SELECT dispositivo FROM urnas WHERE id = ?').get(urna);
    return Boolean(linha && linha.dispositivo && token && crypto.timingSafeEqual(Buffer.from(linha.dispositivo), Buffer.from(hashToken(token))));
  }

  // ---- Conexões ----
  // Uma nova aba no mesmo computador substitui a anterior.
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

  // ---- Liberações ----
  const liberar = db.transaction((urna) => {
    if (!urnaValida(urna)) throw new ErroEleicao('Urna inválida.');
    if (eleicao.status() !== 'aberta') throw new ErroEleicao('A votação não está aberta.');
    if (!conexoes.has(urna)) throw new ErroEleicao(`A urna ${urna} está desconectada.`);
    if (pendente(urna)) throw new ErroEleicao(`A urna ${urna} já está liberada.`);
    const token = crypto.randomBytes(16).toString('hex');
    db.prepare('UPDATE liberacoes SET emitidas = emitidas + 1, pendente = ? WHERE urna = ?').run(token, urna);
    return token;
  });

  // Só quantidades: nunca em quem se votou. O código de vínculo só vai para
  // telas com senha (mesário e admin).
  function painel() {
    const votos = Object.fromEntries(db.prepare('SELECT urna, COUNT(*) AS n FROM votos GROUP BY urna').all().map((l) => [l.urna, l.n]));
    const linhas = db.prepare(`SELECT u.id AS urna, u.codigo, u.dispositivo IS NOT NULL AS vinculada, l.pendente
      FROM urnas u JOIN liberacoes l ON l.urna = u.id ORDER BY u.id`).all();
    const urnas = linhas.map((l) => {
      const c = conexoes.get(l.urna);
      let status = 'desconectada';
      if (c) status = l.pendente ? (c.estado === 'votando' ? 'votando' : 'aguardando') : 'livre';
      return { urna: l.urna, status, liberada: Boolean(l.pendente), votos: votos[l.urna] || 0, vinculada: Boolean(l.vinculada), codigo: l.codigo };
    });
    return {
      statusVotacao: eleicao.status(),
      urnas,
      totalVotantes: urnas.reduce((s, u) => s + u.votos, 0),
    };
  }

  return { urnaValida, pendente, adicionar, removerUltima, vincular, desvincular, dispositivoValido, conectar, desconectar, informarEstado, liberar, painel };
}

module.exports = { criarUrnas };
