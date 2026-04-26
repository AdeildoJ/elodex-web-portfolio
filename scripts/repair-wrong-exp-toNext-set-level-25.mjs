/**
 * Identifica Pokémon em `players/{uid}/characters/{cid}/box` e `.../time` cujo
 * `exp.toNext` (ou `expToNext` no root) **não** bate com a curva Medium Fast
 * para o `level` atual — o bug típico (ex.: 125 = 5³ deixado no doc com nv 45).
 *
 * Opção A: só listar e exportar JSON dos treinadores.
 * Opção B: corrigir para **nível 25**, EXP zerada, `toNext` canônico, stats/HP recalculados.
 *
 * Uso (raiz do repo, credenciais em `admin/serviceAccountKey.json`):
 *   node admin/scripts/repair-wrong-exp-toNext-set-level-25.mjs --dry-run
 *   node admin/scripts/repair-wrong-exp-toNext-set-level-25.mjs --execute
 *
 * Saída: JSON resumo + lista de treinadores (`uid`, `characterId`, `characterName`).
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const adminRoot = join(__dirname, "..");
const keyPath = join(adminRoot, "serviceAccountKey.json");
const require = createRequire(import.meta.url);

const pe = require(join(adminRoot, "functions/lib/pokemonEvolution.cjs"));

function totalExpMediumFastAtLevel(level) {
  const lv = Math.max(1, Math.min(101, Math.floor(Number(level) || 1)));
  if (lv <= 1) return 0;
  return lv * lv * lv;
}

function expToNextForLevel(level) {
  const L = Math.max(1, Math.min(100, Math.floor(Number(level) || 1)));
  if (L >= 100) return 1;
  const cur = totalExpMediumFastAtLevel(L);
  const next = totalExpMediumFastAtLevel(L + 1);
  return Math.max(1, next - cur);
}

const TARGET_LEVEL = 25;

function normPath(p) {
  return String(p || "").replace(/\\/g, "/");
}

function shouldSkipPath(path) {
  return path.includes("/_meta");
}

function asInt(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

/** Bug: barra toNext incompatível com o nível (compare nested; fallback root se nested ausente). */
function hasExpToNextBug(data) {
  const level = Math.max(1, Math.min(100, asInt(data.level, 1)));
  const speciesId = asInt(data.speciesId, 0);
  if (speciesId <= 0) return { bug: false, reason: "no_species" };

  const canonical = expToNextForLevel(level);
  const hasNested = data.exp && typeof data.exp === "object";
  const nest = hasNested ? asInt(data.exp.toNext, NaN) : NaN;
  const root = asInt(data.expToNext, NaN);

  if (Number.isFinite(nest) && nest > 0) {
    if (Math.trunc(nest) !== Math.trunc(canonical)) {
      return { bug: true, reason: "nested_mismatch", canonical, stored: nest, level };
    }
  } else if (Number.isFinite(root) && root > 0) {
    if (Math.trunc(root) !== Math.trunc(canonical)) {
      return { bug: true, reason: "root_mismatch", canonical, stored: root, level };
    }
  } else {
    return { bug: false, reason: "no_stored_tonext" };
  }
  return { bug: false, reason: "ok" };
}

