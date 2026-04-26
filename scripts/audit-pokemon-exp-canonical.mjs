/**
 * Varredura: todos os Pokémon em `box` e `time` com `exp` compatível com o nível
 * (curva Medium Fast, mesmo `expToNextForLevel` do app).
 *
 *   --fix         Grava `exp` + `expCurrent` + `expToNext` alinhados ao `level` (não muda o nível).
 *                 Zera `current` se estiver incompatível ou ausente; `toNext` canônico.
 *
 *   node admin/scripts/audit-pokemon-exp-canonical.mjs
 *   node admin/scripts/audit-pokemon-exp-canonical.mjs --fix
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

function readExpState(data) {
  const hasNested = data.exp && typeof data.exp === "object";
  const currentFromNested = hasNested ? asInt(data.exp.current, NaN) : NaN;
  const toNextFromNested = hasNested ? asInt(data.exp.toNext, NaN) : NaN;
  const currentRoot = asInt(data.expCurrent, NaN);
  const toNextRoot = asInt(data.expToNext, NaN);
  return {
    current: Number.isFinite(currentFromNested) ? currentFromNested : Number.isFinite(currentRoot) ? currentRoot : null,
    toNext: Number.isFinite(toNextFromNested) ? toNextFromNested : Number.isFinite(toNextRoot) ? toNextRoot : null,
  };
}

function classify(data) {
  const level = Math.max(1, Math.min(100, asInt(data.level, 1)));
  const speciesId = asInt(data.speciesId, 0);
  if (speciesId <= 0) return { status: "skip", reason: "no_species" };
  const canonical = expToNextForLevel(level);
  const s = readExpState(data);
  if (s.toNext == null && s.current == null) return { status: "bad", reason: "missing_exp", level, speciesId, canonicalToNext: canonical };
  if (s.toNext != null && Math.trunc(s.toNext) !== Math.trunc(canonical)) {
    return { status: "bad", reason: "toNext_mismatch", level, speciesId, canonicalToNext: canonical, storedToNext: s.toNext, current: s.current };
  }
  if (s.toNext == null) return { status: "bad", reason: "missing_toNext", level, speciesId, canonicalToNext: canonical, current: s.current };
  const cap = s.toNext - 1;
  if (s.current != null && s.current < 0) return { status: "bad", reason: "current_negative", level, speciesId, canonicalToNext: canonical, storedToNext: s.toNext, current: s.current };
  if (s.current != null && s.current > cap) {
    return { status: "bad", reason: "current_overflow", level, speciesId, canonicalToNext: canonical, storedToNext: s.toNext, current: s.current };
  }
  return { status: "ok", level, speciesId, canonicalToNext: canonical };
}

function buildExpPatch(data) {
  const level = Math.max(1, Math.min(100, asInt(data.level, 1)));
  const toNext = expToNextForLevel(level);
  const s = readExpState(data);
  let current = 0;
  if (s.current != null && Number.isFinite(s.current) && s.current >= 0 && s.current < toNext) {
    current = s.current;
  }
  return {
    exp: { current, toNext },
    expCurrent: current,
    expToNext: toNext,
  };
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
  const doFix = argv.includes("--fix");
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

  const bad = [];
  const ok = [];
  const skipped = [];

  for (const d of playerMonDocs) {
    const data = d.data() || {};
    const c = classify(data);
    if (c.status === "skip") {
      skipped.push({ path: normPath(d.ref.path), reason: c.reason });
    } else if (c.status === "ok") {
      ok.push(normPath(d.ref.path));
    } else {
      bad.push({
        path: normPath(d.ref.path),
        ...c,
      });
    }
  }

  const report = {
    ok: true,
    mode: doFix ? "fix" : "audit_only",
    collectionGroupDocs: playerMonDocs.length,
    compatible: ok.length,
    incompatible: bad.length,
    skipped: skipped.length,
    allCompatible: bad.length === 0,
    bad,
    fixApplied: 0,
  };

  if (doFix && bad.length) {
    let batch = db.batch();
    let n = 0;
    let batches = 0;
    for (const row of bad) {
      if (row.path.includes("/time/") || row.path.includes("/box/")) {
        const ref = db.doc(row.path);
        const snap = await ref.get();
        if (!snap.exists) continue;
        const patch = buildExpPatch(snap.data() || {});
        batch.update(ref, { ...patch, updatedAt: FieldValue.serverTimestamp() });
        n += 1;
        report.fixApplied += 1;
        if (n >= 400) {
          await batch.commit();
          batches += 1;
          batch = db.batch();
          n = 0;
        }
      }
    }
    if (n > 0) {
      await batch.commit();
      batches += 1;
    }
    report.batchesCommitted = batches;
  }

  const json = JSON.stringify(report, null, 2);
  console.log(json);
  if (outFile) {
    writeFileSync(outFile, json, "utf8");
    console.error(`Wrote: ${outFile}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
