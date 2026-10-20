const $ = (id) => document.getElementById(id);

const ROTULOS = {
  desconectada: 'Desconectada',
  livre: 'Livre',
  aguardando: 'Aguardando eleitor',
  votando: 'Votando',
};

let ultimoPainel = null;

function render(painel) {
  ultimoPainel = painel;
  $('status').className = `selo ${painel.statusVotacao}`;
  $('status').textContent = NOMES_STATUS[painel.statusVotacao];
  $('total').textContent = painel.totalVotantes;
  const aberta = painel.statusVotacao === 'aberta';

  if (!painel.urnas.length) {
    $('urnas').innerHTML = '<p>Nenhuma urna cadastrada. Adicione as urnas na tela <a href="/admin">Admin</a>.</p>';
    return;
  }
  $('urnas').innerHTML = painel.urnas.map((u) => {
    if (!u.vinculada) {
      return `
        <div class="urna desconectada">
          <h2>Urna ${u.urna}</h2>
          <div class="estado">Sem computador</div>
          <div class="votos">No computador desta urna, abra o endereço das urnas e digite o código:</div>
          <div class="codigo">${esc(u.codigo)}</div>
          <div class="votos">${u.votos} votos recebidos</div>
        </div>`;
    }
    const podeLiberar = aberta && u.status === 'livre';
    let detalhe = '';
    if (u.status === 'desconectada' && u.liberada) detalhe = '<div class="votos">(estava liberada; a liberação será retomada quando ela voltar)</div>';
    return `
      <div class="urna ${u.status}">
        <h2>Urna ${u.urna}</h2>
        <div class="estado">${ROTULOS[u.status]}</div>
        ${detalhe}
        <div class="votos"><b>${u.votos}</b>votos recebidos</div>
        ${u.liberadasNaUrna ? `<div class="votos">${u.liberadasNaUrna} liberada(s) na própria urna</div>` : ''}
        <button type="button" class="sucesso" data-urna="${u.urna}" ${podeLiberar ? '' : 'disabled'}>Liberar voto</button>
        <button type="button" class="trocar" data-trocar="${u.urna}">Trocar computador</button>
      </div>`;
  }).join('');
}

$('urnas').addEventListener('click', async (e) => {
  const trocar = e.target.dataset.trocar;
  if (trocar) {
    if (!confirm(`Trocar o computador da urna ${trocar}?\n\nO computador atual deixa de funcionar como urna e aparece um código novo para vincular outro.\n\nSe a urna estava desconectada com algum voto guardado, esse voto só será enviado se o computador antigo for vinculado de novo a esta mesma urna.`)) return;
    try {
      await api('POST', `/api/admin/urnas/${trocar}/desvincular`);
    } catch (erro) {
      mostrarAviso($('aviso'), 'erro', erro.message);
    }
    return;
  }
  const urna = e.target.dataset.urna;
  if (!urna) return;
  e.target.disabled = true;
  liberar(urna);
});

async function liberar(urna) {
  try {
    await api('POST', `/api/mesario/liberar/${urna}`);
    $('aviso').classList.add('oculto');
    $('liberada').textContent = `URNA ${urna} LIBERADA`;
    $('liberada').classList.remove('oculto');
    clearTimeout(liberar.timer);
    liberar.timer = setTimeout(() => $('liberada').classList.add('oculto'), 4000);
  } catch (erro) {
    mostrarAviso($('aviso'), 'erro', erro.message);
  }
}

/*
 * Atalho: a tecla " (aspas) libera a próxima urna livre (a de menor número).
 * No teclado ABNT2 é a tecla abaixo do Esc; sem Shift ela dá ' e também vale.
 * Teclados com acentuação "internacional" mandam essa tecla como "Dead".
 * Uma pausa de 1 s evita liberar duas urnas com um toque duplo sem querer.
 */
let atalhoLivreEm = 0;
document.addEventListener('keydown', (e) => {
  const aspas = e.key === '"' || e.key === "'" || (e.key === 'Dead' && (e.code === 'Quote' || e.code === 'Backquote'));
  if (!aspas || e.repeat || e.ctrlKey || e.altKey || e.target.closest?.('input, textarea')) return;
  e.preventDefault();
  if (!ultimoPainel || Date.now() < atalhoLivreEm) return;
  atalhoLivreEm = Date.now() + 1000;
  if (ultimoPainel.statusVotacao !== 'aberta') return mostrarAviso($('aviso'), 'erro', 'A votação não está aberta.');
  const livre = ultimoPainel.urnas.find((u) => u.vinculada && u.status === 'livre');
  if (!livre) return mostrarAviso($('aviso'), 'atencao', 'Nenhuma urna livre no momento. Aguarde um eleitor terminar.');
  liberar(livre.urna);
});

function conectar() {
  const socket = io({ query: { tipo: 'mesario' } });
  socket.on('connect', () => {
    $('conexao').textContent = '● Conectado';
    $('conexao').classList.remove('off');
  });
  socket.on('disconnect', (motivo) => {
    // O servidor recusou a sessão (ex.: foi reiniciado): recarrega para pedir a senha de novo.
    if (motivo === 'io server disconnect') return location.reload();
    $('conexao').textContent = '● Sem conexão com o servidor';
    $('conexao').classList.add('off');
  });
  socket.on('painel', render);
}

exigirLogin(conectar);
