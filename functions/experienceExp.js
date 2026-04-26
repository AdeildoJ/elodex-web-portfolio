/**
 * Paridade com `elodex-mobile/src/pokemon/experience/*` (curvas pokeemerald + PokeAPI).
 */
const speciesGrowthRates = require("./speciesGrowthRates.json");

function cube(n) {
  return n * n * n;
}

function square(n) {
  return n * n;
}

function normalizeGrowthRateFromPokeapi(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  switch (s) {
    case "slow":
      return "slow";
    case "medium":
      return "medium-fast";
    case "fast":
      return "fast";
    case "medium-slow":
      return "medium-slow";
    case "slow-then-very-fast":
      return "erratic";
    case "fast-then-very-slow":
      return "fluctuating";
    case "medium-fast":
      return "medium-fast";
    default:
      return "medium-fast";
  }
}

function totalExpAtLevel(group, level) {
  const L = Math.max(1, Math.min(100, Math.floor(Number(level) || 1)));
  if (L <= 1) return 0;

  switch (group) {
    case "medium-fast":
      return cube(L);
    case "fast":
      return Math.trunc((4 * cube(L)) / 5);
    case "slow":
      return Math.trunc((5 * cube(L)) / 4);
    case "medium-slow":
      return Math.trunc((6 * cube(L)) / 5 - 15 * square(L) + 100 * L - 140);
    case "erratic": {
      const n = L;
      if (n <= 50) return Math.trunc(((100 - n) * cube(n)) / 50);
      if (n <= 68) return Math.trunc(((150 - n) * cube(n)) / 100);
      if (n <= 98) return Math.trunc((Math.trunc((1911 - 10 * n) / 3) * cube(n)) / 500);
      return Math.trunc(((160 - n) * cube(n)) / 100);
    }
    case "fluctuating": {
      const n = L;
      if (n <= 15) return Math.trunc(((Math.trunc((n + 1) / 3) + 24) * cube(n)) / 50);
      if (n <= 36) return Math.trunc(((n + 14) * cube(n)) / 50);
      return Math.trunc(((Math.trunc(n / 2) + 32) * cube(n)) / 50);
    }
    default:
      return cube(L);
  }
}

function expToNextAtLevel(level, group) {
  const L = Math.max(1, Math.min(100, Math.floor(Number(level) || 1)));
  if (L >= 100) return 1;
  const cur = totalExpAtLevel(group, L);
  const next = totalExpAtLevel(group, L + 1);
  return Math.max(1, next - cur);
}

function getExperienceGroupForSpeciesId(speciesId) {
  const sid = Math.max(1, Math.trunc(Number(speciesId) || 1));
  const raw = speciesGrowthRates[String(sid)];
  return normalizeGrowthRateFromPokeapi(raw);
}

function expToNextForSpeciesAtLevel(speciesId, level) {
  const g = getExperienceGroupForSpeciesId(speciesId);
  return expToNextAtLevel(level, g);
}

/**
 * Paridade com `elodex-mobile/src/pokemon/experience/expBarNormalize.ts`.
 * Recalcula o progresso na barra do nível atual após mudança de espécie (evolução).
 */
function normalizeExpBarCurrentForSpeciesLevel(speciesId, level, storedRaw) {
  const g = getExperienceGroupForSpeciesId(speciesId);
  const L = Math.max(1, Math.min(100, Math.floor(Number(level) || 1)));
  const toNext = Math.max(1, expToNextAtLevel(L, g));
  const floorAtLevel = totalExpAtLevel(g, L);
  const ceilAtNextLevel = floorAtLevel + toNext;
  let v = Math.max(0, Math.floor(Number(storedRaw) || 0));

  if (v >= ceilAtNextLevel) {
    v = (v - floorAtLevel) % toNext;
  } else if (v >= floorAtLevel) {
    v = v - floorAtLevel;
  } else {
    v = Math.min(v, toNext - 1);
  }

  return Math.max(0, Math.min(v, toNext - 1));
}

module.exports = {
  totalExpAtLevel,
  expToNextAtLevel,
  normalizeGrowthRateFromPokeapi,
  getExperienceGroupForSpeciesId,
  expToNextForSpeciesAtLevel,
  normalizeExpBarCurrentForSpeciesLevel,
};
