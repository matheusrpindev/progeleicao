const path = require('path');
const express = require('express');
const config = require('./config');
const { ErroEleicao } = require('./erros');

const PAGINAS = {
  '/admin': 'admin/index.html',
  '/admin/zeresima': 'admin/zeresima.html',
  '/mesario': 'mesario/index.html',
  '/urna': 'urna/index.html',
  '/resultado': 'resultado/index.html',
};

const ehLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

function criarRotas({ db, auth, eleicao, urnas, apuracao, votos, backup, tempoReal }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '8mb' }));

  app.get('/', (req, res) => res.redirect('/mesario'));
  for (const [rota, arquivo] of Object.entries(PAGINAS)) {
    app.get(rota, (req, res) => res.sendFile(path.join(config.pastaPublica, arquivo)));
  }
  app.use(express.static(config.pastaPublica, { index: false }));
  app.use('/fotos', express.static(config.pastaFotos));

  const api = express.Router();
  app.use('/api', api);

  // ---- Sessão ----
  api.get('/sessao', (req, res) => {
    res.json({ senhaDefinida: auth.senhaDefinida(), autenticado: auth.autenticado(req.headers.cookie), local: ehLocal(req) });
  });

  // A senha só pode ser criada no próprio computador servidor.
  api.post('/senha', (req, res) => {
    if (!ehLocal(req)) throw new ErroEleicao('A senha só pode ser definida no computador servidor (endereço http://localhost:' + config.porta + ').');
    auth.definirSenha(req.body.senha);
    entrar(req, res);
  });

  function entrar(req, res) {
    const token = auth.entrar(req.body.senha);
    if (!token) return res.status(401).json({ erro: 'Senha incorreta.' });
    res.cookie(auth.NOME_COOKIE, token, { httpOnly: true, sameSite: 'strict' });
    res.json({ ok: true });
  }
  api.post('/login', entrar);

  api.post('/logout', (req, res) => {
    auth.sair(req.headers.cookie);
    res.clearCookie(auth.NOME_COOKIE);
    res.json({ ok: true });
  });

  // ---- Público (usado pela urna) ----
  api.get('/estado', (req, res) => res.json(eleicao.estado()));

  // ---- Admin ----
  const admin = express.Router();
  admin.use(auth.exigirLogin);
  api.use('/admin', admin);

  const aposMudanca = (res) => {
    tempoReal.estadoMudou();
    res.json(eleicao.estado());
  };

  admin.get('/estado', (req, res) => res.json(eleicao.estado()));
  admin.put('/dados', (req, res) => { eleicao.salvarDados(req.body); aposMudanca(res); });
  admin.post('/chapas', (req, res) => { eleicao.criarChapa(req.body); aposMudanca(res); });
  admin.put('/chapas/:numero', (req, res) => { eleicao.editarChapa(req.params.numero, req.body); aposMudanca(res); });
  admin.delete('/chapas/:numero', (req, res) => { eleicao.excluirChapa(req.params.numero); aposMudanca(res); });
  admin.post('/zeresima', (req, res) => res.json(eleicao.emitirZeresima()));

  admin.post('/abrir', async (req, res) => {
    eleicao.abrir();
    await backup.fazerAgora();
    aposMudanca(res);
  });

  admin.post('/encerrar', async (req, res) => {
    const r = eleicao.encerrar({ forcar: Boolean(req.body.forcar) });
    if (!r.encerrada) {
      return res.status(409).json({ pendentes: r.pendentes, erro: `A urna ${r.pendentes.join(', ')} está liberada e ainda não recebeu o voto.` });
    }
    // Esvazia o arquivo WAL, que guarda o histórico de páginas do banco.
    db.pragma('wal_checkpoint(TRUNCATE)');
    await backup.fazerAgora();
    aposMudanca(res);
  });

  // ---- Mesário ----
  const mesario = express.Router();
  mesario.use(auth.exigirLogin);
  api.use('/mesario', mesario);

  mesario.get('/painel', (req, res) => res.json(urnas.painel()));
  mesario.post('/liberar/:urna', (req, res) => {
    const urna = Number(req.params.urna);
    const token = urnas.liberar(urna);
    tempoReal.liberacaoEmitida(urna, token);
    res.json({ ok: true });
  });

  // ---- Resultado ----
  const resultado = express.Router();
  resultado.use(auth.exigirLogin);
  resultado.use((req, res, next) => {
    if (eleicao.status() !== 'encerrada') return res.status(403).json({ erro: 'O resultado só fica disponível depois que a votação for encerrada.' });
    next();
  });
  api.use('/resultado', resultado);

  const nomeArquivo = (ext) => `resultado-eleicao.${ext}`;
  resultado.get('/', (req, res) => res.json(apuracao.apurar()));
  resultado.get('/integridade', (req, res) => res.json(votos.verificarIntegridade()));
  resultado.get('/csv', (req, res) => {
    res.attachment(nomeArquivo('csv')).type('text/csv; charset=utf-8').send(apuracao.csv(apuracao.apurar()));
  });
  resultado.get('/json', (req, res) => {
    res.attachment(nomeArquivo('json')).type('application/json').send(JSON.stringify(apuracao.apurar(), null, 2));
  });

  // ---- Erros ----
  app.use((erro, req, res, next) => {
    if (erro instanceof ErroEleicao) return res.status(400).json({ erro: erro.message });
    if (erro.type === 'entity.too.large') return res.status(413).json({ erro: 'Arquivo grande demais.' });
    console.error(erro);
    res.status(500).json({ erro: 'Erro interno no servidor.' });
  });

  return app;
}

module.exports = { criarRotas };
