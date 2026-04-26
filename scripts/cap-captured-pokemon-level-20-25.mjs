/**
 * Coloca **todos** os Pokémon dos jogadores no intervalo [20, 25], **incluindo o inicial**
 * (`isStarter`), com nível final determinístico por caminho do documento.
 *
 * Escopo: só `players/{uid}/characters/{cid}/box` e `.../time` (não altera GYM).
 *
 * Ao atualizar: zera EXP, recalcula toNext (Medium Fast), stats e HP cheio no novo nível.
 *
 * Uso (raiz do repo, `admin/serviceAccountKey.json`):
 *   node admin/scripts/cap-captured-pokemon-level-20-25.mjs --dry-run
 *   node admin/scripts/cap-captured-pokemon-level-20-25.mjs --execute
 *
 * Opcional: `--min=20 --max=25`, `--exclude-starter` (não altera o inicial; raro).
 */
import { readFileSync, existsSync } from "node:fs";
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

function hashSeed(s) {
  let h = 0;
  const str = String(s);
  for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function levelFromSeed(seed, minLv, maxLv) {
  const span = Math.max(0, maxLv - minLv);
  return minLv + (hashSeed(seed) % (span + 1));
}

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

function buildPatchForCharacterMon(data, newLevel) {
  const speciesId = Math.max(1, asInt(data.speciesId, 0));
  if (speciesId <= 0) return null;

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

/** Precisa gravar: nível alvo diferente ou EXP não canônica para esse nível. */
function needsCanonicalUpdate(data, targetLevel) {
  const toNext = expToNextForLevel(targetLevel);
  if (asInt(data.level, -1) !== targetLevel) return true;
  if (asInt(data.exp?.current, -1) !== 0) return true;
  if (asInt(data.exp?.toNext, -2) !== toNext) return true;
  return false;
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run") || !argv.includes("--execute");
  const execute = argv.includes("--execute");
  const excludeStarter = argv.includes("--exclude-starter");

  let minLv = 20;
  let maxLv = 25;
  const minArg = argv.find((a) => a.startsWith("--min="));
  const maxArg = argv.find((a) => a.startsWith("--max="));
  if (minArg) minLv = Math.max(1, Math.min(100, asInt(minArg.split("=")[1], 20)));
  if (maxArg) maxLv = Math.max(1, Math.min(100, asInt(maxArg.split("=")[1], 25)));
  if (maxLv < minLv) [minLv, maxLv] = [maxLv, minLv];

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

  const planned = [];

  for (const d of playerMonDocs) {
    const data = d.data() || {};
    if (asInt(data.speciesId, 0) <= 0) continue;
    if (data.isStarter === true && excludeStarter) continue;

    const path = normPath(d.ref.path);
    const newLevel = levelFromSeed(path, minLv, maxLv);

    if (newLevel < minLv || newLevel > maxLv) continue;

    if (!needsCanonicalUpdate(data, newLevel)) continue;

    const patch = buildPatchForCharacterMon(data, newLevel);
    if (!patch) continue;

    planned.push({
      ref: d.ref,
      patch,
      path,
      oldLevel: Math.max(1, asInt(data.level, 1)),
      newLevel,
    });
  }

  const summary = {
    ok: true,
    dryRun,
    mode: "all_captured_to_band",
    minLv,
    maxLv,
    excludeStarter,
    playerDocsScanned: playerMonDocs.length,
    wouldUpdate: planned.length,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (dryRun && planned.length) {
    console.log(
      JSON.stringify(
        planned.slice(0, 80).map((p) => ({ path: p.path, oldLevel: p.oldLevel, newLevel: p.newLevel })),
        null,
        2
      )
    );
    if (planned.length > 80) console.log(`... e mais ${planned.length - 80} documentos.`);
  }

  if (execute && planned.length) {
    let batch = db.batch();
    let n = 0;
    let batches = 0;
    for (const p of planned) {
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
    console.log(JSON.stringify({ ok: true, batchesCommitted: batches, updated: planned.length }, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
