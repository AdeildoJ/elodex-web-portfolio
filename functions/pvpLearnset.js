/**
 * Wave 5A — Validação server-side de learnset para PvP / Coliseu.
 *
 * Regras (pragmáticas e compatíveis com o dado atual de `pokemonMoves.json`):
 *   - Um Pokémon pode usar em batalha um move cujo método seja:
 *       * "level-up"    → o nível do move deve ser <= nível do Pokémon;
 *       * qualquer outro método conhecido (machine, tutor, egg, event, etc.)
 *         → aceito sem restrição canônica aqui (movesets TM/egg/tutor são
 *         liberados fora do level up).
 *   - Se o arquivo `pokemonMoves.json` não estiver disponível (ambiente sem
 *     acesso ao monorepo, por exemplo em alguns deploys), a validação é
 *     permissiva (best-effort) para não derrubar PvP.
 *   - Se o `speciesId` não existir no dataset, a validação é permissiva (a
 *     causa mais provável é dataset incompleto; já validamos speciesId antes).
 *
 * Essa validação cobre a classe mais comum de trapaça (enviar um move que a
 * espécie nunca aprende). Ela NÃO reimplementa a árvore de breeding/egg moves
 * nem cadeia de pré-evolução — tratado como evolução futura.
 */

let pokemonMoves = {};
try {
  pokemonMoves = require("../../elodex-mobile/src/data/pokemon/pokemonMoves.json");
} catch (_e) {
  pokemonMoves = {};
}

function norm(v) {
  return String(v || "").trim().toLowerCase();
}
function asInt(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function hasLearnsetData() {
  return pokemonMoves && typeof pokemonMoves === "object" && Object.keys(pokemonMoves).length > 0;
}

/**
 * Kill-switch: defina `PVP_LEARNSET_STRICT=0` nas functions para desabilitar
 * temporariamente a validação (ex.: se o dataset TM estiver incompleto e
 * causar falsos-positivos em produção). Padrão = ligado.
 */
function isStrictModeEnabled() {
  const raw = String(process.env.PVP_LEARNSET_STRICT ?? "1").trim();
  return raw !== "0" && raw.toLowerCase() !== "false";
}

function getSpeciesLearnset(speciesId) {
  const sid = String(Math.max(1, asInt(speciesId, 1)));
  const row = pokemonMoves?.[sid];
  const raw = Array.isArray(row?.moves) ? row.moves : Array.isArray(row) ? row : [];
  return raw.map((m) => ({
    moveId: norm(m?.moveId ?? m?.id ?? m?.name ?? m?.move),
    method: norm(m?.method || (Number.isFinite(Number(m?.level ?? m?.lvl)) ? "level-up" : "other")),
    level: Number.isFinite(Number(m?.level ?? m?.levelLearnedAt ?? m?.lvl))
      ? Math.max(1, asInt(m?.level ?? m?.levelLearnedAt ?? m?.lvl, 1))
      : null,
  })).filter((m) => !!m.moveId);
}

/**
 * Retorna true se `moveId` é legal para o Pokémon com `speciesId` no `level`
 * informado. Permissivo quando não há dataset.
 */
function isMoveLegalForSpecies(speciesId, moveId, level) {
  if (!hasLearnsetData()) return true; // best-effort
  const sid = String(Math.max(1, asInt(speciesId, 1)));
  if (!pokemonMoves[sid]) return true; // species desconhecida → não bloqueia
  const wantId = norm(moveId);
  if (!wantId) return false;
  const lv = Math.max(1, asInt(level, 1));
  const entries = getSpeciesLearnset(speciesId).filter((m) => m.moveId === wantId);
  if (entries.length === 0) return false;
  for (const entry of entries) {
    if (entry.method === "level-up") {
      if (entry.level == null || entry.level <= lv) return true;
    } else {
      // machine/tutor/egg/event/tm/hm/other → aceitos fora do level up
      return true;
    }
  }
  return false;
}

/**
 * Validador em alto nível para um array `BattleMonster[]`. Retorna a primeira
 * mensagem de erro ou null se ok.
 */
function validateTeamLearnset(team) {
  if (!isStrictModeEnabled()) return null;
  if (!hasLearnsetData()) return null; // best-effort
  if (!Array.isArray(team)) return null;
  for (let i = 0; i < team.length; i++) {
    const m = team[i];
    if (!m || typeof m !== "object") continue;
    const sid = asInt(m.speciesId, 0);
    if (sid <= 0) continue;
    if (!pokemonMoves[String(sid)]) continue;
    const lv = asInt(m.level, 1);
    const moves = Array.isArray(m.moves) ? m.moves : [];
    for (const mv of moves) {
      const mid = norm(mv?.id);
      if (!mid) continue;
      if (!isMoveLegalForSpecies(sid, mid, lv)) {
        return `Pokemon ${i + 1} (species ${sid}, lv ${lv}) tem move ilegal: "${mid}".`;
      }
    }
  }
  return null;
}

module.exports = {
  hasLearnsetData,
  isStrictModeEnabled,
  getSpeciesLearnset,
  isMoveLegalForSpecies,
  validateTeamLearnset,
};
