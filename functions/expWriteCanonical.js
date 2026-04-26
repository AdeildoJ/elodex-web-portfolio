/**
 * Única escrita de EXP canônica nas Cloud Functions: `exp: { current, toNext }`
 * e remoção atômica de campos legados no root.
 *
 * Nome canônico: `updatePokemonExpForAdmin` — use-o em qualquer `update` / `set(merge)`.
 * `expWriteCanonicalWithDeletes` é alias legado; será removido num major futuro.
 */
const { FieldValue } = require("firebase-admin/firestore");

/**
 * @param {number} current
 * @param {number} toNext
 * @returns {Record<string, unknown>}
 */
function updatePokemonExpForAdmin(current, toNext) {
  const c = Math.max(0, Math.trunc(Number(current) || 0));
  const t = Math.max(1, Math.trunc(Number(toNext) || 1));
  return {
    exp: { current: c, toNext: t },
    expCurrent: FieldValue.delete(),
    currentExp: FieldValue.delete(),
    expToNext: FieldValue.delete(),
  };
}

const expWriteCanonicalWithDeletes = updatePokemonExpForAdmin;

module.exports = { updatePokemonExpForAdmin, expWriteCanonicalWithDeletes };
