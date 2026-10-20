const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const { lerConfig, gravarConfig } = require('./db');
const { HASH_INICIAL } = require('./votos');
const { ErroEleicao } = require('./erros');

const TIPOS_FOTO = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const agora = () => new Date().toISOString();

function criarEleicao(db) {
  const status = () => lerConfig(db, 'status');

  function exigirPreparacao() {
    if (status() !== 'preparacao') throw new ErroEleicao('A votação já foi aberta: os dados da eleição não podem mais ser alterados.');
  }

  // Qualquer mudança nos dados invalida a zerésima já emitida.
  const invalidarZeresima = () => gravarConfig(db, 'zeresima_em', null);

  const listarChapas = () => db.prepare('SELECT numero, nome, foto FROM chapas ORDER BY numero').all()
    .map((c) => ({ ...c, foto: c.foto ? `/fotos/${c.foto}` : null }));

  function estado() {
    return {
      escola: lerConfig(db, 'escola'),
      eleicao: lerConfig(db, 'eleicao'),
      status: status(),
      zeresimaEm: lerConfig(db, 'zeresima_em'),
      abertaEm: lerConfig(db, 'aberta_em'),
      encerradaEm: lerConfig(db, 'encerrada_em'),
      chapas: listarChapas(),
      liberarNaUrna: liberarNaUrna(),
    };
  }

  // Tecla " na própria urna libera um novo voto. Ligada se nunca foi configurada.
  const liberarNaUrna = () => lerConfig(db, 'liberar_na_urna') !== '0';
  const definirLiberarNaUrna = (ativo) => gravarConfig(db, 'liberar_na_urna', ativo ? '1' : '0');

  function salvarDados({ escola, eleicao }) {
    exigirPreparacao();
    gravarConfig(db, 'escola', String(escola || '').trim());
    gravarConfig(db, 'eleicao', String(eleicao || '').trim());
    invalidarZeresima();
  }

  function salvarFoto(numero, dataUrl) {
    const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(dataUrl || '');
    if (!m || !TIPOS_FOTO[m[1]]) throw new ErroEleicao('A imagem precisa ser PNG, JPG ou WEBP.');
    fs.mkdirSync(config.pastaFotos, { recursive: true });
    const nome = `chapa-${numero}-${crypto.randomBytes(4).toString('hex')}.${TIPOS_FOTO[m[1]]}`;
    fs.writeFileSync(path.join(config.pastaFotos, nome), Buffer.from(m[2], 'base64'));
    return nome;
  }

  function apagarFoto(nome) {
    if (nome) fs.rmSync(path.join(config.pastaFotos, nome), { force: true });
  }

  function validarChapa(numero, nome) {
    if (!/^\d{2}$/.test(numero || '')) throw new ErroEleicao('O número da chapa precisa ter exatamente 2 dígitos.');
    if (!String(nome || '').trim()) throw new ErroEleicao('Informe o nome da chapa.');
  }

  function criarChapa({ numero, nome, foto }) {
    exigirPreparacao();
    validarChapa(numero, nome);
    if (db.prepare('SELECT 1 FROM chapas WHERE numero = ?').get(numero)) throw new ErroEleicao(`Já existe uma chapa com o número ${numero}.`);
    const arquivo = foto ? salvarFoto(numero, foto) : null;
    db.prepare('INSERT INTO chapas (numero, nome, foto) VALUES (?, ?, ?)').run(numero, nome.trim(), arquivo);
    invalidarZeresima();
  }

  // foto: dataURL = trocar; null = remover; undefined = manter.
  function editarChapa(numero, { nome, foto }) {
    exigirPreparacao();
    const atual = db.prepare('SELECT * FROM chapas WHERE numero = ?').get(numero);
    if (!atual) throw new ErroEleicao('Chapa não encontrada.');
    validarChapa(numero, nome);
    let arquivo = atual.foto;
    if (foto !== undefined) {
      arquivo = foto ? salvarFoto(numero, foto) : null;
      apagarFoto(atual.foto);
    }
    db.prepare('UPDATE chapas SET nome = ?, foto = ? WHERE numero = ?').run(nome.trim(), arquivo, numero);
    invalidarZeresima();
  }

  function excluirChapa(numero) {
    exigirPreparacao();
    const atual = db.prepare('SELECT foto FROM chapas WHERE numero = ?').get(numero);
    if (!atual) throw new ErroEleicao('Chapa não encontrada.');
    db.prepare('DELETE FROM chapas WHERE numero = ?').run(numero);
    apagarFoto(atual.foto);
    invalidarZeresima();
  }

  // A zerésima é calculada a partir do banco, não presumida.
  function emitirZeresima() {
    exigirPreparacao();
    const votosPorUrna = Object.fromEntries(db.prepare('SELECT urna, COUNT(*) AS n FROM votos GROUP BY urna').all().map((l) => [l.urna, l.n]));
    const liberacoes = db.prepare('SELECT urna, emitidas FROM liberacoes ORDER BY urna').all();
    const urnas = liberacoes.map((l) => ({ urna: l.urna, votos: votosPorUrna[l.urna] || 0, liberacoes: l.emitidas }));
    const totalVotos = db.prepare('SELECT COUNT(*) AS n FROM votos').get().n;
    if (totalVotos > 0 || urnas.some((u) => u.liberacoes > 0)) throw new ErroEleicao('Existem votos ou liberações gravados: o banco não está zerado.');
    const emitidaEm = agora();
    gravarConfig(db, 'zeresima_em', emitidaEm);
    return { ...estado(), emitidaEm, urnas, totalVotos, hashInicial: HASH_INICIAL };
  }

  function abrir() {
    exigirPreparacao();
    if (listarChapas().length === 0) throw new ErroEleicao('Cadastre pelo menos uma chapa antes de abrir a votação.');
    if (db.prepare('SELECT COUNT(*) AS n FROM urnas').get().n === 0) throw new ErroEleicao('Adicione pelo menos uma urna antes de abrir a votação.');
    if (!lerConfig(db, 'zeresima_em')) throw new ErroEleicao('Emita a zerésima antes de abrir a votação.');
    db.transaction(() => {
      gravarConfig(db, 'status', 'aberta');
      gravarConfig(db, 'aberta_em', agora());
    })();
  }

  // Urnas liberadas que ainda não registraram o voto.
  const liberacoesPendentes = () => db.prepare('SELECT urna FROM liberacoes WHERE pendente IS NOT NULL ORDER BY urna').all().map((l) => l.urna);

  // Retorna { encerrada: true } ou { encerrada: false, pendentes: [urnas] }
  // quando há urna liberada sem voto e o encerramento não foi forçado.
  function encerrar({ forcar = false } = {}) {
    if (status() !== 'aberta') throw new ErroEleicao('A votação não está aberta.');
    const pendentes = liberacoesPendentes();
    if (pendentes.length && !forcar) return { encerrada: false, pendentes };
    db.transaction(() => {
      gravarConfig(db, 'status', 'encerrada');
      gravarConfig(db, 'encerrada_em', agora());
    })();
    return { encerrada: true, pendentes };
  }

  function exigirEncerrada() {
    if (status() !== 'encerrada') throw new ErroEleicao('Só é possível iniciar uma nova eleição depois de encerrar a atual.');
  }

  // Volta à preparação sem votos nem liberações. Mantém a senha, os nomes da
  // escola e da eleição e, se pedido, as chapas. Arquivar antes é com quem chama.
  function zerar({ apagarChapas = false } = {}) {
    exigirEncerrada();
    const fotos = apagarChapas ? db.prepare('SELECT foto FROM chapas').all().map((c) => c.foto) : [];
    db.transaction(() => {
      db.prepare('DELETE FROM votos').run();
      db.prepare('UPDATE liberacoes SET emitidas = 0, pela_urna = 0, pendente = NULL').run();
      if (apagarChapas) db.prepare('DELETE FROM chapas').run();
      for (const chave of ['zeresima_em', 'aberta_em', 'encerrada_em', 'hash_final']) gravarConfig(db, chave, null);
      gravarConfig(db, 'status', 'preparacao');
    })();
    fotos.forEach(apagarFoto);
  }

  return { estado, status, liberarNaUrna, definirLiberarNaUrna, exigirPreparacao, invalidarZeresima, listarChapas, liberacoesPendentes, exigirEncerrada, zerar, salvarDados, criarChapa, editarChapa, excluirChapa, emitirZeresima, abrir, encerrar };
}

module.exports = { criarEleicao };
