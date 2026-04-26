/**
 * 1) Cura o HP de todos os Pokémon (`box` + `time`): `hp.current = hp.total`
 *    (se total inválido, usa `fullHpForSpeciesAtLevel`).
 * 2) Concede 5 Rare Candy (`rare-candy`) por personagem, idempotente via
 *    `itemGrants.{grantId}` (use `--force-candy` para somar de novo).
 *
 * Uso (raiz do repo, `admin/serviceAccountKey.json`):
 *   node admin/scripts/heal-all-pokemon-grant-rare-candy.mjs --dry-run
 *   node admin/scripts/heal-all-pokemon-grant-rare-candy.mjs --execute
 *
 *   --grantId=<id>   Default: heal-hp-rare-candy5-v1
 *   --uid=<uid>      Só um jogador
 *   --force-candy    Ignora itemGrants e adiciona +5 de novo
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const adminRoot = join(__dirname, "..");
const keyPath = join(adminRoot, "serviceAccountKey.json");
const require = createRequire(import.meta.url);

const { fullHpForSpeciesAtLevel } = require(join(adminRoot, "functions/pokemonStatCalc.js"));

const RARE_CANDY_ID = "rare-candy";
const RARE_CANDY_QTY = 5;
const RARE_CANDY_PATCH = {
  id: RARE_CANDY_ID,
  name: "Rare Candy",
  kind: "ITEM",
  consumable: true,
  effectType: "LEVEL_UP",
  levelGain: 1,
};

function parseArgs() {
  const argv = process.argv.slice(2);
  const out = {
    dryRun: !argv.includes("--execute"),
    uid: "",
    grantId: "heal-hp-rare-candy5-v1",
    forceCandy: argv.includes("--force-candy"),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--uid=")) out.uid = a.slice(6).trim();
    else if (a === "--uid" && argv[i + 1]) out.uid = String(argv[++i]).trim();
    else if (a.startsWith("--grantId=")) out.grantId = a.slice(10).trim();
    else if (a === "--grantId" && argv[i + 1]) out.grantId = String(argv[++i]).trim();
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

function normPath(p) {
  return String(p || "").replace(/\\/g, "/");
}

function asInt(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

async function fetchCollectionGroupPaged(db, admin, name, pageSize = 400) {
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

function resolveHealHp(data) {
  const speciesId = Math.max(1, asInt(data.speciesId, 0));
  if (speciesId <= 0) return null;
  const level = Math.max(1, asInt(data.level, 1));
  const ivs = data.ivs && typeof data.ivs === "object" ? data.ivs : { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  const evs = data.evs && typeof data.evs === "object" ? data.evs : { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

  let total = Math.max(0, asInt(data.hp?.total, 0));
  if (total <= 0) {
    const computed = fullHpForSpeciesAtLevel(speciesId, level, ivs, evs);
    total = Math.max(1, asInt(computed?.total, 1));
  }
  const current = Math.max(0, asInt(data.hp?.current, 0));
  if (current === total && total > 0) return null;
  return { current: total, total };
}

async function upsertItemWithMeta(db, FieldValue, { uid, characterId, itemId, delta, patch }) {
  const itemRef = db.doc(`players/${uid}/characters/${characterId}/itens/${itemId}`);
  const metaRef = db.doc(`players/${uid}/characters/${characterId}/itens/_meta`);
  await db.runTransaction(async (tx) => {
    const [itemSnap, metaSnap] = await Promise.all([tx.get(itemRef), tx.get(metaRef)]);
    const prevQty = Math.max(0, Math.floor(Number(itemSnap.data()?.quantity || 0)));
    const nextQty = Math.max(0, prevQty + delta);
    const prevTotal = Math.max(0, Math.floor(Number(metaSnap.data()?.totalQuantity || 0)));
    const nextTotal = Math.max(0, prevTotal + (nextQty - prevQty));

    tx.set(
      itemRef,
      {
        id: itemId,
        quantity: nextQty,
        updatedAt: FieldValue.serverTimestamp(),
        ...(patch || {}),
      },
      { merge: true }
    );
    tx.set(metaRef, { totalQuantity: nextTotal, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
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
  const { dryRun, uid: filterUid, grantId, forceCandy } = parseArgs();
  const admin = initAdmin();
  const db = admin.firestore();
  const { FieldValue } = admin.firestore;

  console.log(
    JSON.stringify({ ok: true, step: "start", dryRun, grantId, forceCandy, filterUid: filterUid || null }, null, 2)
  );

  const healOps = [];
  for (const sub of ["box", "time"]) {
    const docs = await fetchCollectionGroupPaged(db, admin, sub);
    for (const d of docs) {
      const path = normPath(d.ref.path);
      if (path.includes("/_meta")) continue;
      if (!/^players\/[^/]+\/characters\/[^/]+\/(box|time)\//.test(path)) continue;
      const hp = resolveHealHp(d.data() || {});
      if (!hp) continue;
      healOps.push({ ref: d.ref, hp });
    }
  }

  console.log(JSON.stringify({ ok: true, step: "heal_planned", count: healOps.length }, null, 2));

  if (!dryRun && healOps.length) {
    let batch = db.batch();
    let n = 0;
    let batches = 0;
    for (const op of healOps) {
      batch.update(op.ref, { hp: op.hp, updatedAt: FieldValue.serverTimestamp() });
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
    console.log(JSON.stringify({ ok: true, step: "heal_done", updated: healOps.length, batches }, null, 2));
  }

  let playersVisited = 0;
  let charsProcessed = 0;
  let candyGranted = 0;
  let candySkipped = 0;
  let candyFailed = 0;

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
      candyFailed += 1;
      continue;
    }
    for (const cd of charsSnap.docs) {
      charsProcessed += 1;
      const charData = cd.data() || {};
      const already = charData.itemGrants?.[grantId];
      if (already && !forceCandy) {
        candySkipped += 1;
        continue;
      }
      if (dryRun) {
        candyGranted += 1;
        continue;
      }
      try {
        await upsertItemWithMeta(db, FieldValue, {
          uid: p.id,
          characterId: cd.id,
          itemId: RARE_CANDY_ID,
          delta: RARE_CANDY_QTY,
          patch: RARE_CANDY_PATCH,
        });
        const charRef = db.doc(`players/${p.id}/characters/${cd.id}`);
        await charRef.update({
          [`itemGrants.${grantId}`]: {
            grantedAt: FieldValue.serverTimestamp(),
            items: [{ itemId: RARE_CANDY_ID, qty: RARE_CANDY_QTY }],
            note: "heal-all-pokemon-grant-rare-candy.mjs",
          },
          updatedAt: FieldValue.serverTimestamp(),
        });
        candyGranted += 1;
      } catch (e) {
        console.warn(`candy fail ${p.id}/${cd.id}:`, e?.message || e);
        candyFailed += 1;
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        step: "done",
        dryRun,
        healWouldUpdate: healOps.length,
        healUpdated: dryRun ? 0 : healOps.length,
        playersVisited,
        charactersProcessed: charsProcessed,
        rareCandyGranted: candyGranted,
        rareCandySkipped: candySkipped,
        rareCandyFailed: candyFailed,
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
