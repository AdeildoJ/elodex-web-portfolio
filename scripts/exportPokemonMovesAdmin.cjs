// @ts-nocheck

const { writeFileSync, mkdirSync } = require("fs");
const { join } = require("path");
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

// Carrega a service account
const serviceAccount = require("../secrets/serviceAccountKey.json");

// Inicializa o firebase-admin
initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore();

/**
 * Este script lê TODOS os documentos da coleção "pokemonMoves"
 * e gera src/data/pokemonMoves.json com:
 *
 * {
 *   "001": { moves: [ { moveId, method, level }, ... ] },
 *   "004": { moves: [...] },
 *   ...
 * }
 */
async function run() {
  console.log("Iniciando exportação ADMIN de 'pokemonMoves' para JSON...");

  const snapshot = await db.collection("pokemonMoves").get();

  console.log(
    `Encontrados ${snapshot.size} documentos na coleção 'pokemonMoves'.`
  );

  const result = {};

  snapshot.forEach((docSnap) => {
    const d = docSnap.data() || {};
    const movesArray = Array.isArray(d.moves) ? d.moves : [];

    result[docSnap.id] = {
      moves: movesArray.map((m) => ({
        moveId: m.moveId,
        method: m.method,
        level:
          m.level === undefined || m.level === null ? null : Number(m.level),
      })),
    };
  });

  const outDir = join(process.cwd(), "src", "data");
  mkdirSync(outDir, { recursive: true });

  const outPath = join(outDir, "pokemonMoves.json");
  writeFileSync(outPath, JSON.stringify(result, null, 2), "utf-8");

  console.log(`✅ Arquivo gerado em: ${outPath}`);
}

run()
  .then(() => {
    console.log("Exportação ADMIN de 'pokemonMoves' concluída!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Erro ao exportar 'pokemonMoves' (admin):", err);
    process.exit(1);
  });
