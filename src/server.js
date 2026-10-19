const http = require('http');
const express = require('express');
const config = require('./config');
const { abrirBanco } = require('./db');
const { criarAuth } = require('./auth');
const { criarEleicao } = require('./eleicao');
const { criarUrnas } = require('./urnas');
const { criarVotos } = require('./votos');
const { criarApuracao } = require('./apuracao');
const { criarBackup } = require('./backup');
const { criarTempoReal } = require('./tempoReal');
const { criarRotas } = require('./rotas');
const { mostrarBanner } = require('./banner');

const db = abrirBanco();
const auth = criarAuth(db);
const eleicao = criarEleicao(db);
const urnas = criarUrnas(db, eleicao);
const votos = criarVotos(db);
const apuracao = criarApuracao(db, eleicao, votos);
const backup = criarBackup(db);

// O Socket.IO precisa ser ligado a um servidor criado já com o app HTTP (senão o
// Express também responde às requisições dele); as rotas entram depois porque dependem dele.
const app = express();
const servidor = http.createServer(app);
const tempoReal = criarTempoReal(servidor, { auth, eleicao, urnas, votos, backup });
app.use(criarRotas({ db, auth, eleicao, urnas, apuracao, votos, backup, tempoReal }));

servidor.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\nA porta ${config.porta} já está em uso. O sistema provavelmente já está aberto em outra janela.\n`);
  } else {
    console.error('Erro no servidor:', e);
  }
  process.exit(1);
});

servidor.listen(config.porta, () => {
  mostrarBanner(config.porta, config.numUrnas);
  backup.fazerAgora();
});

let encerrando = false;
async function desligar() {
  if (encerrando) return;
  encerrando = true;
  console.log('\nDesligando com segurança...');
  await backup.fazerAgora();
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
  process.exit(0);
}
process.on('SIGINT', desligar);
process.on('SIGTERM', desligar);
