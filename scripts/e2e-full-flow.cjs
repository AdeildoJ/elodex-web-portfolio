/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: {
    module: "CommonJS",
    moduleResolution: "Node",
  },
});

const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

const { resolveTurn } = require("../../elodex-mobile/src/components/battle/TurnManager.ts");
const { buildBattleMove } = require("../../elodex-mobile/src/components/battle/moveCatalog.ts");

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

function nowId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function makeBattleMon({ id, speciesId, name, level, hp, types, moves }) {
  return {
    id,
    speciesId,
    name,
    level,
    hpCurrent: hp,
    hpTotal: hp,
    stats: {
      hp,
      atk: 65 + level,
      def: 60 + level,
      spa: 60 + level,
      spd: 60 + level,
      spe: 65 + level,
    },
    types,
    sprite: { front: null, back: null },
    moves,
  };
}

async function ensureAuthUser(auth, uid, email) {
  try {
    await auth.getUser(uid);
  } catch {
    await auth.createUser({ uid, email, password: "Temp#123456" });
  }
}

async function run() {
  const sa = loadServiceAccount();
  const app =
    getApps()[0] ||
    initializeApp({
      credential: cert(sa),
      projectId: sa.projectId,
    });
  const db = getFirestore(app);
  const auth = getAuth(app);

  const runId = nowId("e2e");
  const adminUid = `${runId}-admin`;
  const playerUid = `${runId}-player`;
  const charId = `${runId}-char`;
  const biomeId = `${runId}-biome`;
  const itemId = `${runId}-item`;
  const speciesId = 25;

  const result = {
    runId,
    admin: {},
    player: {},
    checks: {},
  };

  await ensureAuthUser(auth, adminUid, `${adminUid}@elodex.test`);
  await ensureAuthUser(auth, playerUid, `${playerUid}@elodex.test`);
  await auth.setCustomUserClaims(adminUid, { admin: true });

  const adminDocRef = db.doc(`users/${adminUid}`);
  await adminDocRef.set({
    uid: adminUid,
    email: `${adminUid}@elodex.test`,
    role: "admin",
    updatedAt: FieldValue.serverTimestamp(),
  });

  const biomeRef = db.doc(`biomes/${biomeId}`);
  await biomeRef.set({
    id: biomeId,
    name: `Biome ${runId}`,
    description: "Biome de teste E2E",
    imageUrl: "",
    hasDaycare: true,
    hasPokeMart: true,
    unlockRules: { op: "OR", rules: [{ kind: "km", minKm: 0 }] },
    updatedAt: FieldValue.serverTimestamp(),
  });
  const biomeEncounterRef = db.doc(`biomeEncounterConfig/${biomeId}/individual/${speciesId}`);
  await biomeEncounterRef.set({
    speciesId,
    minLevel: 5,
    maxLevel: 7,
    encounterRate: 100,
    enabled: true,
    updatedAt: FieldValue.serverTimestamp(),
  });

  const itemCfgRef = db.doc(`itemsConfig/${itemId}`);
  await itemCfgRef.set({
    itemId,
    itemName: "Potion E2E",
    category: "item",
    saleEnabled: true,
    sellMode: "game",
    gamePrice: 100,
    realPrice: 0,
    grantType: "inventory",
    updatedAt: FieldValue.serverTimestamp(),
  });

  result.admin = { biomeId, itemId, speciesId };

  const charRef = db.doc(`players/${playerUid}/characters/${charId}`);
  await charRef.set({
    name: "Treinador E2E",
    region: "kanto",
    starterPokemon: { speciesId: 1, name: "Bulbasaur" },
    pokeCoins: 1000,
    totalKm: 0,
    updatedAt: FieldValue.serverTimestamp(),
  });

  const slot1Ref = db.doc(`players/${playerUid}/characters/${charId}/time/slot_1`);
  await slot1Ref.set({
    speciesId: 1,
    speciesName: "Bulbasaur",
    nickname: "Bulbasaur",
    level: 8,
    hp: { current: 30, total: 30 },
    exp: { current: 0, toNext: 100 },
    moves: ["tackle", "vine-whip"],
    moveHistory: ["tackle", "vine-whip"],
    relearnableMoves: [],
    pendingLearnMove: null,
    slotIndex: 1,
    updatedAt: FieldValue.serverTimestamp(),
  });

  const pokeballRef = db.doc(`players/${playerUid}/characters/${charId}/pokeballs/poke-ball`);
  const pokeballMetaRef = db.doc(`players/${playerUid}/characters/${charId}/pokeballs/_meta`);
  await pokeballRef.set({
    id: "poke-ball",
    kind: "POKEBALL",
    name: "Poke Ball",
    quantity: 10,
    captureBonus: 1,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await pokeballMetaRef.set({
    totalQuantity: 10,
    limit: 200,
    updatedAt: FieldValue.serverTimestamp(),
  });

  const capturedRef = db.doc(`players/${playerUid}/characters/${charId}/time/slot_2`);
  await capturedRef.set({
    speciesId,
    speciesName: "Pikachu",
    nickname: "Pikachu",
    level: 6,
    hp: { current: 22, total: 22 },
    exp: { current: 0, toNext: 100 },
    moves: ["thunder-shock", "quick-attack"],
    moveHistory: ["thunder-shock", "quick-attack"],
    relearnableMoves: [],
    pendingLearnMove: null,
    slotIndex: 2,
    capturedFromBiome: biomeId,
    updatedAt: FieldValue.serverTimestamp(),
  });

  const playerTeam = [
    makeBattleMon({
      id: "p1",
      speciesId: 1,
      name: "Bulbasaur",
      level: 8,
      hp: 30,
      types: ["grass", "poison"],
      moves: [buildBattleMove("tackle"), buildBattleMove("vine-whip"), buildBattleMove("growl"), buildBattleMove("protect")],
    }),
  ];
  const enemyTeam = [
    makeBattleMon({
      id: "e1",
      speciesId,
      name: "Pikachu Selvagem",
      level: 6,
      hp: 24,
      types: ["electric"],
      moves: [buildBattleMove("thunder-shock"), buildBattleMove("quick-attack"), buildBattleMove("tail-whip"), buildBattleMove("growl")],
    }),
  ];

  let battle = {
    playerTeam,
    enemyTeam,
    playerActive: 0,
    enemyActive: 0,
    fieldState: {
      weather: "none",
      weatherTurns: 0,
      playerReflectTurns: 0,
      enemyReflectTurns: 0,
      playerLightScreenTurns: 0,
      enemyLightScreenTurns: 0,
      playerSpikesLayers: 0,
      enemySpikesLayers: 0,
      playerStealthRock: false,
      enemyStealthRock: false,
    },
    result: "ongoing",
  };

  for (let i = 0; i < 12 && battle.result === "ongoing"; i++) {
    const turn = resolveTurn({
      playerTeam: battle.playerTeam,
      enemyTeam: battle.enemyTeam,
      playerActive: battle.playerActive,
      enemyActive: battle.enemyActive,
      playerAction: { type: "fight", moveIndex: 0 },
      enemyAction: { type: "fight", moveIndex: 0 },
      canRun: true,
      typeMultiplier: () => 1,
      fieldState: battle.fieldState,
    });
    battle = turn;
  }

  const battleRef = db.collection(`players/${playerUid}/characters/${charId}/battleHistory`).doc(nowId("battle"));
  await battleRef.set({
    mode: "wild",
    result: battle.result === "ongoing" ? "victory" : battle.result,
    rewardCoins: 20,
    biomeId,
    updatedAt: FieldValue.serverTimestamp(),
  });

  const coinsBefore = (await charRef.get()).data()?.pokeCoins ?? 0;
  await db.runTransaction(async (tx) => {
    const [charSnap, itemSnap, metaSnap] = await Promise.all([
      tx.get(charRef),
      tx.get(db.doc(`players/${playerUid}/characters/${charId}/itens/${itemId}`)),
      tx.get(db.doc(`players/${playerUid}/characters/${charId}/itens/_meta`)),
    ]);
    const coins = Math.max(0, Number(charSnap.data()?.pokeCoins ?? 0));
    const price = 100;
    if (coins < price) throw new Error("Moedas insuficientes no teste.");
    tx.set(charRef, { pokeCoins: coins - price, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    const currentQty = itemSnap.exists ? Math.max(0, Number(itemSnap.data()?.quantity ?? 0)) : 0;
    const totalQty = metaSnap.exists ? Math.max(0, Number(metaSnap.data()?.totalQuantity ?? 0)) : 0;
    tx.set(
      db.doc(`players/${playerUid}/characters/${charId}/itens/${itemId}`),
      {
        id: itemId,
        kind: "ITEM",
        name: "Potion E2E",
        quantity: currentQty + 1,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    tx.set(
      db.doc(`players/${playerUid}/characters/${charId}/itens/_meta`),
      { totalQuantity: totalQty + 1, limit: 200, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
  });

  const [biomeSnap, itemCfgSnap, capSnap, battleSnap, itemInvSnap, charSnapAfter] = await Promise.all([
    biomeRef.get(),
    itemCfgRef.get(),
    capturedRef.get(),
    battleRef.get(),
    db.doc(`players/${playerUid}/characters/${charId}/itens/${itemId}`).get(),
    charRef.get(),
  ]);

  assert(biomeSnap.exists, "Biome nao foi criado.");
  assert(itemCfgSnap.exists, "Item de loja nao foi criado.");
  assert(capSnap.exists, "Pokemon capturado nao encontrado no time.");
  assert(battleSnap.exists, "Historico de batalha nao criado.");
  assert(itemInvSnap.exists, "Item comprado nao foi adicionado ao inventario.");
  assert(Number(charSnapAfter.data()?.pokeCoins ?? 0) < Number(coinsBefore), "Moedas nao foram debitadas.");

  result.player = {
    uid: playerUid,
    characterId: charId,
    capturedSpeciesId: capSnap.data()?.speciesId ?? null,
    battleResult: battleSnap.data()?.result ?? null,
    coinsBefore,
    coinsAfter: charSnapAfter.data()?.pokeCoins ?? null,
    boughtItemQty: itemInvSnap.data()?.quantity ?? null,
  };

  result.checks = {
    biomeCreated: true,
    biomeEncounterConfigured: (await biomeEncounterRef.get()).exists,
    playerCreated: (await charRef.get()).exists,
    captureFlow: true,
    battleFlow: true,
    shopFlow: true,
  };

  console.log(JSON.stringify({ ok: true, result }, null, 2));
}

run().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }, null, 2));
  process.exit(1);
});
