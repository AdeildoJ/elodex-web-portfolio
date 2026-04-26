/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");

function loadServiceAccount() {
  const p = path.join(__dirname, "..", "serviceAccountKey.json");
  if (!fs.existsSync(p)) {
    throw new Error(`serviceAccountKey.json nao encontrado em ${p}`);
  }
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  return {
    projectId: raw.project_id,
    clientEmail: raw.client_email,
    privateKey: String(raw.private_key || "").replace(/\\n/g, "\n"),
  };
}

async function deleteCollectionDocs(db, colPath) {
  const snap = await db.collection(colPath).get();
  let count = 0;
  for (const d of snap.docs) {
    await d.ref.delete();
    count += 1;
  }
  return count;
}

async function run() {
  const sa = loadServiceAccount();
  const app =
    getApps()[0] ||
    initializeApp({
      credential: cert(sa),
      projectId: sa.projectId,
      storageBucket: `${sa.projectId}.appspot.com`,
    });
  const db = getFirestore(app);
  const storage = getStorage(app);

  const result = {
    playersVisited: 0,
    charactersDeleted: 0,
    storagePrefixesDeleted: 0,
    selectedCharacterCleared: 0,
    characterPublicIdsDeleted: 0,
    friendTradesDeleted: 0,
    startedAt: new Date().toISOString(),
  };

  console.log("[wipe-characters] lendo players...");
  const playersSnap = await db.collection("players").get();
  result.playersVisited = playersSnap.size;

  for (const playerDoc of playersSnap.docs) {
    const uid = playerDoc.id;
    const charsSnap = await db.collection(`players/${uid}/characters`).get();
    for (const charDoc of charsSnap.docs) {
      const charId = charDoc.id;
      await db.recursiveDelete(charDoc.ref);
      result.charactersDeleted += 1;

      const prefix = `players/${uid}/characters/${charId}/`;
      try {
        await storage.bucket().deleteFiles({ prefix, force: true });
      } catch {
        // ignore storage cleanup errors
      }
      result.storagePrefixesDeleted += 1;
    }

    const selected = String(playerDoc.data()?.selectedCharacterId || "").trim();
    if (selected) {
      await playerDoc.ref.set(
        {
          selectedCharacterId: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      result.selectedCharacterCleared += 1;
    }
  }

  result.characterPublicIdsDeleted = await deleteCollectionDocs(db, "characterPublicIds");
  result.friendTradesDeleted = await deleteCollectionDocs(db, "friendTrades");
  result.finishedAt = new Date().toISOString();

  console.log("[wipe-characters] concluido:");
  console.log(JSON.stringify(result, null, 2));
}

run().catch((err) => {
  console.error("[wipe-characters] erro:", err?.message || err);
  process.exit(1);
});
