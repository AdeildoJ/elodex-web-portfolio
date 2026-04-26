/**
 * Auditoria Firestore em volume: Pokémon em `box` e `time` (paginação).
 * Classifica golpes por método no learnset (level-up, machine, egg, tutor, outro).
 * "Suspeito" para moves: apenas quando o golpe não aparece em nenhum método do learnset.
 *
 * Uso (na raiz do repo):
 *   node admin/scripts/audit-firestore-pokemon-live.mjs
 *   node admin/scripts/audit-firestore-pokemon-live.mjs --limit-pages 0
 *
 * Credenciais: `admin/serviceAccountKey.json`
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const adminRoot = join(__dirname, "..");
const keyPath = join(adminRoot, "serviceAccountKey.json");
const speciesPath = join(adminRoot, "../elodex-mobile/src/data/pokemon/pokemonSpecies.json");
const movesBySpecies = join(adminRoot, "../elodex-mobile/src/data/pokemon/pokemonMoves.json");

const require = createRequire(import.meta.url);

function norm(s) {
  return String(s || "")
    .trim()
    .toLowerCase();
}

/** Buckets por moveId normalizado para uma espécie. */
function loadLearnsetBuckets(sid) {
  const raw = JSON.parse(readFileSync(movesBySpecies, "utf8"));
  const row = raw[String(sid)];
  const list = Array.isArray(row?.moves) ? row.moves : [];
  const buckets = {
    level: new Set(),
    machine: new Set(),
    egg: new Set(),
    tutor: new Set(),
    other: new Set(),
  };
  for (const m of list) {
    const mid = norm(m?.moveId ?? m?.id ?? m?.name);
    if (!mid) continue;
    let method = norm(m?.method || "level-up");
    if (method === "level up") method = "level-up";
    if (method === "level-up" || method === "levelup") buckets.level.add(mid);
    else if (method === "machine" || method === "tm" || method === "technical-machine") buckets.machine.add(mid);
    else if (method === "egg") buckets.egg.add(mid);
    else if (method === "tutor") buckets.tutor.add(mid);
    else buckets.other.add(mid);
  }
  return buckets;
}

function classifyMove(buckets, moveId) {
  const id = norm(moveId);
  if (!id) return "empty";
  if (buckets.level.has(id)) return "level_up";
  if (buckets.machine.has(id)) return "tm_or_tr";
  if (buckets.egg.has(id)) return "egg";
  if (buckets.tutor.has(id)) return "tutor";
  if (buckets.other.has(id)) return "other_learnset";
  return "not_in_learnset";
}

function loadAllowedAbilities(species) {
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

async function main() {
  const argv = process.argv.slice(2);
  const limIdx = argv.indexOf("--limit-pages");
  const maxPages = limIdx >= 0 && argv[limIdx + 1] ? Math.max(0, Math.trunc(Number(argv[limIdx + 1]))) : 0;

  if (!existsSync(keyPath)) {
    console.error(JSON.stringify({ ok: false, error: "missing_service_account", path: keyPath }));
    process.exit(2);
  }
  const admin = require("firebase-admin");
  if (!admin.apps.length) {
    const sa = JSON.parse(readFileSync(keyPath, "utf8"));
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  }
  const db = admin.firestore();

  const species = JSON.parse(readFileSync(speciesPath, "utf8"));
  const speciesIds = new Set(
    (Array.isArray(species) ? species : Object.values(species)).map((e) => Math.trunc(Number(e?.id ?? e?.speciesId ?? 0)))
  );
  const speciesById = new Map();
  for (const e of Array.isArray(species) ? species : Object.values(species)) {
    const id = Math.trunc(Number(e?.id ?? e?.speciesId ?? 0));
    if (id > 0) speciesById.set(id, e);
  }
  const allowedAbilities = loadAllowedAbilities(species);

  const rawDocs = [];
  const errors = [];

  for (const sub of ["box", "time"]) {
    try {
      const pageSize = 500;
      let lastDoc = null;
      let pages = 0;
      for (;;) {
        let q = db.collectionGroup(sub).orderBy(admin.firestore.FieldPath.documentId()).limit(pageSize);
        if (lastDoc) q = q.startAfter(lastDoc);
        const snap = await q.get();
        pages += 1;
        if (snap.empty) break;
        for (const d of snap.docs) {
          rawDocs.push({ path: d.ref.path.replace(/\\/g, "/"), data: d.data() || {} });
        }
        if (snap.size < pageSize) break;
        lastDoc = snap.docs[snap.docs.length - 1];
        if (maxPages > 0 && pages >= maxPages) break;
      }
    } catch (e) {
      errors.push({ collectionGroup: sub, message: String(e?.message || e) });
    }
  }

  const docs = rawDocs.filter(({ path }) => {
    if (path.includes("/_meta")) return false;
    if (path.includes("users/test_")) return false;
    return true;
  });

  const issues = [];
  const moveClassAgg = {
    level_up: 0,
    tm_or_tr: 0,
    egg: 0,
    tutor: 0,
    other_learnset: 0,
    not_in_learnset: 0,
  };

  const learnsetCache = new Map();

  for (const { path, data: d } of docs) {
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
      issues.push({ path, kind: "missing_stableInstanceId", sid });
    }

    let buckets = learnsetCache.get(sid);
    if (!buckets) {
      try {
        buckets = loadLearnsetBuckets(sid);
        learnsetCache.set(sid, buckets);
      } catch {
        buckets = null;
      }
    }

    if (buckets) {
      for (const m of moves) {
        const c = classifyMove(buckets, m);
        moveClassAgg[c] = (moveClassAgg[c] || 0) + 1;
        if (c === "not_in_learnset") {
          issues.push({ path, kind: "move_not_in_any_learnset", sid, moveId: m });
        }
      }
    }

    const hpT = Math.trunc(Number(d.hp?.total ?? 0));
    if (level > 0 && level <= 100 && hpT > 0 && hpT < 8 && sid > 0) {
      issues.push({ path, kind: "suspicious_hp_total", sid, level, hpT });
    }
  }

  const byKind = issues.reduce((acc, x) => {
    acc[x.kind] = (acc[x.kind] || 0) + 1;
    return acc;
  }, {});

  const suspiciousCount = issues.length;

  console.log(
    JSON.stringify(
      {
        ok: true,
        documentsAudited: docs.length,
        rawDocumentsFetched: rawDocs.length,
        suspiciousCount,
        moveSlotClassificationsTotal: Object.values(moveClassAgg).reduce((a, b) => a + b, 0),
        moveClassificationHistogram: moveClassAgg,
        collectionGroupErrors: errors,
        byKind,
        samples: issues.slice(0, 60),
        notes: [
          "move_not_in_any_learnset: único flag de move ‘corrupto’; TM/ovo/tutor não entram aqui.",
          "Histórico move_not_in_levelup_learnset foi substituído por classificação completa do learnset.",
        ],
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e?.message || e) }));
  process.exit(1);
});
