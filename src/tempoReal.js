const { Server } = require('socket.io');

const salaUrna = (urna) => `urna:${urna}`;
const SALA_MESARIO = 'mesario';

function criarTempoReal(servidorHttp, { auth, eleicao, urnas, votos, backup }) {
  // serveClient: o próprio servidor entrega /socket.io/socket.io.js (funciona offline).
  const io = new Server(servidorHttp, { serveClient: true, pingInterval: 5000, pingTimeout: 5000 });

  const enviarPainel = () => io.to(SALA_MESARIO).emit('painel', urnas.painel());
  const sincronizarUrna = (urna) => io.to(salaUrna(urna)).emit('sincronizar', { estado: eleicao.estado(), pendente: urnas.pendente(urna) });

  io.on('connection', (socket) => {
    const { tipo } = socket.handshake.query;

    if (tipo === 'mesario') {
      if (!auth.autenticado(socket.handshake.headers.cookie)) return socket.disconnect(true);
      socket.join(SALA_MESARIO);
      socket.emit('painel', urnas.painel());
      return;
    }

    if (tipo !== 'urna') return socket.disconnect(true);
    // Só o computador vinculado (que tem o token daquela urna) entra.
    const urna = Number(socket.handshake.auth?.urna);
    if (!urnas.dispositivoValido(urna, socket.handshake.auth?.token)) {
      socket.emit('desvinculada');
      return socket.disconnect(true);
    }

    const substituido = urnas.conectar(urna, socket.id);
    if (substituido) {
      io.to(substituido).emit('substituida');
      io.in(substituido).disconnectSockets(true);
    }
    socket.join(salaUrna(urna));
    sincronizarUrna(urna);
    enviarPainel();

    // Tecla " na tela "Aguardando liberação" da própria urna.
    socket.on('liberar-aqui', (responder) => {
      if (typeof responder !== 'function') return;
      try {
        const token = urnas.liberar(urna, { naUrna: true });
        io.to(salaUrna(urna)).emit('liberacao', { token });
        enviarPainel();
        responder({ ok: true });
      } catch (e) {
        responder({ ok: false, erro: e.message });
      }
    });

    socket.on('estado-urna', (estado) => {
      urnas.informarEstado(urna, socket.id, estado);
      enviarPainel();
    });

    socket.on('voto', (dados, responder) => {
      if (typeof responder !== 'function') return;
      let r;
      try {
        r = votos.registrar({ id: dados?.id, urna, token: dados?.token, voto: dados?.voto });
      } catch (e) {
        console.error('Erro ao gravar voto:', e.message);
        return responder({ ok: false, erro: 'interno', tentarDeNovo: true });
      }
      if (r.ok && !r.duplicado) {
        backup.marcarAlteracao();
        enviarPainel();
      }
      responder(r);
    });

    socket.on('disconnect', () => {
      urnas.desconectar(urna, socket.id);
      enviarPainel();
    });
  });

  return {
    estadoMudou() {
      io.emit('estado', eleicao.estado());
      enviarPainel();
    },
    painelMudou: enviarPainel,
    // O computador da urna deixou de ser aceito (urna desvinculada ou removida).
    urnaDesvinculada(urna) {
      io.to(salaUrna(urna)).emit('desvinculada');
      io.in(salaUrna(urna)).disconnectSockets(true);
      enviarPainel();
    },
    liberacaoEmitida(urna, token) {
      io.to(salaUrna(urna)).emit('liberacao', { token });
      enviarPainel();
    },
  };
}

module.exports = { criarTempoReal };
