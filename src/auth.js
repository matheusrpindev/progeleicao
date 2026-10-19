const crypto = require('crypto');
const { lerConfig, gravarConfig } = require('./db');
const { ErroEleicao } = require('./erros');

const NOME_COOKIE = 'sessao';
const sessoes = new Set();

function gerarHash(senha) {
  const sal = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(senha, sal, 64).toString('hex');
  return `${sal}:${hash}`;
}

function conferirHash(senha, guardado) {
  const [sal, hash] = guardado.split(':');
  const calculado = crypto.scryptSync(senha, sal, 64);
  return crypto.timingSafeEqual(calculado, Buffer.from(hash, 'hex'));
}

function lerCookies(cabecalho = '') {
  const cookies = {};
  for (const parte of cabecalho.split(';')) {
    const i = parte.indexOf('=');
    if (i > 0) cookies[parte.slice(0, i).trim()] = decodeURIComponent(parte.slice(i + 1).trim());
  }
  return cookies;
}

function criarAuth(db) {
  const senhaDefinida = () => Boolean(lerConfig(db, 'senha_hash'));

  function definirSenha(senha) {
    if (senhaDefinida()) throw new ErroEleicao('A senha já foi definida.');
    if (typeof senha !== 'string' || senha.length < 4) throw new ErroEleicao('A senha precisa ter pelo menos 4 caracteres.');
    gravarConfig(db, 'senha_hash', gerarHash(senha));
  }

  function entrar(senha) {
    if (!conferirSenha(senha)) return null;
    const token = crypto.randomBytes(32).toString('hex');
    sessoes.add(token);
    return token;
  }

  function conferirSenha(senha) {
    const guardado = lerConfig(db, 'senha_hash');
    return Boolean(guardado && typeof senha === 'string' && conferirHash(senha, guardado));
  }

  const autenticado = (cabecalhoCookie) => sessoes.has(lerCookies(cabecalhoCookie)[NOME_COOKIE]);

  function sair(cabecalhoCookie) {
    sessoes.delete(lerCookies(cabecalhoCookie)[NOME_COOKIE]);
  }

  function exigirLogin(req, res, next) {
    if (autenticado(req.headers.cookie)) return next();
    res.status(401).json({ erro: 'Faça login para continuar.' });
  }

  return { senhaDefinida, definirSenha, conferirSenha, entrar, autenticado, sair, exigirLogin, NOME_COOKIE };
}

module.exports = { criarAuth };
