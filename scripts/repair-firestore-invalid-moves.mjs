/**
 * Reparo cirúrgico: corrige golpes fora de qualquer learnset em docs Firestore.
 *
 * Estratégia:
 * - Analisa `box` + `time` (mesmo escopo da auditoria)
 * - Para cada move inválido, tenta substituir por move de level-up válido da espécie
 * - Mantém tamanho do moveset (quando possível), sem mexer em outros campos
 * - `--dry-run` só relata; `--execute` grava
 *
 * Uso:
 *   node admin/scripts/repair-firestore-invalid-moves.mjs --dry-run
 *   node admin/scripts/repair-firestore-invalid-moves.mjs --execute --export-before ./backup-invalid-moves.json
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const adminRoot = join(__dirname, "..");
const keyPath = join(adminRoot, "serviceAccountKey.json");
const movesBySpecies = join(adminRoot, "../elodex-mobile/src/data/pokemon/pokemonMoves.json");
const require = createRequire(import.meta.url);

function norm(s) {
  return String(s || "")
    .trim()
    .toLowerCase();
}

function shouldIncludeDoc(path) {
  if (path.includes("/_meta")) return false;
  if (path.includes("users/test_")) return false;
  return true;
}

function buildLearnsetBuckets(row) {
  const moves = Array.isArray(row?.moves) ? row.moves : [];
  const all = new Set();
  const levelOrdered = [];
  for (const m of moves) {
    const id = norm(m?.moveId ?? m?.id ?? m?.name);
    if (!id) continue;
    all.add(id);
    const method = norm(m?.method);
    if (method === "level-up" || method === "level up" || method === "levelup") {
      const lvl = Number.isFinite(Number(m?.level)) ? Math.max(1, Math.trunc(Number(m.level))) : 1;
      levelOrdered.push({ moveId: id, level: lvl });
    }
  }
  levelOrdered.sort((a, b) => a.level - b.level);
  return { all, levelOrdered };
}

function replaceInvalidMoves(currentMoves, buckets) {
  const arr = Array.isArray(currentMoves) ? currentMoves.map(norm).filter(Boolean) : [];
  if (!arr.length) return { nextMoves: arr, changed: false, invalidMoves: [], replacements: [] };

  const invalidIdx = [];
  for (let i = 0; i < arr.length; i += 1) {
    if (!buckets.all.has(arr[i])) invalidIdx.push(i);
  }
  if (!invalidIdx.length) return { nextMoves: arr, changed: false, invalidMoves: [], replacements: [] };

  const used = new Set(arr.filter((m) => buckets.all.has(m)));
  const replPool = buckets.levelOrdered.map((x) => x.moveId).filter(Boolean);
  const next = [...arr];
  const replacements = [];

  for (const idx of invalidIdx) {
    const before = next[idx];
    let candidate = replPool.find((m) => !used.has(m));
    if (!candidate) candidate = replPool[0] || null;
    if (!candidate) continue;
    next[idx] = candidate;
    used.add(candidate);
    replacements.push({ from: before, to: candidate, index: idx });
  }

  const changed = JSON.stringify(next) !== JSON.stringify(arr);
  return { nextMoves: next, changed, invalidMoves: invalidIdx.map((i) => arr[i]), replacements };
}

async function fetchCollectionGroupPaged(db, admin, name, pageSize = 500) {
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
  const execute = argv.includes("--execute");
  const dryRun = !execute || argv.includes("--dry-run");
  const exportIdx = argv.indexOf("--export-before");
  const exportPath = exportIdx >= 0 && argv[exportIdx + 1] ? argv[exportIdx + 1] : null;

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
  const dexMoves = JSON.parse(readFileSync(movesBySpecies, "utf8"));

  const rawDocs = [];
  for (const sub of ["box", "time"]) {
    const docs = await fetchCollectionGroupPaged(db, admin, sub);
    rawDocs.push(...docs.map((d) => ({ ref: d.ref, path: d.ref.path.replace(/\\/g, "/"), data: d.data() || {} })));
  }

  const docs = rawDocs.filter((r) => shouldIncludeDoc(r.path));
  const actions = [];

  for (const r of docs) {
    const sid = String(Math.trunc(Number(r.data.speciesId || 0)));
    if (!sid || sid === "0") continue;
    const buckets = buildLearnsetBuckets(dexMoves[sid] || {});
    if (!buckets.all.size) continue;
    const changed = replaceInvalidMoves(r.data.moves, buckets);
    if (!changed.changed) continue;
    actions.push({
      ref: r.ref,
      path: r.path,
      speciesId: Number(sid),
      beforeMoves: Array.isArray(r.data.moves) ? r.data.moves : [],
      afterMoves: changed.nextMoves,
      invalidMoves: changed.invalidMoves,
      replacements: changed.replacements,
    });
  }

  if (exportPath && actions.length) {
    writeFileSync(
      exportPath,
      JSON.stringify(
        actions.map((a) => ({
          path: a.path,
          speciesId: a.speciesId,
          beforeMoves: a.beforeMoves,
          afterMoves: a.afterMoves,
          invalidMoves: a.invalidMoves,
          replacements: a.replacements,
        })),
        null,
        2
      ),
      "utf8"
    );
  }

  let updated = 0;
  let batchCommits = 0;
  if (execute && actions.length) {
    let batch = db.batch();
    let n = 0;
    for (const a of actions) {
      batch.update(a.ref, { moves: a.afterMoves });
      updated += 1;
      n += 1;
      if (n >= 500) {
        await batch.commit();
        batchCommits += 1;
        batch = db.batch();
        n = 0;
      }
    }
    if (n > 0) {
      await batch.commit();
      batchCommits += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun,
        execute,
        docsScanned: docs.length,
        docsWithInvalidMoves: actions.length,
        docsUpdated: execute ? updated : 0,
        batchCommits,
        exportBeforePath: exportPath || null,
        samples: actions.slice(0, 20).map((a) => ({
          path: a.path,
          speciesId: a.speciesId,
          invalidMoves: a.invalidMoves,
          replacements: a.replacements,
          beforeMoves: a.beforeMoves,
          afterMoves: a.afterMoves,
        })),
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

