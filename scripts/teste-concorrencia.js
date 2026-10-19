/*
 * Teste de concorrência: sobe um servidor de verdade numa pasta temporária,
 * simula as 4 urnas votando ao mesmo tempo (500 votações, com reenvios
 * duplicados e quedas de conexão), derruba e religa o servidor no meio, e
 * confere se a contagem final bate exatamente com o que foi votado.
 *
 * Uso: npm test
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');
const { DatabaseSync } = require('node:sqlite');

const TOTAL_VOTOS = 500;
const NUM_URNAS = 4;
const CHAPAS = [
  { numero: '10', nome: 'Chapa Avante' },
  { numero: '20', nome: 'Chapa União' },
  { numero: '30', nome: 'Chapa Renovação' },
];
const OPCOES = ['10', '20', '30', 'BRANCO', '99' /* número inexistente = nulo */];

const pastaDados = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-eleicao-'));
const porta = 3100 + Math.floor(Math.random() * 800);
const base = `http://127.0.0.1:${porta}`;
let servidor = null;
let cookie = '';
let falhas = 0;
let duplicadosIgnorados = 0;

function conferir(condicao, descricao) {
  if (condicao) console.log(`  ✔ ${descricao}`);
  else { falhas++; console.log(`  ✘ FALHOU: ${descricao}`); }
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function ligarServidor() {
  servidor = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, DATA_DIR: pastaDados, PORT: String(porta) },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (let i = 0; i < 100; i++) {
    try { await fetch(`${base}/api/sessao`); return; } catch { await esperar(100); }
  }
  throw new Error('O servidor não subiu.');
}

async function desligarServidor() {
  const fim = new Promise((r) => servidor.once('exit', r));
  servidor.kill('SIGKILL'); // simula queda brusca (falta de energia)
  await fim;
}

async function http(metodo, rota, corpo) {
  const resp = await fetch(base + rota, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const setCookie = resp.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const dados = await resp.json().catch(() => ({}));
  return { status: resp.status, dados };
}

function conectarUrna(numero) {
  const socket = io(base, { query: { tipo: 'urna', urna: String(numero) }, reconnectionDelay: 100 });
  socket.sincronizacoes = 0;
  socket.on('sincronizar', (d) => { socket.ultimaSincronizacao = d; socket.sincronizacoes++; });
  return socket;
}

const esperarEvento = (socket, evento, ms = 5000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`Tempo esgotado esperando "${evento}"`)), ms);
  socket.once(evento, (d) => { clearTimeout(t); resolve(d); });
});

const esperarConexao = (socket) => (socket.connected ? Promise.resolve() : esperarEvento(socket, 'connect'));

async function votar(socket, voto) {
  for (;;) {
    try {
      await esperarConexao(socket);
      return await socket.timeout(5000).emitWithAck('voto', voto);
    } catch { await esperar(50); } // como a urna real: reenvia até ter resposta
  }
}

async function simularUrna(numero, socket, quantidade, esperado) {
  for (let i = 0; i < quantidade; i++) {
    await esperarConexao(socket);
    const chegou = esperarEvento(socket, 'liberacao');
    const lib = await http('POST', `/api/mesario/liberar/${numero}`);
    if (lib.status !== 200) throw new Error(`Liberação falhou na urna ${numero}: ${lib.dados.erro}`);
    const { token } = await chegou;

    const opcao = OPCOES[Math.floor(Math.random() * OPCOES.length)];
    const voto = { id: crypto.randomUUID(), token, voto: opcao };
    let respostas;
    if (i % 10 === 3) {
      // Reenvio em paralelo do mesmo voto (o servidor deve contar uma vez só).
      respostas = await Promise.all([votar(socket, voto), votar(socket, voto), votar(socket, voto)]);
    } else if (i % 25 === 7) {
      // Queda de rede logo após enviar: a urna reconecta e reenvia.
      socket.emit('voto', voto);
      socket.disconnect();
      await esperar(20);
      socket.connect();
      respostas = [await votar(socket, voto)];
    } else {
      respostas = [await votar(socket, voto)];
    }
    if (!respostas.every((r) => r.ok)) throw new Error(`Voto recusado na urna ${numero}: ${JSON.stringify(respostas)}`);
    duplicadosIgnorados += respostas.filter((r) => r.duplicado).length;

    const escolha = opcao === '99' ? 'NULO' : opcao;
    esperado[numero][escolha] = (esperado[numero][escolha] || 0) + 1;
  }
}

