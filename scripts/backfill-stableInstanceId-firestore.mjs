/**
 * Backfill real: preenche `stableInstanceId` ausente em documentos Pokémon (`box` e `time`).
 *
 * Segurança:
 * - Nunca sobrescreve um `stableInstanceId` já existente com comprimento ≥ 16 (UUID).
 * - `--dry-run` apenas conta; `--execute` grava em lotes de 500.
 * - Opcional: `--export-before <path>` exporta snapshot JSON dos docs que seriam alterados (antes do write).
 *
 * Uso (raiz do repo):
 *   node admin/scripts/backfill-stableInstanceId-firestore.mjs --dry-run
 *   node admin/scripts/backfill-stableInstanceId-firestore.mjs --execute
 *   node admin/scripts/backfill-stableInstanceId-firestore.mjs --execute --export-before ./backup-pre-stableId.json
 *
 * Credenciais: admin/serviceAccountKey.json
 */
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const adminRoot = join(__dirname, "..");
const keyPath = join(adminRoot, "serviceAccountKey.json");
const require = createRequire(import.meta.url);

function normPath(p) {
  return String(p || "").replace(/\\/g, "/");
}

function shouldIncludeDoc(path) {
  if (path.includes("/_meta")) return false;
  if (path.includes("users/test_")) return false;
  return true;
}

function isStableIdPresent(raw) {
  const s = String(raw ?? "").trim();
  return s.length >= 16;
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
  const dryRun = argv.includes("--dry-run") || !argv.includes("--execute");
  const execute = argv.includes("--execute");
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

  const rawDocs = [];
  for (const sub of ["box", "time"]) {
    const docs = await fetchCollectionGroupPaged(db, admin, sub);
    rawDocs.push(...docs.map((d) => ({ ref: d.ref, path: normPath(d.ref.path), data: d.data() || {} })));
  }

  const candidates = rawDocs.filter(({ path }) => shouldIncludeDoc(path));
  let processed = candidates.length;
  let wouldFix = 0;
  const toWrite = [];

  for (const { ref, path, data } of candidates) {
    if (isStableIdPresent(data.stableInstanceId)) continue;
    wouldFix += 1;
    const newId = randomUUID();
    toWrite.push({ ref, path, previousStableInstanceId: data.stableInstanceId ?? null, newStableInstanceId: newId });
  }

  if (exportPath && toWrite.length) {
    const payload = toWrite.map((t) => ({
      path: t.path,
      previousStableInstanceId: t.previousStableInstanceId,
      newStableInstanceId: t.newStableInstanceId,
    }));
    writeFileSync(exportPath, JSON.stringify(payload, null, 2), "utf8");
  }

  let batchesCommitted = 0;
  let updated = 0;
  if (execute && toWrite.length) {
    let batch = db.batch();
    let n = 0;
    for (const row of toWrite) {
      batch.update(row.ref, { stableInstanceId: row.newStableInstanceId });
      n += 1;
      updated += 1;
      if (n >= 500) {
        await batch.commit();
        batchesCommitted += 1;
        batch = db.batch();
        n = 0;
      }
    }
    if (n > 0) {
      await batch.commit();
      batchesCommitted += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun,
        execute: Boolean(execute),
        documentsProcessed: processed,
        documentsNeedingStableId: wouldFix,
        documentsUpdated: execute ? updated : 0,
        batchCommits: execute ? batchesCommitted : 0,
        exportBeforePath: exportPath || null,
        collisionRisk:
          "UUID v4: colisão desprezível; IDs existentes (≥16 chars) nunca são substituídos.",
        strategy:
          "collectionGroup(box|time) paginado por documentId; update só se stableInstanceId ausente ou <16 chars.",
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
