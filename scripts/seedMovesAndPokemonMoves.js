// scripts/seedMovesAndPokemonMoves.js
const axios = require("axios");
const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");

const serviceAccountPath = path.join(__dirname, "../secrets/serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"))
  ),
});

const db = admin.firestore();

/**
 * Busca detalhes do movimento na PokeAPI
 */
async function fetchMoveDetails(moveName) {
  const url = `https://pokeapi.co/api/v2/move/${moveName}`;
  const res = await axios.get(url);
  const d = res.data;

  return {
    id: d.id,
    name: d.name,
    type: d.type?.name,
    category: d.damage_class?.name,
    power: d.power,
    accuracy: d.accuracy,
    pp: d.pp,
    priority: d.priority,
    target: d.target?.name,
    effectText:
      d.effect_entries?.find((e) => e.language.name === "en")?.short_effect ??
      null,
  };
}

async function saveMove(move) {
  const docRef = db.collection("moves").doc(move.name);
  await docRef.set(move, { merge: true });
  console.log("Move salvo:", move.name);
}

async function buildPokemonMovesFromDex() {
  const dexSnap = await db.collection("dex").get();

  for (const docSnap of dexSnap.docs) {
    const data = docSnap.data();
    const speciesId = data.id ?? docSnap.id;
    const moveNames = data.moves ?? [];

    const moves = moveNames.map((name) => ({
      moveId: name,
      method: "level-up",
      level: 1, // placeholder, substituiremos depois
    }));

    await db.collection("pokemonMoves").doc(String(speciesId)).set({
      speciesId,
      moves,
    });

    console.log("pokemonMoves criado para espécie:", speciesId);
  }
}

async function seedFromDex() {
  const dexSnap = await db.collection("dex").get();

  const allMoveNames = new Set();

  dexSnap.forEach((docSnap) => {
    const data = docSnap.data();
    (data.moves ?? []).forEach((name) => allMoveNames.add(name));
  });

  console.log("Total de golpes:", allMoveNames.size);

  for (const name of allMoveNames) {
    try {
      const details = await fetchMoveDetails(name);
      await saveMove(details);
    } catch (err) {
      console.error("Erro ao salvar movimento:", name, err);
    }
  }

  await buildPokemonMovesFromDex();
}

seedFromDex()
  .then(() => {
    console.log("Tudo concluído!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Erro geral:", err);
    process.exit(1);
  });
