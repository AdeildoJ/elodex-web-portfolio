/**
 * Espelha `elodex-mobile/src/pokemon/experience/*` para scripts admin (sem TypeScript).
 * Curvas + grupo por espécie (`speciesGrowthRates.json`).
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** admin/scripts/lib -> repo root */
const repoRoot = join(__dirname, "..", "..", "..");
const growthJsonPath = join(repoRoot, "elodex-mobile", "src", "data", "pokemon", "speciesGrowthRates.json");

let growthMap = null;

export function loadGrowthMap() {
  if (growthMap) return growthMap;
  if (!existsSync(growthJsonPath)) {
    throw new Error(`speciesGrowthRates.json not found: ${growthJsonPath}`);
  }
  growthMap = JSON.parse(readFileSync(growthJsonPath, "utf8"));
  return growthMap;
}

function cube(n) {
  return n * n * n;
}

function square(n) {
  return n * n;
}

/** @param {string} raw */
export function normalizeGrowthRateFromPokeapi(raw) {
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

/** @param {string} group @param {number} level */
export function totalExpAtLevel(group, level) {
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

/** @param {number} level @param {string} group */
export function expToNextAtLevel(level, group) {
  const L = Math.max(1, Math.min(100, Math.floor(Number(level) || 1)));
  if (L >= 100) return 1;
  const cur = totalExpAtLevel(group, L);
  const next = totalExpAtLevel(group, L + 1);
  return Math.max(1, next - cur);
}

export function getExperienceGroupForSpeciesId(speciesId) {
  loadGrowthMap();
  const sid = Math.max(1, Math.trunc(Number(speciesId) || 0));
  const raw = growthMap[String(sid)];
  return normalizeGrowthRateFromPokeapi(raw);
}

export function expToNextForSpeciesAtLevel(speciesId, level) {
  const g = getExperienceGroupForSpeciesId(speciesId);
  const L = Math.max(1, Math.min(100, Math.floor(Number(level) || 1)));
  return expToNextAtLevel(L, g);
}

/** @see elodex-mobile expBarNormalize.ts */
export function normalizeExpBarCurrentForSpeciesLevel(speciesId, level, storedRaw) {
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

export function asInt(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

export function readExpRawFromDoc(data) {
  const hasNested = data.exp && typeof data.exp === "object";
  const currentFromNested = hasNested ? asInt(data.exp.current, NaN) : NaN;
  const toNextFromNested = hasNested ? asInt(data.exp.toNext, NaN) : NaN;
  const currentRoot = asInt(data.expCurrent, NaN);
  const toNextRoot = asInt(data.expToNext, NaN);
  const currentExpLegacy = asInt(data.currentExp, NaN);

  const current = Number.isFinite(currentFromNested)
    ? currentFromNested
    : Number.isFinite(currentRoot)
      ? currentRoot
      : Number.isFinite(currentExpLegacy)
        ? currentExpLegacy
        : null;

  const toNext = Number.isFinite(toNextFromNested)
    ? toNextFromNested
    : Number.isFinite(toNextRoot)
      ? toNextRoot
      : null;

  return { current, toNext };
}

/**
 * Critérios de “progressão anormal” (bug de EXP / dados legados).
 * @returns {{ affected: boolean, reasons: string[] }}
 */
export function detectExpAnomaly(data) {
  const reasons = [];
  const speciesId = asInt(data.speciesId, 0);
  if (speciesId <= 0) return { affected: false, reasons: [] };

  const level = Math.max(1, Math.min(100, asInt(data.level, 1)));
  const canonicalToNext = expToNextForSpeciesAtLevel(speciesId, level);
  const { current, toNext } = readExpRawFromDoc(data);

  if (current == null && toNext == null) {
    reasons.push("missing_exp");
  }
  if (current == null && toNext != null) {
    reasons.push("missing_current");
  }
  if (toNext != null && Math.trunc(toNext) !== Math.trunc(canonicalToNext)) {
    reasons.push("toNext_mismatch");
  }
  if (toNext == null && current != null) {
    reasons.push("missing_toNext");
  }

  const rawForNorm = current != null ? current : 0;
  const normalized = normalizeExpBarCurrentForSpeciesLevel(speciesId, level, rawForNorm);
  if (current != null && Math.trunc(current) !== Math.trunc(normalized)) {
    reasons.push("current_needs_normalize");
  }
  if (current != null && current < 0) {
    reasons.push("current_negative");
  }
  const cap = canonicalToNext - 1;
  if (current != null && current > cap) {
    reasons.push("current_overflow");
  }

  return { affected: reasons.length > 0, reasons };
}