function parsePlayerCharacterFromPath(path) {
  const m = path.match(/^players\/([^/]+)\/characters\/([^/]+)\/(box|time)\//);
  if (!m) return null;
  return { uid: m[1], characterId: m[2], sub: m[3] };
}

function buildPatchForLevel25(data) {
  const speciesId = Math.max(1, asInt(data.speciesId, 0));
  if (speciesId <= 0) return null;

  const newLevel = TARGET_LEVEL;
  const ivs = data.ivs && typeof data.ivs === "object" ? data.ivs : { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  const evs = data.evs && typeof data.evs === "object" ? data.evs : { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  const base = pe.resolveBaseStats(speciesId);
  const real = base
    ? pe.calcRealStats({
        level: newLevel,
        nature: data.nature || "Docile",
        base,
        ivs,
        evs,
      })
    : null;
  const hpTotal = Math.max(1, Number(real?.hp ?? data.hp?.total ?? 1));
  const toNext = expToNextForLevel(newLevel);

  const patch = {
    level: newLevel,
    exp: { current: 0, toNext },
    expCurrent: 0,
    expToNext: toNext,
    hp: { current: hpTotal, total: hpTotal },
  };
  if (real) {
    patch.stats = {
      atk: real.atk,
      def: real.def,
      spa: real.spa,
      spd: real.spd,
      spe: real.spe,
    };
  }
  return patch;
}

async function fetchCollectionGroupPaged(db, admin, name, pageSize = 300) {
  const out = [];
  let lastDoc = null;
  const cg = db.collectionGroup(name);
  for (;;) {
    let q = cg.orderBy(admin.firestore.FieldPath.documentId()).limit(pageSize);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) out.push(d);
    if (snap.size < pageSize) break;
    lastDoc = snap.docs[snap.docs.length - 1];
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run") || !argv.includes("--execute");
  const execute = argv.includes("--execute");
  const outFile = argv.find((a) => a.startsWith("--out="))?.split("=")[1] || "";

  if (!existsSync(keyPath)) {
    console.error(JSON.stringify({ ok: false, error: "missing_service_account", path: keyPath }));
    process.exit(2);
  }

  const admin = require("firebase-admin");
  const { FieldValue } = require("firebase-admin/firestore");
  if (!admin.apps.length) {
    const sa = JSON.parse(readFileSync(keyPath, "utf8"));
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  }
  const db = admin.firestore();

  const playerMonDocs = [];
  for (const sub of ["box", "time"]) {
    const docs = await fetchCollectionGroupPaged(db, admin, sub);
    for (const d of docs) {
      const path = normPath(d.ref.path);
      if (shouldSkipPath(path)) continue;
      if (!/^players\/[^/]+\/characters\/[^/]+\/(box|time)\//.test(path)) continue;
      playerMonDocs.push(d);
    }
  }

  const characterNameCache = new Map();
  async function getCharacterName(uid, characterId) {
    const k = `${uid}|${characterId}`;
    if (characterNameCache.has(k)) return characterNameCache.get(k);
    const snap = await db.doc(`players/${uid}/characters/${characterId}`).get();
    const n = String(snap.data()?.name || "").trim() || null;
    characterNameCache.set(k, n);
    return n;
  }

  const affected = [];
  for (const d of playerMonDocs) {
    const data = d.data() || {};
    const info = hasExpToNextBug(data);
    if (!info.bug) continue;

    const path = normPath(d.ref.path);
    const loc = parsePlayerCharacterFromPath(path);
    if (!loc) continue;

    const name = data.speciesName || data.nickname || `#${asInt(data.speciesId, 0)}`;
    const patch = buildPatchForLevel25(data);
    if (!patch) continue;

    affected.push({
      ref: d.ref,
      path,
      patch,
      uid: loc.uid,
      characterId: loc.characterId,
      speciesId: asInt(data.speciesId, 0),
      speciesName: String(name),
      isStarter: data.isStarter === true,
      oldLevel: Math.max(1, asInt(data.level, 1)),
      oldExp: data.exp && typeof data.exp === "object" ? { ...data.exp } : null,
      oldExpToNextRoot: data.expToNext,
      reason: info.reason,
      canonicalToNext: info.canonical,
      storedToNext: info.stored,
    });
  }

  for (const row of affected) {
    row.characterName = await getCharacterName(row.uid, row.characterId);
  }

  const trainerKeys = new Map();
  for (const row of affected) {
    const k = `${row.uid}::${row.characterId}`;
    if (!trainerKeys.has(k)) {
      trainerKeys.set(k, {
        uid: row.uid,
        characterId: row.characterId,
        characterName: row.characterName,
        pokemonWithBug: 0,
      });
    }
    trainerKeys.get(k).pokemonWithBug += 1;
  }

  const trainers = [...trainerKeys.values()].sort((a, b) => a.characterName?.localeCompare(b.characterName || "") || 0);

  const report = {
    ok: true,
    dryRun,
    targetLevel: TARGET_LEVEL,
    playerDocsScanned: playerMonDocs.length,
    pokemonDocumentsAffected: affected.length,
    uniqueTrainers: trainers.length,
    trainers,
    details: affected.map((a) => ({
      path: a.path,
      uid: a.uid,
      characterId: a.characterId,
      characterName: a.characterName,
      speciesId: a.speciesId,
      speciesName: a.speciesName,
      isStarter: a.isStarter,
      oldLevel: a.oldLevel,
      newLevel: TARGET_LEVEL,
      reason: a.reason,
      canonicalToNext: a.canonical,
      storedToNext: a.stored,
      oldExp: a.oldExp,
    })),
  };

  const json = JSON.stringify(report, null, 2);
  console.log(json);

  if (outFile) {
    writeFileSync(outFile, json, "utf8");
    console.error(`Wrote: ${outFile}`);
  }

  if (execute && affected.length) {
    let batch = db.batch();
    let n = 0;
    let batches = 0;
    for (const p of affected) {
      batch.update(p.ref, {
        ...p.patch,
        updatedAt: FieldValue.serverTimestamp(),
      });
      n += 1;
      if (n >= 400) {
        await batch.commit();
        batches += 1;
        batch = db.batch();
        n = 0;
      }
    }
    if (n > 0) {
      await batch.commit();
      batches += 1;
    }
    console.error(JSON.stringify({ ok: true, batchesCommitted: batches, updated: affected.length }, null, 2));
  } else if (!execute) {
    console.error(
      JSON.stringify(
        {
          hint: "Nenhum write. Rode com --execute para aplicar nível 25 e EXP canônica nos documentos listados em details.",
        },
        null,
        2
      )
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
