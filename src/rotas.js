const path = require('path');
const express = require('express');
const config = require('./config');
const { ErroEleicao } = require('./erros');
const { ipsLocais } = require('./banner');

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

  // Vínculo do computador com uma urna, pelo código mostrado ao mesário.
  // Depois de 5 códigos errados, o computador espera 1 minuto (evita tentativa e erro).
  const tentativas = new Map(); // ip -> { erros, bloqueadoAte }
  api.post('/urna/vincular', (req, res) => {
    const ip = req.socket.remoteAddress;
    const t = tentativas.get(ip) || { erros: 0, bloqueadoAte: 0 };
    if (Date.now() < t.bloqueadoAte) throw new ErroEleicao('Muitos códigos errados. Espere 1 minuto e tente de novo.');
    let vinculo;
    try {
      vinculo = urnas.vincular(req.body.codigo);
    } catch (erro) {
      t.erros++;
      if (t.erros >= 5) Object.assign(t, { erros: 0, bloqueadoAte: Date.now() + 60 * 1000 });
      tentativas.set(ip, t);
      throw erro;
    }
    tentativas.delete(ip);
    tempoReal.painelMudou();
    res.json(vinculo);
  });

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
  admin.get('/rede', (req, res) => res.json({ ips: ipsLocais(), porta: config.porta }));
  admin.post('/urnas', (req, res) => {
    const urna = urnas.adicionar();
    tempoReal.painelMudou();
    res.json({ urna });
  });
  admin.delete('/urnas/ultima', (req, res) => {
    const urna = urnas.removerUltima();
    tempoReal.urnaDesvinculada(urna);
    res.json({ urna });
  });
  admin.post('/urnas/:urna/desvincular', (req, res) => {
    const urna = Number(req.params.urna);
    urnas.desvincular(urna);
    tempoReal.urnaDesvinculada(urna);
    res.json({ urna });
  });
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

  admin.post('/nova-eleicao', async (req, res) => {
    eleicao.exigirEncerrada();
    if (!auth.conferirSenha(req.body.senha)) throw new ErroEleicao('Senha incorreta.');
    const pendentes = eleicao.liberacoesPendentes();
    if (pendentes.length && !req.body.forcar) {
      return res.status(409).json({ pendentes, erro: `A urna ${pendentes.join(', ')} ficou com uma liberação sem voto registrado: se ela estava desconectada, pode haver um voto guardado nela que ainda não chegou.` });
    }
    const arquivo = await backup.arquivar();
    eleicao.zerar({ apagarChapas: Boolean(req.body.apagarChapas) });
    db.pragma('wal_checkpoint(TRUNCATE)');
    await backup.fazerAgora();
    tempoReal.estadoMudou();
    res.json({ ...eleicao.estado(), arquivo });
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
