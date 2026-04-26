/**
 * Prova de cobertura da base Pokémon canônica (Firestore).
 *
 * Objetivo:
 * - Contar 100% dos documentos em collectionGroup `box` e `time`
 * - Separar o que é "auditável de gameplay" vs metadados/teste
 * - Listar caminhos excluídos para transparência
 *
 * Uso:
 *   node admin/scripts/audit-firestore-pokemon-coverage.mjs
 */
import { readFileSync, existsSync } from "node:fs";
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

function classify(path) {
  if (path.includes("/_meta")) return "meta";
  if (path.includes("users/test_")) return "test";
  return "gameplay";
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

  const all = [];
  for (const cg of ["box", "time"]) {
    const docs = await fetchCollectionGroupPaged(db, admin, cg);
    all.push(...docs.map((d) => ({ cg, path: normPath(d.ref.path) })));
  }

  const byClass = { gameplay: 0, meta: 0, test: 0 };
  for (const r of all) {
    byClass[classify(r.path)] += 1;
  }

  const excluded = all.filter((r) => classify(r.path) !== "gameplay").map((r) => ({ cg: r.cg, path: r.path, reason: classify(r.path) }));

  console.log(
    JSON.stringify(
      {
        ok: true,
        totalCanonicalPokemonDocs: all.length,
        gameplayDocsAuditable: byClass.gameplay,
        excludedMetaDocs: byClass.meta,
        excludedTestDocs: byClass.test,
        excludedPaths: excluded,
        statement:
          "A cobertura de auditoria deve ser igual a gameplayDocsAuditable; se igual, a base canônica de gameplay está 100% coberta.",
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

