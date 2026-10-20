/*
 * Urna. O servidor é a fonte da verdade sobre a liberação pendente; o
 * localStorage guarda o token da liberação atual e a FILA de votos ainda
 * não confirmados pelo servidor, para que nada se perca em quedas de rede
 * ou recarregamentos da página.
 */
// Vínculo deste computador com uma urna: { urna, token }, obtido digitando o
// código mostrado ao mesário. Sem ele, a urna mostra a tela de vínculo.
const CHAVE_VINCULO = 'urna:vinculo';
const vinculo = JSON.parse(localStorage.getItem(CHAVE_VINCULO) || 'null');
const URNA = vinculo?.urna || 0;
const CHAVE_TOKEN = `urna${URNA}:token`;
const CHAVE_FILA = `urna${URNA}:fila`;
const TEMPO_FIM_MS = 3000;
const $ = (id) => document.getElementById(id);

const s = {
  estado: null,      // dados da eleição (status, chapas...)
  token: localStorage.getItem(CHAVE_TOKEN),
  fila: JSON.parse(localStorage.getItem(CHAVE_FILA) || '[]'),
  digitos: '',
  branco: false,
  tela: vinculo ? 'bloqueada' : 'vinculo', // vinculo | bloqueada | votacao | fim
  mensagem: 'Conectando ao servidor…',
  erroFatal: null,   // urna aberta em outra aba: não volta sozinha
  codigo: '',        // código de vínculo sendo digitado
  avisoVinculo: '',
};
const fotos = {};    // numero -> { origem, url } com cópia local (blob) da foto, para funcionar mesmo offline

// ---------- Persistência ----------
function salvarToken(token) {
  s.token = token;
  if (token) localStorage.setItem(CHAVE_TOKEN, token);
  else localStorage.removeItem(CHAVE_TOKEN);
}
const salvarFila = () => localStorage.setItem(CHAVE_FILA, JSON.stringify(s.fila));

// UUID v4 com crypto.getRandomValues (crypto.randomUUID não existe em http:// fora do localhost).
function gerarUuid() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---------- Som ----------
/*
 * Por padrão os sons são sintetizados (Web Audio, sem arquivos) com as mesmas
 * frequências e tempos da urna: um "bip" curto a cada tecla e o "pililili" ao
 * confirmar. Para ter o som idêntico ao original, coloque
 * gravações em public/urna/sons/tecla.mp3 e public/urna/sons/confirma.mp3:
 * se existirem, elas são usadas no lugar da síntese.
 */
let audio = null;
const gravacoes = {}; // nome -> ArrayBuffer baixado, depois promessa do áudio decodificado
for (const nome of ['tecla', 'confirma']) {
  fetch(`/urna/sons/${nome}.mp3`)
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .then((dados) => { if (dados) gravacoes[nome] = dados; })
    .catch(() => {});
}

/*
 * Medidas tiradas de gravações da urna eletrônica (análise de espectro):
 * tom puro (senoide); a confirmação alterna 2306 Hz e 2206 Hz a cada ~97 ms
 * por 0,70 s, e a tecla é um bip de 2306 Hz com ~20 ms.
 * Cada som é uma lista de trechos [frequência Hz, duração s] tocados em sequência.
 */
const AGUDO = 2306;
const GRAVE = 2206;
const NOTAS_TECLA = [[AGUDO, 0.022]];
const NOTAS_CONFIRMA = [[AGUDO, 0.025], ...Array.from({ length: 7 }, (_, i) => [i % 2 ? AGUDO : GRAVE, 0.0967])];

// Um único oscilador que muda de frequência sem cortar a onda, como na urna.
function agendarNotas(ctx, notas, volume = 0.3) {
  const inicio = ctx.currentTime + 0.01;
  const total = notas.reduce((soma, [, duracao]) => soma + duracao, 0);
  const osc = ctx.createOscillator();
  const ganho = ctx.createGain();
  osc.type = 'sine';
  let t = inicio;
  for (const [freq, duracao] of notas) {
    osc.frequency.setValueAtTime(freq, t);
    t += duracao;
  }
  const saida = Math.min(0.04, total / 4); // final suave (~40 ms no "pililili")
  ganho.gain.setValueAtTime(0, inicio);
  ganho.gain.linearRampToValueAtTime(volume, inicio + 0.003);
  ganho.gain.setValueAtTime(volume, inicio + total - saida);
  ganho.gain.linearRampToValueAtTime(0, inicio + total);
  osc.connect(ganho).connect(ctx.destination);
  osc.start(inicio);
  osc.stop(inicio + total + 0.02);
}

