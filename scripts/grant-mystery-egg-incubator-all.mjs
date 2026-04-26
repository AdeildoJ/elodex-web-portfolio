/**
 * Entrega 1 ovo misterioso (`mystery-egg`) e 1 incubadora (`egg-incubator`) para TODOS
 * os personagens de TODOS os jogadores.
 *
 * Operação idempotente: mantém um marcador em
 *   players/{uid}/characters/{cid}/itens/_grants/{grantId}
 * para pular personagens já beneficiados por este grant, de modo que reexecuções
 * não duplicam a entrega.
 *
 * Uso (na raiz do repo, com admin/serviceAccountKey.json disponivel):
 *   node admin/scripts/grant-mystery-egg-incubator-all.mjs
 *   node admin/scripts/grant-mystery-egg-incubator-all.mjs --grantId=2026-04-pvpfix
 *   node admin/scripts/grant-mystery-egg-incubator-all.mjs --dryRun
 *   node admin/scripts/grant-mystery-egg-incubator-all.mjs --uid=<UID>   # limita a um jogador
 *
 * Flags:
 *   --grantId=<id>   Identificador do grant (default: compensation-<YYYY-MM-DD>).
 *   --uid=<uid>      Limita a execução a um único jogador (teste).
 *   --dryRun         Apenas loga o que faria, sem gravar.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const adminRoot = join(__dirname, "..");
const keyPath = join(adminRoot, "serviceAccountKey.json");
const require = createRequire(import.meta.url);

const MYSTERY_EGG_ITEM_ID = "mystery-egg";
const EGG_INCUBATOR_ITEM_ID = "egg-incubator";

const MYSTERY_EGG_PATCH = {
  name: "Ovo misterioso",
  description: "Coloque na incubadora pela Mochila.",
  consumable: true,
  kind: "ITEM",
};
const EGG_INCUBATOR_PATCH = {
  name: "Incubadora",
  description: "Usada para chocar ovos que exigem incubadora.",
  consumable: true,
  kind: "ITEM",
};

function parseArgs() {
  const out = { uid: "", grantId: "", dryRun: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dryRun" || a === "--dry-run") out.dryRun = true;
    else if (a.startsWith("--uid=")) out.uid = a.slice(6).trim();
    else if (a === "--uid" && argv[i + 1]) { out.uid = String(argv[++i]).trim(); }
    else if (a.startsWith("--grantId=")) out.grantId = a.slice(10).trim();
    else if (a === "--grantId" && argv[i + 1]) { out.grantId = String(argv[++i]).trim(); }
  }
  if (!out.grantId) {
    const now = new Date();
    const ymd = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
    out.grantId = `compensation-${ymd}`;
  }
  return out;
}

function initAdmin() {
  if (!existsSync(keyPath)) {
    console.error("Arquivo de credencial ausente:", keyPath);
    process.exit(1);
  }
  const admin = require("firebase-admin");
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(readFileSync(keyPath, "utf8"))),
    });
  }
  return admin;
}

/**
 * Atualiza um item incrementando sua quantidade e o _meta.totalQuantity, replicando
 * o comportamento de `upsertItemWithMeta` em admin/functions/phase2Mutations.js.
 */
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
    tx.set(
      metaRef,
      { totalQuantity: nextTotal, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
  });
}

async function processCharacter(db, FieldValue, uid, cid, grantId, dryRun, preloadedCharData) {
  // Marcador de idempotência: campo `itemGrants.{grantId}` no doc do personagem.
  const existing = preloadedCharData?.itemGrants?.[grantId];
  if (existing) return { skipped: true };

  if (dryRun) return { granted: true, dryRun: true };

  const charRef = db.doc(`players/${uid}/characters/${cid}`);

  await upsertItemWithMeta(db, FieldValue, {
    uid,
    characterId: cid,
    itemId: MYSTERY_EGG_ITEM_ID,
    delta: 1,
    patch: MYSTERY_EGG_PATCH,
  });
  await upsertItemWithMeta(db, FieldValue, {
    uid,
    characterId: cid,
    itemId: EGG_INCUBATOR_ITEM_ID,
    delta: 1,
    patch: EGG_INCUBATOR_PATCH,
  });
  await charRef.set(
    {
      itemGrants: {
        [grantId]: {
          grantedAt: FieldValue.serverTimestamp(),
          items: [
            { itemId: MYSTERY_EGG_ITEM_ID, qty: 1 },
            { itemId: EGG_INCUBATOR_ITEM_ID, qty: 1 },
          ],
        },
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return { granted: true };
}

async function main() {
  const { uid: filterUid, grantId, dryRun } = parseArgs();
  const admin = initAdmin();
  const db = admin.firestore();
  const { FieldValue } = admin.firestore;

  console.log(`Iniciando grant "${grantId}" ${dryRun ? "(DRY-RUN)" : ""}`);

  let totalPlayers = 0;
  let totalCharactersProcessed = 0;
  let totalCharactersGranted = 0;
  let totalCharactersSkipped = 0;
  let totalFailed = 0;

  const playersIter = filterUid
    ? (async function* () {
        const ref = db.doc(`players/${filterUid}`);
        const snap = await ref.get();
        if (snap.exists) yield { id: filterUid, ref };
      })()
    : streamCollectionPaged(db.collection("players"), 500);

  for await (const p of playersIter) {
    totalPlayers += 1;
    const uid = p.id;
    let charsSnap;
    try {
      charsSnap = await p.ref.collection("characters").get();
    } catch (e) {
      console.warn(`  ! ${uid}: falha ao listar personagens:`, e?.message || e);
      totalFailed += 1;
      continue;
    }
    if (charsSnap.empty) continue;
    for (const cd of charsSnap.docs) {
      totalCharactersProcessed += 1;
      try {
        const r = await processCharacter(db, FieldValue, uid, cd.id, grantId, dryRun, cd.data() || {});
        if (r.skipped) totalCharactersSkipped += 1;
        else totalCharactersGranted += 1;
      } catch (e) {
        console.warn(`  ! ${uid}/${cd.id}: falha ao entregar:`, e?.message || e);
        totalFailed += 1;
      }
    }
    if (totalPlayers % 50 === 0) {
      console.log(
        `...processados ${totalPlayers} jogadores, ${totalCharactersProcessed} personagens (granted=${totalCharactersGranted}, skipped=${totalCharactersSkipped}, failed=${totalFailed})`
      );
    }
  }

  console.log("===== RESUMO =====");
  console.log(`Jogadores visitados: ${totalPlayers}`);
  console.log(`Personagens avaliados: ${totalCharactersProcessed}`);
  console.log(`  Concedidos: ${totalCharactersGranted}`);
  console.log(`  Pulados (já recebeu): ${totalCharactersSkipped}`);
  console.log(`  Falhas: ${totalFailed}`);
}

/** Paginação de coleção grande (evita carregar tudo em memória). */
async function* streamCollectionPaged(collRef, pageSize) {
  let q = collRef.orderBy("__name__").limit(pageSize);
  let last = null;
  while (true) {
    const snap = last ? await q.startAfter(last).get() : await q.get();
    if (snap.empty) return;
    for (const d of snap.docs) yield { id: d.id, ref: d.ref };
    if (snap.docs.length < pageSize) return;
    last = snap.docs[snap.docs.length - 1];
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
