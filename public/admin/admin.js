const $ = (id) => document.getElementById(id);
let estado = null;
let editando = null; // número da chapa em edição

function render() {
  const bloqueado = estado.status !== 'preparacao';
  document.body.classList.toggle('bloqueado', bloqueado);

  $('status').className = `selo ${estado.status}`;
  $('status').textContent = NOMES_STATUS[estado.status];
  const partes = [`Zerésima: ${estado.zeresimaEm ? 'emitida em ' + formatarDataHora(estado.zeresimaEm) : 'ainda não emitida'}`];
  if (estado.abertaEm) partes.push(`Abertura: ${formatarDataHora(estado.abertaEm)}`);
  if (estado.encerradaEm) partes.push(`Encerramento: ${formatarDataHora(estado.encerradaEm)}`);
  if (bloqueado) partes.push('Os dados e as chapas estão bloqueados porque a votação já foi aberta.');
  $('resumo').textContent = partes.join(' · ');

  $('btZeresima').disabled = bloqueado;
  $('btAbrir').disabled = bloqueado || !estado.zeresimaEm || estado.chapas.length === 0;
  $('btEncerrar').disabled = estado.status !== 'aberta';

  if (document.activeElement !== $('escola')) $('escola').value = estado.escola || '';
  if (document.activeElement !== $('eleicao')) $('eleicao').value = estado.eleicao || '';
  $('escola').disabled = $('eleicao').disabled = bloqueado;

  $('listaChapas').innerHTML = estado.chapas.length
    ? estado.chapas.map((c) => `
      <tr>
        <td>${c.foto ? `<img class="miniatura" src="${esc(c.foto)}" alt="">` : '<span class="suave">—</span>'}</td>
        <td class="numero-chapa">${esc(c.numero)}</td>
        <td>${esc(c.nome)}</td>
        <td class="editavel"><div class="acoes">
          <button type="button" class="secundario" data-editar="${esc(c.numero)}">Editar</button>
          <button type="button" class="perigo" data-excluir="${esc(c.numero)}">Excluir</button>
        </div></td>
      </tr>`).join('')
    : '<tr><td colspan="4" class="suave">Nenhuma chapa cadastrada.</td></tr>';
}

async function carregar() {
  estado = await api('GET', '/api/admin/estado');
  render();
}

async function executar(aviso, acao) {
  try {
    const r = await acao();
    if (r && r.chapas) { estado = r; render(); }
    return true;
  } catch (erro) {
    mostrarAviso(aviso, 'erro', erro.message);
    return false;
  }
}

// Reduz a imagem para no máximo 400px antes de enviar (computadores fracos agradecem).
function lerImagem(arquivo) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, 400 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * escala);
      canvas.height = Math.round(img.height * escala);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Não foi possível ler a imagem escolhida.'));
    img.src = URL.createObjectURL(arquivo);
  });
}

function limparFormChapa() {
  editando = null;
  $('formChapa').reset();
  $('numero').disabled = false;
  $('tituloChapa').textContent = 'Cadastrar nova chapa';
  $('btSalvarChapa').textContent = 'Cadastrar chapa';
  $('btCancelarEdicao').classList.add('oculto');
  $('rotuloRemover').classList.add('oculto');
}

$('formDados').addEventListener('submit', async (e) => {
  e.preventDefault();
  const ok = await executar($('avisoDados'), () => api('PUT', '/api/admin/dados', { escola: $('escola').value, eleicao: $('eleicao').value }));
  if (ok) mostrarAviso($('avisoDados'), 'ok', 'Dados salvos.');
});

$('formChapa').addEventListener('submit', async (e) => {
  e.preventDefault();
  const aviso = $('avisoChapa');
  const ok = await executar(aviso, async () => {
    const arquivo = $('foto').files[0];
    const corpo = { numero: $('numero').value.trim(), nome: $('nome').value };
    if (arquivo) corpo.foto = await lerImagem(arquivo);
    else if (editando && $('removerFoto').checked) corpo.foto = null;
    return editando
      ? api('PUT', `/api/admin/chapas/${editando}`, corpo)
      : api('POST', '/api/admin/chapas', corpo);
  });
  if (ok) {
    mostrarAviso(aviso, 'ok', editando ? 'Chapa atualizada.' : 'Chapa cadastrada.');
    limparFormChapa();
  }
});

$('btCancelarEdicao').addEventListener('click', limparFormChapa);

$('listaChapas').addEventListener('click', async (e) => {
  const numEditar = e.target.dataset.editar;
  const numExcluir = e.target.dataset.excluir;
  if (numEditar) {
    const c = estado.chapas.find((x) => x.numero === numEditar);
    editando = c.numero;
    $('numero').value = c.numero;
    $('numero').disabled = true;
    $('nome').value = c.nome;
    $('foto').value = '';
    $('removerFoto').checked = false;
    $('rotuloRemover').classList.toggle('oculto', !c.foto);
    $('tituloChapa').textContent = `Editar chapa ${c.numero}`;
    $('btSalvarChapa').textContent = 'Salvar alterações';
    $('btCancelarEdicao').classList.remove('oculto');
    $('nome').focus();
  }
  if (numExcluir && confirm(`Excluir a chapa ${numExcluir}?`)) {
    await executar($('avisoChapa'), () => api('DELETE', `/api/admin/chapas/${numExcluir}`));
    if (editando === numExcluir) limparFormChapa();
  }
});

$('btZeresima').addEventListener('click', () => window.open('/admin/zeresima', '_blank'));

$('btAbrir').addEventListener('click', async () => {
  if (!confirm('Abrir a votação agora?\n\nDepois de aberta, as chapas e os dados da eleição não poderão mais ser alterados.')) return;
  const ok = await executar($('avisoAndamento'), () => api('POST', '/api/admin/abrir'));
  if (ok) mostrarAviso($('avisoAndamento'), 'ok', 'Votação aberta. Use a tela do Mesário para liberar os votos.');
});

$('btEncerrar').addEventListener('click', async () => {
  if (!confirm('Encerrar a votação?\n\nNenhuma urna poderá receber novos votos depois disso.')) return;
  const aviso = $('avisoAndamento');
  try {
    estado = await api('POST', '/api/admin/encerrar', {});
  } catch (erro) {
    if (erro.status !== 409) return mostrarAviso(aviso, 'erro', erro.message);
    const forcar = confirm(`${erro.message}\n\nO ideal é esperar o eleitor terminar. Se ninguém vai usar essa liberação, ou se a urna está desligada, você pode encerrar assim mesmo: a liberação ficará registrada como "não utilizada" na ata.\n\nEncerrar mesmo assim?`);
    if (!forcar) return;
    if (!(await executar(aviso, async () => (estado = await api('POST', '/api/admin/encerrar', { forcar: true }))))) return;
  }
  render();
  mostrarAviso(aviso, 'ok', 'Votação encerrada. O resultado já pode ser visto na tela Resultado.');
});

window.addEventListener('focus', () => { if (estado) carregar(); });
exigirLogin(carregar);