async function tocar(nome, notas) {
  if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
  if (audio.state === 'suspended') audio.resume();
  // Decodifica uma vez só (guarda a promessa, para toques seguidos não decodificarem em dobro).
  if (gravacoes[nome] instanceof ArrayBuffer) gravacoes[nome] = audio.decodeAudioData(gravacoes[nome]).catch(() => null);
  const gravacao = await gravacoes[nome];
  if (!gravacao) return agendarNotas(audio, notas);
  const fonte = audio.createBufferSource();
  fonte.buffer = gravacao;
  fonte.connect(audio.destination);
  fonte.start();
}
const somTecla = () => tocar('tecla', NOTAS_TECLA);
const somConfirma = () => tocar('confirma', NOTAS_CONFIRMA);

// ---------- Desenho da tela ----------
function chapaDigitada() {
  return s.digitos.length === 2 ? s.estado?.chapas.find((c) => c.numero === s.digitos) : null;
}

function render() {
  $('vistaBloqueada').classList.toggle('oculto', s.tela !== 'bloqueada');
  $('vistaVotacao').classList.toggle('oculto', s.tela !== 'votacao');
  $('vistaFim').classList.toggle('oculto', s.tela !== 'fim');
  $('vistaVinculo').classList.toggle('oculto', s.tela !== 'vinculo');
  $('teclado').classList.toggle('inativo', s.tela !== 'votacao' && s.tela !== 'vinculo');
  $('numeroUrna').textContent = `Urna ${URNA}`;

  if (s.tela === 'vinculo') {
    for (let i = 0; i < 6; i++) {
      $(`c${i}`).textContent = s.codigo[i] || '';
      $(`c${i}`).classList.toggle('cursor', i === s.codigo.length);
    }
    $('avisoVinculo').textContent = s.avisoVinculo;
  }
  $('mensagemBloqueio').textContent = s.erroFatal || s.mensagem;

  if (s.tela === 'votacao') {
    for (let i = 0; i < 2; i++) {
      const d = $(`d${i}`);
      d.textContent = s.digitos[i] || '';
      d.classList.toggle('cursor', !s.branco && i === s.digitos.length);
    }
    const completo = s.digitos.length === 2;
    const chapa = chapaDigitada();
    $('linhaNome').classList.toggle('oculto', !chapa);
    $('nomeChapa').textContent = chapa ? chapa.nome : '';
    $('caixaFoto').classList.toggle('oculto', !(chapa && chapa.foto));
    if (chapa && chapa.foto) $('fotoChapa').src = fotos[chapa.numero]?.url || chapa.foto;
    $('avisoErrado').classList.toggle('oculto', !(completo && !chapa));
    $('avisoNulo').classList.toggle('oculto', !(completo && !chapa));
    $('avisoBranco').classList.toggle('oculto', !s.branco);
    $('instrucoes').classList.toggle('oculto', !(completo || s.branco));
  }

  const online = Boolean(socket?.connected);
  $('conexao').classList.toggle('oculto', s.tela === 'vinculo');
  $('conexao').textContent = (online ? 'online' : 'offline') + (s.fila.length ? ` · ${s.fila.length} voto(s) aguardando envio` : '');
  $('conexao').classList.toggle('off', !online);
}

function mensagemBloqueio() {
  const status = s.estado?.status;
  if (status === 'preparacao') return 'A votação ainda não foi aberta';
  if (status === 'encerrada') return 'Votação encerrada';
  return 'Aguardando liberação do mesário';
}

