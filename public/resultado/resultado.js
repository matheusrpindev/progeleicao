const $ = (id) => document.getElementById(id);
const dataPorExtenso = (iso) => new Date(iso).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });

function tabelaBoletim(r, b) {
  const linhas = r.chapas.map((c) => `<tr><td>${esc(c.numero)} — ${esc(c.nome)}</td><td class="num">${b.porChapa[c.numero] || 0}</td></tr>`).join('');
  return `<table>
    <tbody>${linhas}
      <tr><td>Brancos</td><td class="num">${b.brancos}</td></tr>
      <tr><td>Nulos</td><td class="num">${b.nulos}</td></tr>
      <tr class="destaque"><td>Total</td><td class="num">${b.total}</td></tr>
    </tbody></table>`;
}

function blocoConferencia(c) {
  const marca = (ok) => (ok ? '<span class="marca-ok">✔ confere</span>' : '<span class="marca-erro">✘ NÃO confere</span>');
  return `<ul class="conferencia">
    <li>Soma dos boletins das urnas: <b>${c.somaBoletins}</b> · votos gravados no banco: <b>${c.totalGravado}</b> — ${marca(c.somaOk)}</li>
    <li>Votos gravados: <b>${c.totalGravado}</b> · liberações feitas pelo mesário: <b>${c.liberacoesEmitidas}</b> — ${marca(c.liberacoesOk)}</li>
  </ul>
  ${c.mensagens.map((m) => `<p><b>Observação:</b> ${esc(m)}</p>`).join('')}`;
}

function render(r) {
  const g = r.geral;
  const ranking = [...r.chapas].sort((a, b) => (g.porChapa[b.numero] || 0) - (g.porChapa[a.numero] || 0) || a.numero.localeCompare(b.numero));

  $('ata').innerHTML = `
    <header>
      <p class="escola">${esc(r.escola || 'Escola')}</p>
      <h1>ATA DE APURAÇÃO</h1>
      <p class="subtitulo">${esc(r.eleicao || 'Eleição do Grêmio Estudantil')}</p>
    </header>
    <p>Em ${dataPorExtenso(r.abertaEm)}, na ${esc(r.escola || 'escola')}, realizou-se a ${esc(r.eleicao || 'eleição do Grêmio Estudantil')},
      por meio de votação eletrônica em ${r.boletins.length} urnas. A zerésima foi emitida às ${formatarHora(r.zeresimaEm)},
      comprovando que as urnas não continham votos. A votação foi <b>aberta às ${formatarHora(r.abertaEm)}</b>
      e <b>encerrada às ${formatarHora(r.encerradaEm)}</b>${formatarData(r.abertaEm) !== formatarData(r.encerradaEm) ? ` do dia ${formatarData(r.encerradaEm)}` : ''}.
      Encerrada a votação, os boletins das urnas apresentaram o resultado a seguir.</p>

    <h2>Resultado geral</h2>
    <table>
      <thead><tr><th>Número</th><th>Chapa</th><th class="num">Votos</th></tr></thead>
      <tbody>
        ${ranking.map((c) => `<tr><td>${esc(c.numero)}</td><td>${esc(c.nome)}</td><td class="num">${g.porChapa[c.numero] || 0}</td></tr>`).join('')}
        <tr><td colspan="2">Votos válidos (em chapas)</td><td class="num">${g.validos}</td></tr>
        <tr><td colspan="2">Votos em branco</td><td class="num">${g.brancos}</td></tr>
        <tr><td colspan="2">Votos nulos</td><td class="num">${g.nulos}</td></tr>
        <tr class="destaque"><td colspan="2">Total de votantes</td><td class="num">${g.total}</td></tr>
      </tbody>
    </table>

    <h2>Boletins por urna</h2>
    <div class="boletins">
      ${r.boletins.map((b) => `<div><h3>Urna ${b.urna}</h3>${tabelaBoletim(r, b)}</div>`).join('')}
    </div>

    <h2>Conferência</h2>
    ${blocoConferencia(r.conferencia)}

    <h2>Integridade dos votos</h2>
    <p>${r.integridade.ok ? 'INTEGRIDADE OK' : 'ATENÇÃO: BANCO ADULTERADO'} — ${esc(r.integridade.mensagem)}</p>
    <p class="hash">Hash final da cadeia de votos (${r.integridade.total} votos): <code>${esc(r.integridade.hashFinal || '—')}</code></p>

    <p>Nada mais havendo a tratar, foi lavrada a presente ata, que vai assinada pelos membros da mesa e pelos fiscais presentes.</p>
    <section class="assinaturas">
      <div><span></span>Presidente da Comissão Eleitoral</div>
      <div><span></span>Mesário</div>
      ${r.chapas.map((c) => `<div><span></span>Fiscal da chapa ${esc(c.numero)} — ${esc(c.nome)}</div>`).join('')}
    </section>
    <p class="hash">Documento gerado em ${formatarDataHora(r.geradoEm)}.</p>`;

  const c = r.conferencia;
  const tipo = c.situacao === 'ok' ? 'ok' : c.situacao === 'pendente' ? 'atencao' : 'erro';
  $('conferenciaTela').innerHTML = `<div class="aviso ${tipo}">${c.situacao === 'ok'
    ? 'Conferência OK: a soma dos boletins bate com o total geral e com o número de liberações do mesário.'
    : c.mensagens.map(esc).join('<br>')}</div>`;
  renderIntegridade(r.integridade);
}

function renderIntegridade(i) {
  $('integridadeTela').innerHTML = `<div class="aviso ${i.ok ? 'ok' : 'erro'}"><b>${i.ok ? 'Integridade OK' : 'ADULTERADO'}</b> — ${esc(i.mensagem)}</div>`;
}

async function carregar() {
  try {
    render(await api('GET', '/api/resultado'));
    $('painel').classList.remove('oculto');
    $('aviso').classList.add('oculto');
  } catch (erro) {
    $('painel').classList.add('oculto');
    mostrarAviso($('aviso'), erro.status === 403 ? 'atencao' : 'erro', erro.message);
  }
}

$('btIntegridade').addEventListener('click', async () => {
  $('integridadeTela').innerHTML = '<div class="aviso">Verificando…</div>';
  try {
    renderIntegridade(await api('GET', '/api/resultado/integridade'));
  } catch (erro) {
    mostrarAviso($('integridadeTela'), 'erro', erro.message);
  }
});
$('btAtualizar').addEventListener('click', carregar);

exigirLogin(carregar);
