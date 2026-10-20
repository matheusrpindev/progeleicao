function criarApuracao(db, eleicao, votos) {
  function apurar() {
    const est = eleicao.estado();
    const chapas = est.chapas.map(({ numero, nome }) => ({ numero, nome }));
    const contagem = db.prepare('SELECT urna, escolha, COUNT(*) AS n FROM votos GROUP BY urna, escolha').all();
    const liberacoes = db.prepare('SELECT urna, emitidas, pendente FROM liberacoes ORDER BY urna').all();

    const boletimVazio = () => ({ porChapa: Object.fromEntries(chapas.map((c) => [c.numero, 0])), brancos: 0, nulos: 0, total: 0 });
    const boletins = liberacoes.map((l) => ({ urna: l.urna, ...boletimVazio(), liberacoes: l.emitidas, liberacaoPendente: Boolean(l.pendente) }));
    for (const { urna, escolha, n } of contagem) {
      const b = boletins.find((x) => x.urna === urna);
      if (!b) continue;
      if (escolha === 'BRANCO') b.brancos += n;
      else if (escolha === 'NULO') b.nulos += n;
      else b.porChapa[escolha] = (b.porChapa[escolha] || 0) + n;
      b.total += n;
    }

    // Total geral = soma dos boletins.
    const geral = boletimVazio();
    for (const b of boletins) {
      for (const [numero, n] of Object.entries(b.porChapa)) geral.porChapa[numero] = (geral.porChapa[numero] || 0) + n;
      geral.brancos += b.brancos;
      geral.nulos += b.nulos;
      geral.total += b.total;
    }
    geral.validos = geral.total - geral.brancos - geral.nulos;

    // Vencedora: a chapa com mais votos; brancos e nulos não contam.
    // Mais de uma com o mesmo máximo = empate (resolvido pelo regulamento).
    const maximo = Math.max(0, ...chapas.map((c) => geral.porChapa[c.numero] || 0));
    const vencedoras = maximo > 0 ? chapas.filter((c) => (geral.porChapa[c.numero] || 0) === maximo) : [];
    const vencedor = {
      chapas: vencedoras,
      votos: maximo,
      votosValidos: geral.validos,
      percentualValidos: geral.validos ? Math.round((maximo / geral.validos) * 1000) / 10 : 0,
      empate: vencedoras.length > 1,
    };

    // Conferência: soma dos boletins x contagem direta do banco x liberações do mesário.
    const totalGravado = db.prepare('SELECT COUNT(*) AS n FROM votos').get().n;
    const liberacoesEmitidas = liberacoes.reduce((s, l) => s + l.emitidas, 0);
    const urnasPendentes = liberacoes.filter((l) => l.pendente).map((l) => l.urna);
    const somaPorChapa = Object.values(geral.porChapa).reduce((s, n) => s + n, 0) + geral.brancos + geral.nulos;
    const somaOk = somaPorChapa === geral.total && geral.total === totalGravado;
    const liberacoesOk = totalGravado === liberacoesEmitidas;
    const mensagens = [];
    let situacao = 'ok';
    if (!somaOk) {
      situacao = 'divergente';
      mensagens.push(`A soma dos boletins (${geral.total}) não confere com o total de votos gravados (${totalGravado}).`);
    }
    if (!liberacoesOk) {
      const explicado = totalGravado === liberacoesEmitidas - urnasPendentes.length;
      if (explicado && situacao === 'ok') situacao = 'pendente';
      else situacao = 'divergente';
      mensagens.push(explicado
        ? `Há ${urnasPendentes.length} liberação(ões) sem voto registrado (urna ${urnasPendentes.join(', ')}). Se essa urna ficou desconectada, ligue-a de novo na rede: votos guardados nela serão enviados automaticamente e a conferência será refeita.`
        : `O total de votos (${totalGravado}) não confere com o número de liberações do mesário (${liberacoesEmitidas}).`);
    }

    return {
      escola: est.escola,
      eleicao: est.eleicao,
      status: est.status,
      zeresimaEm: est.zeresimaEm,
      abertaEm: est.abertaEm,
      encerradaEm: est.encerradaEm,
      geradoEm: new Date().toISOString(),
      chapas,
      boletins,
      geral,
      vencedor,
      conferencia: { somaBoletins: geral.total, totalGravado, liberacoesEmitidas, urnasPendentes, somaOk, liberacoesOk, situacao, mensagens },
      integridade: votos.verificarIntegridade(),
    };
  }

  function csv(r) {
    const linhas = [['Urna', 'Número', 'Opção', 'Votos']];
    const nome = Object.fromEntries(r.chapas.map((c) => [c.numero, c.nome]));
    const adicionar = (rotulo, b) => {
      for (const [numero, n] of Object.entries(b.porChapa)) linhas.push([rotulo, numero, nome[numero] || '', n]);
      linhas.push([rotulo, '', 'BRANCO', b.brancos], [rotulo, '', 'NULO', b.nulos], [rotulo, '', 'TOTAL', b.total]);
    };
    for (const b of r.boletins) adicionar(String(b.urna), b);
    adicionar('GERAL', r.geral);
    linhas.push(['GERAL', '', 'VÁLIDOS', r.geral.validos]);
    for (const c of r.vencedor.chapas) linhas.push([r.vencedor.empate ? 'EMPATE' : 'VENCEDORA', c.numero, c.nome, r.vencedor.votos]);
    const campo = (v) => (/[";\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    // BOM + ";" para o Excel em português abrir com acentos e colunas certas.
    return '﻿' + linhas.map((l) => l.map(campo).join(';')).join('\r\n') + '\r\n';
  }

  return { apurar, csv };
}

module.exports = { criarApuracao };