// Estado enviado ao mesário: livre | aguardando | votando (nunca o voto).
let ultimoInformado = null;
function informarEstado() {
  let estado = 'livre';
  if (s.tela === 'votacao') estado = s.digitos || s.branco ? 'votando' : 'aguardando';
  if (estado !== ultimoInformado && socket?.connected) {
    socket.emit('estado-urna', estado);
    ultimoInformado = estado;
  }
}

function irPara(tela) {
  s.tela = tela;
  s.digitos = '';
  s.branco = false;
  if (tela === 'bloqueada') s.mensagem = mensagemBloqueio();
  render();
  informarEstado();
}

// Abre a votação se houver liberação válida; senão, bloqueia.
function aplicarLiberacao() {
  if (s.tela === 'fim') return; // decide quando o FIM terminar
  if (s.token && s.estado?.status === 'aberta' && !s.erroFatal) {
    if (s.tela !== 'votacao') irPara('votacao');
  } else if (s.tela !== 'bloqueada' || s.mensagem !== mensagemBloqueio()) {
    irPara('bloqueada');
  }
}

// ---------- Vínculo ----------
// Votos guardados neste computador que ainda não foram enviados (de qualquer urna).
function votosGuardados() {
  const guardados = [];
  for (let i = 0; i < localStorage.length; i++) {
    const m = /^urna(\d+):fila$/.exec(localStorage.key(i));
    const n = m ? JSON.parse(localStorage.getItem(m[0]) || '[]').length : 0;
    if (n) guardados.push(`${n} da urna ${m[1]}`);
  }
  return guardados.length ? ` Há votos guardados neste computador (${guardados.join(', ')}): vincule-o de novo à mesma urna para enviá-los.` : '';
}

function teclaVinculo(t) {
  if (/^\d$/.test(t) && s.codigo.length < 6) s.codigo += t;
  else if (t === 'corrige') s.codigo = '';
  else if (t === 'confirma' && s.codigo.length === 6) return vincularComputador();
  render();
}

async function vincularComputador() {
  try {
    const resp = await fetch('/api/urna/vincular', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo: s.codigo }),
    });
    const dados = await resp.json();
    if (!resp.ok) throw new Error(dados.erro || 'Não foi possível vincular.');
    localStorage.setItem(CHAVE_VINCULO, JSON.stringify(dados));
    location.reload();
  } catch (erro) {
    s.codigo = '';
    s.avisoVinculo = erro.message === 'Failed to fetch' ? 'Sem conexão com o servidor. Confira a rede e tente de novo.' : erro.message;
    render();
  }
}

// ---------- Teclas ----------
function tecla(t) {
  if (s.tela === 'vinculo') {
    somTecla();
    return teclaVinculo(t);
  }
  if (s.tela !== 'votacao') return;
  somTecla();
  if (/^\d$/.test(t)) {
    if (s.branco || s.digitos.length >= 2) return;
    s.digitos += t;
  } else if (t === 'branco') {
    if (s.digitos) return; // como na urna real: é preciso CORRIGIR antes
    s.branco = true;
  } else if (t === 'corrige') {
    s.digitos = '';
    s.branco = false;
  } else if (t === 'confirma') {
    if (s.digitos.length === 2 || s.branco) return confirmar();
    return;
  }
  render();
  informarEstado();
}

function confirmar() {
  // Grava o voto na fila ANTES de qualquer envio: se a rede ou a página cair, ele não se perde.
  const voto = { id: gerarUuid(), token: s.token, voto: s.branco ? 'BRANCO' : s.digitos };
  s.fila.push(voto);
  salvarFila();
  salvarToken(null);
  somConfirma();
  irPara('fim');
  enviarFila();
  setTimeout(() => {
    s.tela = 'bloqueada';
    s.mensagem = mensagemBloqueio();
    aplicarLiberacao();
    render();
    informarEstado();
  }, TEMPO_FIM_MS);
}

document.getElementById('teclado').addEventListener('pointerdown', (e) => {
  const botao = e.target.closest('button');
  if (botao) {
    e.preventDefault();
    tecla(botao.dataset.tecla);
  }
});

