/**
 * HP real (gen 3+) a partir de base, IV/EV e nível — alinhado ao app mobile.
 */

function asInt(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function resolveBaseHpFromSpeciesMap(speciesMap, speciesId) {
  const sid = Math.max(1, asInt(speciesId, 1));
  const row = speciesMap?.[String(sid)] ?? speciesMap?.[sid] ?? null;
  const bs = row?.baseStats ?? row?.stats ?? null;
  const raw = bs?.hp ?? bs?.HP;
  const hp = asInt(raw, 0);
  return Math.max(1, hp || 1);
}

function calcHpStatAtLevel(level, baseHp, ivHp = 0, evHp = 0) {
  const lv = Math.max(1, asInt(level, 1));
  const iv = Math.max(0, asInt(ivHp, 0));
  const ev = Math.max(0, asInt(evHp, 0));
  return Math.floor(((2 * baseHp + iv + Math.floor(ev / 4)) * lv) / 100) + lv + 10;
}

function loadSpeciesMap() {
  try {
    return require("../../elodex-mobile/src/data/pokemon/pokemonSpecies.json");
  } catch {
    return {};
  }
}

const speciesMapCache = loadSpeciesMap();

function starterFullHpFromSpeciesId(speciesId, level = 5, ivs = null, evs = null) {
  return fullHpForSpeciesAtLevel(speciesId, level, ivs, evs);
}

/** HP cheio no nível informado (gen 3+), para chocagem, bootstrap e novos Pokémon. */
function fullHpForSpeciesAtLevel(speciesId, level = 5, ivs = null, evs = null) {
  const baseHp = resolveBaseHpFromSpeciesMap(speciesMapCache, speciesId);
  const ivHp = ivs && typeof ivs === "object" ? asInt(ivs.hp, 0) : 0;
  const evHp = evs && typeof evs === "object" ? asInt(evs.hp, 0) : 0;
  const lv = Math.max(1, asInt(level, 1));
  const hpTotal = Math.max(1, calcHpStatAtLevel(lv, baseHp, ivHp, evHp));
  return { current: hpTotal, total: hpTotal };
}

module.exports = {
  starterFullHpFromSpeciesId,
  fullHpForSpeciesAtLevel,
  resolveBaseHpFromSpeciesMap,
  calcHpStatAtLevel,
};
