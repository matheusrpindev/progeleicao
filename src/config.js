const path = require('path');

const raiz = path.join(__dirname, '..');
const pastaDados = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(raiz, 'dados');

module.exports = {
  porta: Number(process.env.PORT) || 3000,
  numUrnas: 4,
  pastaPublica: path.join(raiz, 'public'),
  pastaDados,
  arquivoBanco: path.join(pastaDados, 'eleicao.db'),
  pastaFotos: path.join(pastaDados, 'fotos'),
  pastaBackup: path.join(pastaDados, 'backup'),
  pastaArquivo: path.join(pastaDados, 'arquivo'),
  intervaloBackupMs: 60 * 1000,
};
