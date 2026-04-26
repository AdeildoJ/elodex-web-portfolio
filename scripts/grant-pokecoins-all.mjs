/**
 * Adiciona PokeCoins a todos os personagens (`players/{uid}/characters/{cid}.pokeCoins`).
 * Idempotente: `itemGrants.{grantId}` evita somar de novo na mesma campanha.
 *
 * Uso (raiz do repo, `admin/serviceAccountKey.json`):
 *   node admin/scripts/grant-pokecoins-all.mjs --dry-run
 *   node admin/scripts/grant-pokecoins-all.mjs --execute
 *
 *   --amount=1500     Default: 1500
 *   --grantId=<id>    Default: pokecoins-1500-v1
 *   --uid=<uid>       Só um jogador
 *   --force           Ignora itemGrants e incrementa de novo
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const adminRoot = join(__dirname, "..");
const keyPath = join(adminRoot, "serviceAccountKey.json");
const require = createRequire(import.meta.url);

function parseArgs() {
  const argv = process.argv.slice(2);
  const out = {
    dryRun: !argv.includes("--execute"),
    uid: "",
    grantId: "pokecoins-1500-v1",
    amount: 1500,
    force: argv.includes("--force"),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--uid=")) out.uid = a.slice(6).trim();
    else if (a === "--uid" && argv[i + 1]) out.uid = String(argv[++i]).trim();
    else if (a.startsWith("--grantId=")) out.grantId = a.slice(10).trim();
    else if (a === "--grantId" && argv[i + 1]) out.grantId = String(argv[++i]).trim();
    else if (a.startsWith("--amount=")) out.amount = Math.max(0, Math.floor(Number(a.slice(9)) || 0));
    else if (a === "--amount" && argv[i + 1]) out.amount = Math.max(0, Math.floor(Number(argv[++i]) || 0));
  }
  return out;
}

function initAdmin() {
  if (!existsSync(keyPath)) {
    console.error(JSON.stringify({ ok: false, error: "missing_service_account", path: keyPath }));
    process.exit(2);
  }
  const admin = require("firebase-admin");
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(readFileSync(keyPath, "utf8"))),
    });
  }
  return admin;
}

async function* streamCollectionPaged(collRef, pageSize) {
  let q = collRef.orderBy("__name__").limit(pageSize);
  let last = null;
  for (;;) {
    const snap = last ? await q.startAfter(last).get() : await q.get();
    if (snap.empty) return;
    for (const d of snap.docs) yield { id: d.id, ref: d.ref };
    if (snap.docs.length < pageSize) return;
    last = snap.docs[snap.docs.length - 1];
  }
}

async function main() {
  const { dryRun, uid: filterUid, grantId, amount, force } = parseArgs();
  if (amount <= 0) {
    console.error(JSON.stringify({ ok: false, error: "amount_must_be_positive" }));
    process.exit(1);
  }

  const admin = initAdmin();
  const db = admin.firestore();
  const { FieldValue } = admin.firestore;

  console.log(
    JSON.stringify({ ok: true, step: "start", dryRun, grantId, amount, force, filterUid: filterUid || null }, null, 2)
  );

  let playersVisited = 0;
  let charsProcessed = 0;
  let granted = 0;
  let skipped = 0;
  let failed = 0;

  const playersIter = filterUid
    ? (async function* () {
        const ref = db.doc(`players/${filterUid}`);
        const snap = await ref.get();
        if (snap.exists) yield { id: filterUid, ref };
      })()
    : streamCollectionPaged(db.collection("players"), 500);

  for await (const p of playersIter) {
    playersVisited += 1;
    let charsSnap;
    try {
      charsSnap = await p.ref.collection("characters").get();
    } catch (e) {
      console.warn(`characters list fail ${p.id}:`, e?.message || e);
      failed += 1;
      continue;
    }
    for (const cd of charsSnap.docs) {
      charsProcessed += 1;
      const charData = cd.data() || {};
      const already = charData.itemGrants?.[grantId];
      if (already && !force) {
        skipped += 1;
        continue;
      }
      if (dryRun) {
        granted += 1;
        continue;
      }
      try {
        const charRef = db.doc(`players/${p.id}/characters/${cd.id}`);
        // Não usar set(merge) em `itemGrants` inteiro — apagaria outros grants. Só esta chave:
        await charRef.update({
          pokeCoins: FieldValue.increment(amount),
          [`itemGrants.${grantId}`]: {
            grantedAt: FieldValue.serverTimestamp(),
            pokeCoinsDelta: amount,
            note: "grant-pokecoins-all.mjs",
          },
          updatedAt: FieldValue.serverTimestamp(),
        });
        granted += 1;
      } catch (e) {
        console.warn(`grant fail ${p.id}/${cd.id}:`, e?.message || e);
        failed += 1;
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        step: "done",
        dryRun,
        amount,
        grantId,
        playersVisited,
        charactersProcessed: charsProcessed,
        pokeCoinsGrants: granted,
        skipped,
        failed,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
