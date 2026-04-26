/**
 * Limpa referências a biomas que não existem mais em `biomes/{id}`.
 * Não remove documentos em `biomes` — apenas dados órfãos (encontros, jogadores, gyms, pool).
 *
 * Pré-requisito: credencial Admin (uma opção):
 *   - gcloud auth application-default login
 *   - ou variável GOOGLE_APPLICATION_CREDENTIALS apontando para JSON de service account
 *
 * Uso:
 *   node scripts/pruneStaleBiomeRefs.js --dry-run
 *   node scripts/pruneStaleBiomeRefs.js
 *
 * Opções:
 *   --dry-run            só imprime o que seria feito
 *   --keep-orphan-gyms   não apaga gyms/{leaderUid} cujo biomeId não existe mais
 *
 * Variável opcional: BIOME_ENCOUNTER_VERSION (default: elodex-base)
 */

const { applicationDefault, initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, FieldPath } = require("firebase-admin/firestore");

initializeApp({ credential: applicationDefault() });

const db = getFirestore();

const ENCOUNTER_VERSION = String(process.env.BIOME_ENCOUNTER_VERSION || "elodex-base").trim();

function parseArgs() {
  const argv = process.argv.slice(2);
  return {
    dryRun: argv.includes("--dry-run"),
    keepOrphanGyms: argv.includes("--keep-orphan-gyms"),
  };
}

async function deleteDocRecursive(docRef) {
  const subs = await docRef.listCollections();
  for (const sub of subs) {
    const snap = await sub.get();
    for (const subDoc of snap.docs) {
      await deleteDocRecursive(subDoc.ref);
    }
  }
  await docRef.delete();
}

function biomeIdFromEncounterRootDocId(docId) {
  const prefix = `${ENCOUNTER_VERSION}_`;
  if (!String(docId || "").startsWith(prefix)) return null;
  return String(docId.slice(prefix.length)).trim().toLowerCase() || null;
}

async function loadValidBiomeIds() {
  const snap = await db.collection("biomes").get();
  const valid = new Set();
  for (const d of snap.docs) {
    const id = String(d.id || "").trim().toLowerCase();
    if (id) valid.add(id);
  }
  return valid;
}

async function pruneBiomeEncounterConfigs(valid, dryRun, summary) {
  const snap = await db.collection("biomeEncounterConfig").get();
  for (const d of snap.docs) {
    const bid = biomeIdFromEncounterRootDocId(d.id);
    if (bid == null) continue;
    if (valid.has(bid)) continue;
    summary.biomeEncounterRootsRemoved += 1;
    if (!dryRun) await deleteDocRecursive(d.ref);
  }
}

async function prunePlayerSubcollections(valid, dryRun, summary) {
  const playersSnap = await db.collection("players").get();
  for (const p of playersSnap.docs) {
    const charsSnap = await p.ref.collection("characters").get();
    for (const c of charsSnap.docs) {
      const exploreSnap = await c.ref.collection("explore_biomes").get();
      for (const row of exploreSnap.docs) {
        const id = String(row.id || "").trim().toLowerCase();
        if (!id || valid.has(id)) continue;
        summary.exploreBiomesDocsRemoved += 1;
        if (!dryRun) await row.ref.delete();
      }
      const accessSnap = await c.ref.collection("biome_access").get();
      for (const row of accessSnap.docs) {
        const id = String(row.id || "").trim().toLowerCase();
        if (!id || valid.has(id)) continue;
        summary.biomeAccessDocsRemoved += 1;
        if (!dryRun) await row.ref.delete();
      }
    }
  }
}

async function pruneGyms(valid, dryRun, keepOrphanGyms, summary) {
  if (keepOrphanGyms) return;
  const snap = await db.collection("gyms").get();
  for (const g of snap.docs) {
    const data = g.data() || {};
    const bid = String(data.biomeId || "").trim().toLowerCase();
    if (!bid || valid.has(bid)) continue;
    summary.gymsRemoved += 1;
    if (dryRun) continue;
    const nameKey = String(data.name || "").trim().toLowerCase();
    const leaderUid = g.id;
    if (nameKey) {
      await db
        .collection("gymNames")
        .doc(nameKey)
        .delete()
        .catch(() => {});
    }
    await deleteDocRecursive(g.ref);
    await db
      .collection("players")
      .doc(leaderUid)
      .set({ gymOwnership: FieldValue.delete(), updatedAt: new Date() }, { merge: true });
  }
}

async function pruneReleasedPokemonPool(valid, dryRun, summary) {
  const pageSize = 400;
  let last = null;
  for (;;) {
    let q = db.collection("releasedPokemonPool").orderBy(FieldPath.documentId()).limit(pageSize);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      const bid = String(d.data()?.biomeId || "").trim().toLowerCase();
      if (!bid || valid.has(bid)) continue;
      summary.releasedPokemonPoolRemoved += 1;
      if (!dryRun) await d.ref.delete();
    }
    if (snap.size < pageSize) break;
    last = snap.docs[snap.docs.length - 1];
  }
}

async function main() {
  const { dryRun, keepOrphanGyms } = parseArgs();
  const valid = await loadValidBiomeIds();

  const summary = {
    validBiomeCount: valid.size,
    biomeEncounterRootsRemoved: 0,
    exploreBiomesDocsRemoved: 0,
    biomeAccessDocsRemoved: 0,
    gymsRemoved: 0,
    releasedPokemonPoolRemoved: 0,
  };

  await pruneBiomeEncounterConfigs(valid, dryRun, summary);
  await prunePlayerSubcollections(valid, dryRun, summary);
  await pruneGyms(valid, dryRun, keepOrphanGyms, summary);
  await pruneReleasedPokemonPool(valid, dryRun, summary);

  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun,
        encounterVersion: ENCOUNTER_VERSION,
        keepOrphanGyms,
        summary,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