const TECLAS_FISICAS = { Enter: 'confirma', NumpadEnter: 'confirma', Backspace: 'corrige', Delete: 'corrige', Escape: 'corrige', b: 'branco', B: 'branco' };
document.addEventListener('keydown', (e) => {
  if (e.key === 'F5' || e.ctrlKey || e.altKey || e.metaKey) return;
  e.preventDefault();
  if (e.repeat) return;
  const t = /^\d$/.test(e.key) ? e.key : TECLAS_FISICAS[e.key];
  if (!t) return;
  const botao = document.querySelector(`[data-tecla="${t}"]`);
  botao.classList.add('apertada');
  setTimeout(() => botao.classList.remove('apertada'), 120);
  tecla(t);
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- Envio dos votos (com reenvio e idempotência) ----------
let enviando = false;
let retentativa = null;
async function enviarFila() {
  if (enviando || !socket?.connected) return;
  enviando = true;
  try {
    while (s.fila.length && socket.connected) {
      const item = s.fila[0];
      let resp;
      try {
        resp = await socket.timeout(5000).emitWithAck('voto', item);
      } catch {
        break; // sem resposta: tenta de novo depois (o servidor ignora repetidos)
      }
      if (!resp.ok && resp.tentarDeNovo) break;
      if (!resp.ok) console.error('Voto recusado pelo servidor:', resp.erro, item.id);
      s.fila = s.fila.filter((v) => v.id !== item.id);
      salvarFila();
      render();
    }
  } finally {
    enviando = false;
  }
  clearTimeout(retentativa);
  if (s.fila.length) retentativa = setTimeout(enviarFila, 3000);
}

// ---------- Fotos guardadas localmente ----------
async function guardarFotos(chapas) {
  for (const c of chapas) {
    if (!c.foto || fotos[c.numero]?.origem === c.foto) continue;
    try {
      const blob = await (await fetch(c.foto)).blob();
      fotos[c.numero] = { origem: c.foto, url: URL.createObjectURL(blob) };
    } catch { /* tenta de novo na próxima atualização */ }
  }
}

// ---------- Conexão ----------
// Só o computador vinculado conecta; o servidor confere o token.
const socket = vinculo ? io({ query: { tipo: 'urna' }, auth: { urna: vinculo.urna, token: vinculo.token } }) : null;

function aplicarEstado(estado) {
  s.estado = estado;
  guardarFotos(estado.chapas);
  if (estado.status !== 'aberta') salvarToken(null);
  aplicarLiberacao();
  render();
}

if (socket) {
  socket.on('connect', () => {
    ultimoInformado = null;
    render();
  });

  socket.on('sincronizar', ({ estado, pendente }) => {
    s.estado = estado;
    // Se o voto dessa liberação já está na fila, a urna fica bloqueada até enviá-lo.
    const jaVotado = pendente && s.fila.some((v) => v.token === pendente);
    salvarToken(pendente && !jaVotado && estado.status === 'aberta' ? pendente : null);
    aplicarEstado(estado);
    informarEstado();
    enviarFila();
  });

  socket.on('estado', aplicarEstado);

  socket.on('liberacao', ({ token }) => {
    if (s.estado?.status !== 'aberta') return;
    salvarToken(token);
    aplicarLiberacao();
    informarEstado();
  });

  // O mesário trocou o computador desta urna (ou ela foi removida): volta para a
  // tela de vínculo. A fila de votos não enviados fica guardada.
  socket.on('desvinculada', () => {
    localStorage.removeItem(CHAVE_VINCULO);
    localStorage.removeItem(CHAVE_TOKEN);
    sessionStorage.setItem('urna:aviso', `Este computador não está mais vinculado à urna ${URNA}.`);
    location.reload();
  });

  socket.on('substituida', () => {
    s.erroFatal = 'Esta urna foi aberta em outra aba deste computador. Feche esta janela.';
  });

  socket.on('disconnect', (motivo) => {
    if (motivo === 'io server disconnect' && s.tela === 'votacao') irPara('bloqueada');
    render();
  });
} else {
  s.avisoVinculo = (sessionStorage.getItem('urna:aviso') || '') + votosGuardados();
  sessionStorage.removeItem('urna:aviso');
}

render();
