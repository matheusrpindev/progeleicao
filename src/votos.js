const crypto = require('crypto');
const { lerConfig, gravarConfig } = require('./db');

// Hash "zero" que inicia a cadeia (equivale à urna vazia da zerésima).
const HASH_INICIAL = '0'.repeat(64);
const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const calcularHash = (anterior, v) =>
  crypto.createHash('sha256').update(`${anterior}|${v.id}|${v.urna}|${v.escolha}`).digest('hex');

/*
 * Encadeamento: cada voto guarda o hash do voto ANTERIOR NA ORDEM DO ID
 * ALEATÓRIO, e não na ordem de chegada. Um voto novo é encaixado na posição
 * do seu id e os hashes dali em diante são recalculados. Assim o conteúdo
 * final do banco depende só do conjunto de votos: a cadeia detecta
 * alteração/remoção de registros, mas não revela a sequência em que os
 * eleitores votaram (o que, cruzado com a ordem das liberações, quebraria
 * o sigilo).
 */
function criarVotos(db) {
  const st = {
    existe: db.prepare('SELECT 1 FROM votos WHERE id = ?'),
    pendente: db.prepare('SELECT pendente FROM liberacoes WHERE urna = ?'),
    chapa: db.prepare('SELECT 1 FROM chapas WHERE numero = ?'),
    hashAntes: db.prepare('SELECT hash FROM votos WHERE id < ? ORDER BY id DESC LIMIT 1'),
    depois: db.prepare('SELECT id, urna, escolha FROM votos WHERE id > ? ORDER BY id'),
    inserir: db.prepare('INSERT INTO votos (id, urna, escolha, hash_anterior, hash) VALUES (?, ?, ?, ?, ?)'),
    reencadear: db.prepare('UPDATE votos SET hash_anterior = ?, hash = ? WHERE id = ?'),
    consumir: db.prepare('UPDATE liberacoes SET pendente = NULL WHERE urna = ?'),
    todos: db.prepare('SELECT id, urna, escolha, hash_anterior, hash FROM votos ORDER BY id'),
  };

  function escolhaDe(voto) {
    if (voto === 'BRANCO') return 'BRANCO';
    if (typeof voto === 'string' && /^\d{2}$/.test(voto)) return st.chapa.get(voto) ? voto : 'NULO';
    return null;
  }

  // Retorna { ok: true } (inclusive para UUID repetido) ou { ok: false, erro }.
  const registrar = db.transaction(({ id, urna, token, voto }) => {
    id = String(id || '').toLowerCase();
    if (!FORMATO_UUID.test(id)) return { ok: false, erro: 'id_invalido' };
    if (st.existe.get(id)) return { ok: true, duplicado: true };

    const lib = st.pendente.get(urna);
    if (!lib || !lib.pendente || lib.pendente !== token) return { ok: false, erro: 'sem_liberacao' };

    const escolha = escolhaDe(voto);
    if (!escolha) return { ok: false, erro: 'voto_invalido' };

    const anterior = st.hashAntes.get(id);
    let hash = calcularHash(anterior ? anterior.hash : HASH_INICIAL, { id, urna, escolha });
    st.inserir.run(id, urna, escolha, anterior ? anterior.hash : HASH_INICIAL, hash);
    for (const seguinte of st.depois.all(id)) {
      const novo = calcularHash(hash, seguinte);
      st.reencadear.run(hash, novo, seguinte.id);
      hash = novo;
    }
    gravarConfig(db, 'hash_final', hash);
    st.consumir.run(urna);
    return { ok: true };
  });

  function verificarIntegridade() {
    let esperado = HASH_INICIAL;
    let total = 0;
    for (const v of st.todos.iterate()) {
      total++;
      if (v.hash_anterior !== esperado || v.hash !== calcularHash(esperado, v)) {
        return { ok: false, total, mensagem: `Registro adulterado ou fora da cadeia (voto nº ${total} na ordem de verificação).` };
      }
      esperado = v.hash;
    }
    const guardado = lerConfig(db, 'hash_final') || HASH_INICIAL;
    if (guardado !== esperado) {
      return { ok: false, total, hashFinal: esperado, mensagem: 'O final da cadeia não confere: há votos faltando ou inseridos por fora do sistema.' };
    }
    return { ok: true, total, hashFinal: esperado, mensagem: 'Integridade OK: nenhum voto foi alterado, removido ou inserido por fora do sistema.' };
  }

  return { registrar, verificarIntegridade };
}

module.exports = { criarVotos, HASH_INICIAL };
