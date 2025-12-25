// admin/scripts/exportMovesAdmin.cjs
// @ts-nocheck

const { writeFileSync, mkdirSync } = require("fs");
const { join } = require("path");
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

// Service Account
const serviceAccount = require("../secrets/serviceAccountKey.json");

initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore();

// ✅ defaults PT-BR para TM/HM/TR
function buildMachineItem(moveName, machine) {
  if (!machine || !machine.machineItemName) return null;

  const id = machine.machineItemName; // "tm34"
  const name = (machine.machineCode || id).toUpperCase(); // "TM34"
  const kind = machine.machineKind || "other"; // "tm" | "hm" | "tr" | "other"

  // Sprite padrão por tipo
  let sprite = null;
  if (kind === "tm") sprite = "/sprites/items/tm.png";
  else if (kind === "hm") sprite = "/sprites/items/hm.png";
  else if (kind === "tr") sprite = "/sprites/items/tr.png";
  else sprite = "/sprites/items/machine.png";

  // Preço padrão (você pode ajustar depois por tabela)
  let price = null;
  if (kind === "tm") price = 3000;
  if (kind === "hm") price = null; // normalmente HM é key-like
  if (kind === "tr") price = 5000;

  return {
    id,
    name,
    descriptionPtBr:
      "Uma máquina técnica que ensina um movimento a um Pokémon compatível.",
    effectPtBr: "Ensina o movimento associado.",
    category: kind === "other" ? "tm" : kind, // mantém compatível
    subCategory: null,
    price,
    sprite,
    consumable: kind !== "hm", // HM geralmente não-consumível (ajustável)
    battleUsable: false,
    overworldUsable: false,
    moveId: moveName,
    moveNameCache: moveName,
  };
}

async function run() {
  console.log("Iniciando exportação ADMIN de 'moves' para JSON...");

  const snapshot = await db.collection("moves").get();
  console.log(`Encontrados ${snapshot.size} documentos na coleção 'moves'.`);

  const moves = {};

  snapshot.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const moveName = data.name || docSnap.id;

    // ✅ exporta um “move completo”
    const out = {
      // básicos que você já usa hoje
      name: moveName,
      type: data.type ?? null,
      power: data.power ?? null,
      accuracy: data.accuracy ?? null,
      pp: data.pp ?? null,
      damageClass: data.damageClass ?? data.category ?? null, // seu seed antigo usa "category"
      priority: data.priority ?? 0,

      // ✅ extras (seedAllMoves já salva isso no Firestore)
      id: data.id ?? null,
      target: data.target ?? null,
      effectText: data.effectText ?? null,
      flavorText: data.flavorText ?? null,

      // derivados (se existirem)
      statusAilment: data.statusAilment ?? null,
      statusChance: data.statusChance ?? null,
      statChanges: data.statChanges ?? [],
      statChangeChance: data.statChangeChance ?? null,

      flinchChance: data.flinchChance ?? null,
      critStage: data.critStage ?? null,
      drain: data.drain ?? null,
      healing: data.healing ?? null,

      flags: data.flags ?? [],
      isContact: !!data.isContact,
      isSound: !!data.isSound,
      isPunch: !!data.isPunch,
      isBite: !!data.isBite,
      isPowder: !!data.isPowder,
      isProtectAffected: !!data.isProtectAffected,

      // ✅ machine vindo do Firestore (seedAllMoves)
      machine: data.machine ?? null,
    };

    // ✅ aqui é onde a mágica acontece:
    // cria o “item TM/HM/TR completo” dentro do move
    const machineItem = buildMachineItem(moveName, out.machine);
    if (machineItem) out.machineItem = machineItem;

    moves[moveName] = out;
  });

  const outDir = join(process.cwd(), "src", "data");
  mkdirSync(outDir, { recursive: true });

  const outPath = join(outDir, "moves.json");
  writeFileSync(outPath, JSON.stringify(moves, null, 2), "utf-8");

  console.log(`✅ Arquivo gerado em: ${outPath}`);
  console.log(`✅ Total de moves exportados: ${Object.keys(moves).length}`);
}

run()
  .then(() => {
    console.log("Exportação ADMIN de 'moves' concluída!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Erro ao exportar 'moves' (admin):", err);
    process.exit(1);
  });
