const $ = (id) => document.getElementById(id);

const ROTULOS = {
  desconectada: 'Desconectada',
  livre: 'Livre',
  aguardando: 'Aguardando eleitor',
  votando: 'Votando',
};

function render(painel) {
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
  try {
    await api('POST', `/api/mesario/liberar/${urna}`);
    $('aviso').classList.add('oculto');
  } catch (erro) {
    mostrarAviso($('aviso'), 'erro', erro.message);
  }
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
