const { applicationDefault, initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp({ credential: applicationDefault() });

const db = getFirestore();

async function deleteCollection(path) {
  const snap = await db.collection(path).get();
  for (const docSnap of snap.docs) {
    await deleteDocRecursive(docSnap.ref);
  }
  return snap.size;
}

async function deleteDocRecursive(docRef) {
  const subcollections = await docRef.listCollections();
  for (const sub of subcollections) {
    const snap = await sub.get();
    for (const subDoc of snap.docs) {
      await deleteDocRecursive(subDoc.ref);
    }
  }
  await docRef.delete();
}

async function clearGymOwnershipFromPlayers() {
  const playersSnap = await db.collection("players").get();
  let updated = 0;
  for (const player of playersSnap.docs) {
    const data = player.data() || {};
    if (data.gymOwnership) {
      await player.ref.set(
        {
          gymOwnership: FieldValue.delete(),
          updatedAt: new Date(),
        },
        { merge: true }
      );
      updated += 1;
    }
  }
  return updated;
}

async function clearGymFlagsFromPresence() {
  const snap = await db.collection("battlePresence").where("isGymLeader", "==", true).get();
  for (const row of snap.docs) {
    await row.ref.set(
      {
        isGymLeader: false,
        gymName: "",
        gymType: "",
        gymBadgeImageUrl: "",
        updatedAt: new Date(),
      },
      { merge: true }
    );
  }
  return snap.size;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const summary = {
    gymsDeleted: 0,
    gymNamesDeleted: 0,
    playersCleared: 0,
    presenceCleared: 0,
  };

  if (dryRun) {
    summary.gymsDeleted = (await db.collection("gyms").get()).size;
    summary.gymNamesDeleted = (await db.collection("gymNames").get()).size;
    summary.playersCleared = (await db.collection("players").get()).docs.filter((docSnap) => !!docSnap.data()?.gymOwnership).length;
    summary.presenceCleared = (await db.collection("battlePresence").where("isGymLeader", "==", true).get()).size;
    console.log(JSON.stringify({ dryRun: true, summary }, null, 2));
    return;
  }

  summary.gymsDeleted = await deleteCollection("gyms");
  summary.gymNamesDeleted = await deleteCollection("gymNames");
  summary.playersCleared = await clearGymOwnershipFromPlayers();
  summary.presenceCleared = await clearGymFlagsFromPresence();

  console.log(JSON.stringify({ ok: true, summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
