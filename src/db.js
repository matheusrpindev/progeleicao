const fs = require('fs');
const sqlite = require('node:sqlite');
const config = require('./config');

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS config (
  chave TEXT PRIMARY KEY,
  valor TEXT
);

CREATE TABLE IF NOT EXISTS chapas (
  numero TEXT PRIMARY KEY CHECK (numero GLOB '[0-9][0-9]'),
  nome   TEXT NOT NULL,
  foto   TEXT
);

-- Urnas cadastradas no Admin. Cada uma aceita um único computador: o que
-- digitou o código de vinculação. Guarda-se só o hash do token desse computador.
CREATE TABLE IF NOT EXISTS urnas (
  id          INTEGER PRIMARY KEY,
  codigo      TEXT UNIQUE,
  dispositivo TEXT
);

-- Só contadores e o token da liberação em aberto: sem horário e sem
-- histórico, para que nada aqui possa ser cruzado com a tabela de votos.
CREATE TABLE IF NOT EXISTS liberacoes (
  urna     INTEGER PRIMARY KEY,
  emitidas INTEGER NOT NULL DEFAULT 0,
  pendente TEXT
);

-- Sigilo: nenhum horário e nenhuma coluna sequencial. WITHOUT ROWID faz a
-- tabela ser guardada pela ordem do id aleatório, não pela ordem de chegada.
-- O encadeamento de hash também segue a ordem do id (ver votos.js).
CREATE TABLE IF NOT EXISTS votos (
  id            TEXT PRIMARY KEY,
  urna          INTEGER NOT NULL,
  escolha       TEXT NOT NULL,
  hash_anterior TEXT NOT NULL,
  hash          TEXT NOT NULL
) WITHOUT ROWID;
`;

/*
 * SQLite embutido no próprio Node (node:sqlite): nada para compilar na
 * instalação, o que importa em computadores de escola sem Visual Studio
 * nem permissão de administrador. Esta classe expõe a pequena interface
 * usada pelo resto do código.
 */
class Banco {
  constructor(arquivo) {
    this.conexao = new sqlite.DatabaseSync(arquivo);
  }

  prepare(sql) { return this.conexao.prepare(sql); }

  exec(sql) { this.conexao.exec(sql); }

  pragma(texto) { this.conexao.exec(`PRAGMA ${texto}`); }

  // Devolve uma função que executa fn dentro de uma transação (BEGIN IMMEDIATE).
  transaction(fn) {
    return (...args) => {
      this.conexao.exec('BEGIN IMMEDIATE');
      try {
        const resultado = fn(...args);
        this.conexao.exec('COMMIT');
        return resultado;
      } catch (erro) {
        if (this.conexao.isTransaction) this.conexao.exec('ROLLBACK');
        throw erro;
      }
    };
  }

  backup(destino) { return sqlite.backup(this.conexao, destino); }

  close() { this.conexao.close(); }
}

function abrirBanco(arquivo = config.arquivoBanco) {
  fs.mkdirSync(config.pastaDados, { recursive: true });
  const db = new Banco(arquivo);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.pragma('busy_timeout = 5000');
  // Sobrescreve com zeros o conteúdo apagado/alterado, para que versões
  // antigas das linhas (que revelariam a ordem dos votos) não fiquem no arquivo.
  db.pragma('secure_delete = ON');
  db.exec(ESQUEMA);

  const inserirConfig = db.prepare('INSERT OR IGNORE INTO config (chave, valor) VALUES (?, ?)');
  db.transaction(() => {
    inserirConfig.run('status', 'preparacao');
    inserirConfig.run('escola', '');
    inserirConfig.run('eleicao', '');
  })();
  return db;
}

function lerConfig(db, chave) {
  const linha = db.prepare('SELECT valor FROM config WHERE chave = ?').get(chave);
  return linha ? linha.valor : null;
}

function gravarConfig(db, chave, valor) {
  db.prepare('INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor')
    .run(chave, valor);
}

module.exports = { abrirBanco, lerConfig, gravarConfig };
