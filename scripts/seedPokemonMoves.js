// scripts/seedPokemonMoves.js
const axios = require("axios");
const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");

// 👇 AJUSTE ESSE CAMINHO IGUAL AOS OUTROS SCRIPTS
const serviceAccountPath = path.join(
  __dirname,
  "../secrets/serviceAccountKey.json" // troque o nome se o seu for outro
);

admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"))
  ),
});

const db = admin.firestore();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Normaliza método da PokeAPI para nossos valores
 */
function normalizeMethod(methodName) {
  if (!methodName) return "other";
  switch (methodName) {
    case "level-up":
      return "level-up";
    case "machine":
      return "machine"; // TM/HM
    case "egg":
      return "egg";
    case "tutor":
      return "tutor";
    default:
      return methodName;
  }
}

/**
 * Busca moves que uma espécie pode aprender na versão "sword-shield"
 * usando a PokeAPI: /pokemon/{id}
 */
async function fetchPokemonMovesForSpecies(speciesId) {
  const url = `https://pokeapi.co/api/v2/pokemon/${speciesId}`;
  const res = await axios.get(url);
  const data = res.data;

  const resultMap = {};
  const VERSION_GROUP = "sword-shield";

  for (const moveEntry of data.moves || []) {
    const moveName = moveEntry.move?.name;
    if (!moveName) continue;

    const details = moveEntry.version_group_details || [];

    for (const det of details) {
      const versionGroupName = det.version_group?.name;
      if (versionGroupName !== VERSION_GROUP) continue;

      const methodRaw = det.move_learn_method?.name;
      const method = normalizeMethod(methodRaw);
      const level = det.level_learned_at || 0;

      const key = `${moveName}__${method}`;

      if (resultMap[key]) {
        // Para level-up, guarda sempre o menor nível
        if (method === "level-up") {
          const old = resultMap[key].level || 0;
          if (level > 0 && (old === 0 || level < old)) {
            resultMap[key].level = level;
          }
        }
        continue;
      }

      resultMap[key] = {
        moveId: moveName,
        method,
        level: method === "level-up" ? level : null,
      };
    }
  }

  const moves = Object.values(resultMap);

  // Ordenar: level-up por nível, depois o resto por nome
  moves.sort((a, b) => {
    if (a.method === "level-up" && b.method === "level-up") {
      return (a.level || 0) - (b.level || 0);
    }
    if (a.method === "level-up") return -1;
    if (b.method === "level-up") return 1;
    return (a.moveId || "").localeCompare(b.moveId || "");
  });

  return moves;
}

/**
 * Seed principal:
 * - lê a coleção "pokemonSpecies"
 * - para cada doc, obtém o id correto pra PokeAPI
 * - busca moves reais (Sword/Shield)
 * - salva em pokemonMoves/{speciesId}
 */
async function seedPokemonMovesFromSpecies() {
  console.log("Carregando coleção 'pokemonSpecies' do Firestore...");
  const speciesSnap = await db.collection("pokemonSpecies").get();
  console.log("Total de espécies encontradas:", speciesSnap.size);

  let count = 0;

  for (const docSnap of speciesSnap.docs) {
    const data = docSnap.data();

    // Tenta descobrir qual campo é o ID da Pokédex
    // Ajusta aqui se seus campos tiverem outro nome:
    const speciesId =
      data.nationalDexNumber || data.id || docSnap.id;

    if (!speciesId) {
      console.warn("Espécie sem id numérico:", docSnap.id);
      continue;
    }

    try {
      console.log(
        `Buscando moves para espécie ${speciesId} (doc ${docSnap.id})...`
      );
      const moves = await fetchPokemonMovesForSpecies(speciesId);

      await db
        .collection("pokemonMoves")
        .doc(String(speciesId))
        .set(
          {
            speciesId: speciesId,
            moves,
          },
          { merge: false } // sobrescreve doc antigo
        );

      console.log(
        `✔ pokemonMoves salvo para espécie ${speciesId} com ${moves.length} moves.`
      );
      count++;

      await sleep(150); // delay para não estourar limite da PokeAPI
    } catch (err) {
      console.error(
        `❌ Erro ao processar espécie ${speciesId}:`,
        err.response?.status || err.message || err
      );
      await sleep(500);
    }
  }

  console.log("=================================");
  console.log("Seed pokemonMoves concluído.");
  console.log("Espécies processadas com sucesso:", count);
}

seedPokemonMovesFromSpecies()
  .then(() => {
    console.log("✅ Finalizado com sucesso.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Erro geral no seed:", err);
    process.exit(1);
  });
