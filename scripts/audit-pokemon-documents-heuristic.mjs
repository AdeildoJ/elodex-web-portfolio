/**
 * Auditoria heurística de documentos Pokémon (export JSON).
 * Entrada: stdin com JSON array de objetos { path?, ...doc }
 * ou arquivo: node audit-pokemon-documents-heuristic.mjs export.json
 *
 * Detecta: speciesId inválido, moves fora do learnset (level-up), stableInstanceId ausente,
 * stats absurdos (nível muito alto com HP 1, etc.).
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const adminRoot = join(__dirname, "..");
const speciesPath = join(adminRoot, "../elodex-mobile/src/data/pokemon/pokemonSpecies.json");
const movesBySpecies = join(adminRoot, "../elodex-mobile/src/data/pokemon/pokemonMoves.json");

function norm(s) {
  return String(s || "")
    .trim()
    .toLowerCase();
}

function loadLearnsetLevelUp(sid) {
  const raw = JSON.parse(readFileSync(movesBySpecies, "utf8"));
  const row = raw[String(sid)];
  const list = Array.isArray(row?.moves) ? row.moves : [];
  const out = new Set();
  for (const m of list) {
    const method = norm(m?.method || "level-up");
    if (method !== "level-up" && method !== "level up") continue;
    const mid = norm(m?.moveId ?? m?.id ?? m?.name);
    if (mid) out.add(mid);
  }
  out.add("pound");
  return out;
}

/** abilityId -> válido para espécie (dex). */
function loadAllowedAbilitiesForSpecies(species) {
  const map = new Map();
  const list = Array.isArray(species) ? species : Object.values(species);
  for (const e of list) {
    const sid = Math.trunc(Number(e?.id ?? e?.speciesId ?? 0));
    if (sid <= 0) continue;
    const abs = Array.isArray(e?.abilities) ? e.abilities : [];
    const set = new Set();
    for (const a of abs) {
      const id = norm(a?.abilityId ?? a?.id ?? a?.name);
      if (id) set.add(id);
    }
    map.set(sid, set);
  }
  return map;
}

function main() {
  const arg = process.argv[2];
  let text = "";
  if (arg && existsSync(arg)) text = readFileSync(arg, "utf8");
  else text = readFileSync(0, "utf8");
  const docs = JSON.parse(text || "[]");
  if (!Array.isArray(docs)) {
    console.error("Expected JSON array");
    process.exit(1);
  }

  const species = existsSync(speciesPath) ? JSON.parse(readFileSync(speciesPath, "utf8")) : {};
  const speciesIds = new Set(
    (Array.isArray(species) ? species : Object.values(species)).map((e) => Math.trunc(Number(e?.id ?? e?.speciesId ?? 0)))
  );
  const speciesById = new Map();
  for (const e of Array.isArray(species) ? species : Object.values(species)) {
    const id = Math.trunc(Number(e?.id ?? e?.speciesId ?? 0));
    if (id > 0) speciesById.set(id, e);
  }
  const allowedAbilities = loadAllowedAbilitiesForSpecies(species);

  const issues = [];
  for (const entry of docs) {
    const path = entry.path || entry._path || "";
    const d = entry.data || entry;
    const sid = Math.trunc(Number(d.speciesId ?? 0));
    const level = Math.trunc(Number(d.level ?? 0));
    const moves = Array.isArray(d.moves) ? d.moves.map(norm).filter(Boolean) : [];
    if (sid <= 0) {
      issues.push({ path, kind: "invalid_speciesId", sid });
      continue;
    }
    if (!speciesIds.has(sid)) {
      issues.push({ path, kind: "speciesId_not_in_dex_json", sid });
    }
    const dexRow = speciesById.get(sid);
    const dexName = dexRow ? norm(dexRow.name) : "";
    const docName = norm(d.speciesName ?? d.name ?? "");
    if (dexName && docName && docName !== dexName && !docName.startsWith("#")) {
      issues.push({ path, kind: "speciesName_mismatch_dex", sid, docName, dexName });
    }
    const aid = norm(d.abilityId ?? d.ability?.id ?? "");
    if (aid) {
      const allow = allowedAbilities.get(sid);
      if (allow && !allow.has(aid)) {
        issues.push({ path, kind: "abilityId_not_on_species", sid, abilityId: aid });
      }
    }
    if (!String(d.stableInstanceId || "").trim()) {
      issues.push({ path, kind: "missing_stableInstanceId", sid, note: "Legado ou doc anterior ao patch" });
    }
    try {
      const allowed = loadLearnsetLevelUp(sid);
      for (const m of moves) {
        if (!allowed.has(m)) {
          issues.push({ path, kind: "move_not_in_levelup_learnset", sid, moveId: m });
          break;
        }
      }
    } catch {
      /* ignore */
    }
    const hpT = Math.trunc(Number(d.hp?.total ?? 0));
    if (level > 0 && level <= 100 && hpT > 0 && hpT < 8 && sid > 0) {
      issues.push({ path, kind: "suspicious_hp_total", sid, level, hpT });
    }
  }

  console.log(
    JSON.stringify(
      {
        documents: docs.length,
        issues: issues.length,
        byKind: issues.reduce((acc, x) => {
          acc[x.kind] = (acc[x.kind] || 0) + 1;
          return acc;
        }, {}),
        samples: issues.slice(0, 80),
      },
      null,
      2
    )
  );
}

main();
