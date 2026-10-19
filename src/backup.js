const fs = require('fs');
const path = require('path');
const config = require('./config');

/*
 * Mantém UM arquivo de backup, substituído a cada minuto em que houve
 * mudança. Guardar várias cópias em sequência permitiria comparar uma com a
 * outra e descobrir quais votos entraram em cada minuto (quebra de sigilo).
 */
function criarBackup(db) {
  const destino = path.join(config.pastaBackup, 'eleicao-backup.db');
  let alterado = false;
  let emAndamento = null;

  async function copiar() {
    const temporario = `${destino}.tmp`;
    fs.mkdirSync(config.pastaBackup, { recursive: true });
    await db.backup(temporario);
    fs.renameSync(temporario, destino);
  }

  async function fazerAgora() {
    if (emAndamento) await emAndamento;
    alterado = false;
    emAndamento = copiar()
      .catch((e) => { alterado = true; console.error('Falha ao gravar o backup:', e.message); })
      .finally(() => { emAndamento = null; });
    return emAndamento;
  }

  const timer = setInterval(() => { if (alterado) fazerAgora(); }, config.intervaloBackupMs);
  timer.unref();

  return {
    marcarAlteracao: () => { alterado = true; },
    fazerAgora,
    destino,
  };
}

module.exports = { criarBackup };
