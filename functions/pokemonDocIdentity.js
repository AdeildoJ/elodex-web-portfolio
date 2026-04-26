const { randomUUID } = require("crypto");

/**
 * Identidade estável do Pokémon (independente do slot ou do doc id na box).
 * Preservar em: swap, evolução, troca, roubo — nunca regenerar se já existir.
 */
function ensureStableInstanceId(mon) {
  const base = { ...(mon || {}) };
  const sid = String(base.stableInstanceId || "").trim();
  if (sid.length >= 16) return base;
  base.stableInstanceId = randomUUID();
  return base;
}

module.exports = { ensureStableInstanceId, randomUUID };