async function principal() {
  console.log(`\nTeste de concorrência — ${NUM_URNAS} urnas, ${TOTAL_VOTOS} votações`);
  console.log(`Pasta temporária: ${pastaDados}\n`);
  await ligarServidor();

  console.log('Preparação:');
  conferir((await http('POST', '/api/senha', { senha: 'teste123' })).status === 200, 'senha criada no primeiro acesso');
  await http('PUT', '/api/admin/dados', { escola: 'Escola de Teste', eleicao: 'Eleição do Grêmio — Teste' });
  for (const c of CHAPAS) await http('POST', '/api/admin/chapas', c);
  conferir((await http('POST', '/api/admin/abrir')).status === 400, 'não abre sem zerésima');
  const zeresima = await http('POST', '/api/admin/zeresima');
  conferir(zeresima.status === 200 && zeresima.dados.totalVotos === 0 && zeresima.dados.urnas.every((u) => u.votos === 0), 'zerésima: todas as urnas com 0 votos');
  conferir((await http('POST', '/api/admin/abrir')).status === 200, 'votação aberta');
  conferir((await http('POST', '/api/admin/chapas', { numero: '40', nome: 'Tardia' })).status === 400, 'chapas bloqueadas após a abertura');
  conferir((await http('GET', '/api/resultado')).status === 403, 'sem resultado parcial com a votação aberta');

  const urnas = {};
  for (let n = 1; n <= NUM_URNAS; n++) {
    urnas[n] = conectarUrna(n);
    await esperarEvento(urnas[n], 'sincronizar');
  }

  console.log('\nRegras de liberação:');
  const semLib = await votar(urnas[1], { id: crypto.randomUUID(), token: 'x', voto: '10' });
  conferir(!semLib.ok && semLib.erro === 'sem_liberacao', 'voto sem liberação é recusado');
  const chegou = esperarEvento(urnas[1], 'liberacao');
  await http('POST', '/api/mesario/liberar/1');
  const { token } = await chegou;
  conferir((await http('POST', '/api/mesario/liberar/1')).status === 400, 'não libera duas vezes a mesma urna');
  const tokenErrado = await votar(urnas[1], { id: crypto.randomUUID(), token: 'errado', voto: '10' });
  conferir(!tokenErrado.ok, 'voto com liberação errada é recusado');

  console.log('\nReconexão (servidor cai com a urna 1 liberada):');
  const antes = Object.values(urnas).map((s) => s.sincronizacoes);
  await desligarServidor();
  await ligarServidor();
  cookie = '';
  await http('POST', '/api/login', { senha: 'teste123' });
  for (let t = 0; Object.values(urnas).some((s, i) => s.sincronizacoes === antes[i]); t++) {
    if (t > 200) throw new Error('As urnas não reconectaram após o servidor voltar.');
    await esperar(50);
  }
  conferir(urnas[1].ultimaSincronizacao?.pendente === token, 'urna 1 recupera a liberação pendente após o servidor voltar');
  const esperado = Object.fromEntries(Array.from({ length: NUM_URNAS }, (_, i) => [i + 1, {}]));
  const primeiro = await votar(urnas[1], { id: crypto.randomUUID(), token, voto: '10' });
  conferir(primeiro.ok, 'voto da liberação recuperada é aceito');
  esperado[1]['10'] = 1;
  const restante = TOTAL_VOTOS - 1;

  console.log(`\nVotação simultânea (${restante} votos restantes nas ${NUM_URNAS} urnas)...`);
  const inicio = Date.now();
  const porUrna = Array.from({ length: NUM_URNAS }, (_, i) => Math.floor(restante / NUM_URNAS) + (i < restante % NUM_URNAS ? 1 : 0));
  await Promise.all(porUrna.map((q, i) => simularUrna(i + 1, urnas[i + 1], q, esperado)));
  console.log(`  concluída em ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
  conferir(duplicadosIgnorados >= 2 * Math.floor(restante / NUM_URNAS / 10) * NUM_URNAS, `${duplicadosIgnorados} reenvios repetidos foram reconhecidos e ignorados`);

  const encerrar = await http('POST', '/api/admin/encerrar', {});
  conferir(encerrar.status === 200, 'votação encerrada');
  const r = (await http('GET', '/api/resultado')).dados;

  console.log('\nConferência da contagem:');
  let totalEsperado = 0;
  for (let n = 1; n <= NUM_URNAS; n++) {
    const b = r.boletins.find((x) => x.urna === n);
    const e = esperado[n];
    const ok = CHAPAS.every((c) => b.porChapa[c.numero] === (e[c.numero] || 0))
      && b.brancos === (e.BRANCO || 0) && b.nulos === (e.NULO || 0);
    const totalUrna = Object.values(e).reduce((s, x) => s + x, 0);
    totalEsperado += totalUrna;
    conferir(ok && b.total === totalUrna, `urna ${n}: ${b.total} votos, boletim idêntico ao esperado`);
  }
  conferir(totalEsperado === TOTAL_VOTOS && r.geral.total === TOTAL_VOTOS, `total geral = ${r.geral.total} (esperado ${TOTAL_VOTOS})`);
  conferir(r.conferencia.situacao === 'ok', `conferência automática: ${r.conferencia.situacao} (liberações = ${r.conferencia.liberacoesEmitidas})`);
  conferir(r.integridade.ok, `integridade: ${r.integridade.mensagem}`);

  console.log('\nSigilo, backup e adulteração:');
  const db = new DatabaseSync(path.join(pastaDados, 'eleicao.db'));
  const colunas = db.prepare('PRAGMA table_info(votos)').all().map((c) => c.name).join(',');
  conferir(colunas === 'id,urna,escolha,hash_anterior,hash', `tabela de votos só tem: ${colunas}`);
  conferir(fs.existsSync(path.join(pastaDados, 'backup', 'eleicao-backup.db')), 'arquivo de backup gravado');
  const alvo = db.prepare("SELECT id, escolha FROM votos WHERE escolha != '10' LIMIT 1").get();
  db.prepare("UPDATE votos SET escolha = '10' WHERE id = ?").run(alvo.id);
  const adulterado = (await http('GET', '/api/resultado/integridade')).dados;
  conferir(!adulterado.ok, `voto alterado direto no banco é detectado: "${adulterado.mensagem}"`);
  db.prepare('UPDATE votos SET escolha = ? WHERE id = ?').run(alvo.escolha, alvo.id);
  const ultimo = db.prepare('SELECT * FROM votos ORDER BY id DESC LIMIT 1').get();
  db.prepare('DELETE FROM votos WHERE id = ?').run(ultimo.id);
  conferir(!(await http('GET', '/api/resultado/integridade')).dados.ok, 'voto apagado direto no banco é detectado');
  const votosAntes = db.prepare('SELECT COUNT(*) AS n FROM votos').get().n;
  db.close();

  console.log('\nNova eleição:');
  conferir((await http('POST', '/api/admin/nova-eleicao', { senha: 'errada' })).status === 400, 'senha errada não inicia nova eleição');
  const nova = await http('POST', '/api/admin/nova-eleicao', { senha: 'teste123' });
  conferir(nova.status === 200 && nova.dados.status === 'preparacao', 'nova eleição iniciada (volta para preparação)');
  const arquivado = new DatabaseSync(path.join(pastaDados, 'arquivo', nova.dados.arquivo));
  conferir(arquivado.prepare('SELECT COUNT(*) AS n FROM votos').get().n === votosAntes, `eleição anterior arquivada com os ${votosAntes} votos`);
  arquivado.close();
  conferir(nova.dados.chapas.length === CHAPAS.length, 'chapas mantidas');
  const z2 = await http('POST', '/api/admin/zeresima');
  conferir(z2.status === 200 && z2.dados.totalVotos === 0 && z2.dados.urnas.every((u) => u.liberacoes === 0), 'nova zerésima: votos e liberações zerados');
  await http('POST', '/api/admin/abrir');
  const chegou2 = esperarEvento(urnas[2], 'liberacao');
  await http('POST', '/api/mesario/liberar/2');
  const voto2 = await votar(urnas[2], { id: crypto.randomUUID(), token: (await chegou2).token, voto: '20' });
  await http('POST', '/api/admin/encerrar', {});
  const r2 = (await http('GET', '/api/resultado')).dados;
  conferir(voto2.ok && r2.geral.total === 1 && r2.geral.porChapa['20'] === 1 && r2.conferencia.situacao === 'ok' && r2.integridade.ok,
    'segunda eleição funciona do zero (1 voto, conferência e integridade OK)');

  for (const s of Object.values(urnas)) s.close();
  await desligarServidor();
}

principal()
  .catch((e) => { falhas++; console.error('\nERRO:', e); })
  .finally(() => {
    if (servidor && servidor.exitCode === null) servidor.kill('SIGKILL');
    try { fs.rmSync(pastaDados, { recursive: true, force: true }); } catch { /* Windows pode segurar o arquivo por instantes */ }
    console.log(falhas ? `\nRESULTADO: FALHOU (${falhas} problema(s))\n` : '\nRESULTADO: PASSOU — a contagem final bate exatamente.\n');
    process.exit(falhas ? 1 : 0);
  });
