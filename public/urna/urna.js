/*
 * Urna. O servidor é a fonte da verdade sobre a liberação pendente; o
 * localStorage guarda o token da liberação atual e a FILA de votos ainda
 * não confirmados pelo servidor, para que nada se perca em quedas de rede
 * ou recarregamentos da página.
 */
const URNA = Number(new URLSearchParams(location.search).get('id'));
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
  tela: 'bloqueada', // bloqueada | votacao | fim
  mensagem: 'Conectando ao servidor…',
  erroFatal: null,   // urna substituída ou endereço inválido: não volta sozinha
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

// ---------- Som (Web Audio, sem arquivos) ----------
let audio = null;
function tom(freq, inicio, duracao, volume = 0.2) {
  if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
  if (audio.state === 'suspended') audio.resume();
  const t = audio.currentTime + inicio;
  const osc = audio.createOscillator();
  const ganho = audio.createGain();
  osc.type = 'square';
  osc.frequency.value = freq;
  ganho.gain.setValueAtTime(volume, t);
  ganho.gain.setValueAtTime(0, t + duracao);
  osc.connect(ganho).connect(audio.destination);
  osc.start(t);
  osc.stop(t + duracao + 0.02);
}
const somTecla = () => tom(1200, 0, 0.07, 0.12);
function somConfirma() {
  [0, 0.12, 0.24, 0.36].forEach((t) => tom(1050, t, 0.08));
  tom(1050, 0.48, 0.7);
}

// ---------- Desenho da tela ----------
function chapaDigitada() {
  return s.digitos.length === 2 ? s.estado?.chapas.find((c) => c.numero === s.digitos) : null;
}

function render() {
  $('vistaBloqueada').classList.toggle('oculto', s.tela !== 'bloqueada');
  $('vistaVotacao').classList.toggle('oculto', s.tela !== 'votacao');
  $('vistaFim').classList.toggle('oculto', s.tela !== 'fim');
  $('teclado').classList.toggle('inativo', s.tela !== 'votacao');
  $('numeroUrna').textContent = `Urna ${URNA || '?'}`;
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

  const online = socket.connected;
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
  if (estado !== ultimoInformado && socket.connected) {
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

// ---------- Teclas ----------
function tecla(t) {
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
  if (enviando || !socket.connected) return;
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
const socket = io({ query: { tipo: 'urna', urna: String(URNA) } });

function aplicarEstado(estado) {
  s.estado = estado;
  guardarFotos(estado.chapas);
  if (estado.status !== 'aberta') salvarToken(null);
  aplicarLiberacao();
  render();
}

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

socket.on('substituida', () => {
  s.erroFatal = 'Esta urna foi aberta em outro computador ou aba. Feche esta janela.';
});

socket.on('disconnect', (motivo) => {
  // Só o servidor encerra a conexão de propósito: urna substituída ou número inválido.
  if (motivo === 'io server disconnect') {
    s.erroFatal = s.erroFatal || 'Endereço de urna inválido. Use /urna?id=1 até /urna?id=4.';
    if (s.tela === 'votacao') irPara('bloqueada');
  }
  render();
});

render();
