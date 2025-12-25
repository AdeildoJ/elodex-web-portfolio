// scripts/seedAllMoves.js
const axios = require("axios");
const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");

// 👇 AJUSTE ESSE CAMINHO IGUAL AOS OUTROS SCRIPTS (SE PRECISAR)
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
 * Pega info de TM/TR/HM para Sword/Shield
 */
async function fetchSwordShieldMachineInfo(moveData) {
  try {
    const VERSION_GROUP = "sword-shield";
    const machines = moveData.machines || [];

    for (const m of machines) {
      const vgName = m.version_group?.name;
      if (vgName !== VERSION_GROUP) continue;

      const machineRes = await axios.get(m.machine.url);
      const machineData = machineRes.data;
      const itemName = machineData.item?.name; // ex: "tm34", "tr00", "hm03"

      if (!itemName) continue;

      const upper = itemName.toUpperCase(); // TM34, TR00, HM03
      let kind = "other";
      let code = upper;

      if (upper.startsWith("TM")) {
        kind = "tm";
      } else if (upper.startsWith("HM")) {
        kind = "hm";
      } else if (upper.startsWith("TR")) {
        kind = "tr";
      }

      return {
        machineItemName: itemName, // "tm34"
        machineCode: code,         // "TM34"
        machineKind: kind,         // "tm" | "hm" | "tr" | "other"
      };
    }

    return null;
  } catch (err) {
    console.error(
      "Erro ao buscar machine info:",
      err?.response?.status || err.message || err
    );
    return null;
  }
}

/**
 * Busca detalhes COMPLETOS de um move na PokeAPI
 * e gera campos crus + derivados para gameplay.
 */
async function fetchMoveDetails(moveName) {
  const url = `https://pokeapi.co/api/v2/move/${moveName}`;
  const res = await axios.get(url);
  const d = res.data;

  const meta = d.meta || {};
  const statChangesRaw = d.stat_changes || [];
  const flagsRaw = d.flags || d.flag || [];

  // ---- TEXTOS ----
  const effectEntry =
    (d.effect_entries || []).find((e) => e.language.name === "en") || null;
  const flavorEntry =
    (d.flavor_text_entries || []).find((e) => e.language.name === "en") ||
    null;

  // ---- RAW AILMENT / STATUS ----
  const rawAilment = meta.ailment?.name || null;
  const rawAilmentChance =
    typeof meta.ailment_chance === "number" ? meta.ailment_chance : null;
  const rawEffectChance =
    typeof d.effect_chance === "number" ? d.effect_chance : null;

  // ---- STATUS DERIVADO ----
  let statusAilment = null;
  if (rawAilment && rawAilment !== "none" && rawAilment !== "unknown") {
    statusAilment = rawAilment;
  }

  let statusChance = null;
  if (statusAilment) {
    if (rawAilmentChance && rawAilmentChance > 0) {
      // Ex: Flamethrower (10% burn)
      statusChance = rawAilmentChance;
    } else if (rawEffectChance && rawEffectChance > 0) {
      statusChance = rawEffectChance;
    } else if (d.damage_class?.name === "status") {
      // Ex: Thunder Wave – golpe puramente de status
      // Se acertou (accuracy), aplica SEMPRE o efeito
      statusChance = 100;
    } else {
      statusChance = null;
    }
  }

  // ---- STAT CHANGES DERIVADOS ----
  const statChanges = statChangesRaw.map((s) => ({
    stat: s.stat?.name || null,
    stages: s.change ?? null, // +2, -1, etc.
  }));

  const rawStatChance =
    typeof meta.stat_chance === "number" ? meta.stat_chance : null;

  let statChangeChance = null;
  if (statChanges.length > 0) {
    if (rawStatChance && rawStatChance > 0) {
      statChangeChance = rawStatChance;
    } else if (d.damage_class?.name === "status") {
      // Buff/debuff puro (ex: Swords Dance) – chance 100%
      statChangeChance = 100;
    }
  }

  // ---- FLAGS ----
  const flagNames = (flagsRaw || []).map((f) => f.name || f);

  const isContact = flagNames.includes("contact");
  const isSound = flagNames.includes("sound");
  const isPunch = flagNames.includes("punch");
  const isBite = flagNames.includes("bite");
  const isPowder = flagNames.includes("powder");
  const isProtectAffected = flagNames.includes("protect");

  // ---- TM/TR/HM ----
  const machineInfo = await fetchSwordShieldMachineInfo(d);

  return {
    id: d.id,
    name: d.name,
    type: d.type?.name || null,
    damageClass: d.damage_class?.name || null, // physical | special | status
    power: d.power,
    accuracy: d.accuracy,
    pp: d.pp,
    priority: d.priority,
    target: d.target?.name || null,

    effectText: effectEntry?.short_effect || null,
    flavorText: flavorEntry?.flavor_text || null,

    // RAW (para debug / conferência)
    raw: {
      effectChance: rawEffectChance,
      metaAilment: rawAilment,
      metaAilmentChance: rawAilmentChance,
      metaStatChance: rawStatChance,
    },

    // DERIVADOS INTELIGENTES
    statusAilment,     // burn, paralysis, poison...
    statusChance,      // 0–100 (%)

    statChanges,       // [{ stat: "attack", stages: 2 }, ...]
    statChangeChance,  // 0–100

    flinchChance:
      typeof meta.flinch_chance === "number"
        ? meta.flinch_chance
        : null,
    critStage:
      typeof meta.crit_rate === "number" ? meta.crit_rate : null,
    drain: typeof meta.drain === "number" ? meta.drain : null,
    healing:
      typeof meta.healing === "number" ? meta.healing : null,

    flags: flagNames,
    isContact,
    isSound,
    isPunch,
    isBite,
    isPowder,
    isProtectAffected,

    machine: machineInfo, // { machineKind, machineCode, machineItemName }
  };
}

/**
 * Salva/atualiza o move na coleção "moves"
 */
async function saveMove(move) {
  const ref = db.collection("moves").doc(move.name);
  await ref.set(move, { merge: true });
  console.log("Move salvo:", move.name);
}

/**
 * Busca TODOS os nomes de moves da PokeAPI
 */
async function fetchAllMoveNames() {
  const url = "https://pokeapi.co/api/v2/move?limit=2000&offset=0";
  const res = await axios.get(url);
  const results = res.data.results || [];
  return results.map((r) => r.name); // ["pound", "thunder-wave", ...]
}

/**
 * Seed geral: baixa todos os moves da PokeAPI e salva em Firestore
 */
async function seedAllMoves() {
  const names = await fetchAllMoveNames();
  console.log("Total de moves encontrados na PokeAPI:", names.length);

  for (const name of names) {
    try {
      const details = await fetchMoveDetails(name);
      await saveMove(details);

      // Pausa pra não tomar rate-limit
      await sleep(150);
    } catch (err) {
      console.error(
        "Erro ao processar move",
        name,
        err?.response?.status || err.message || err
      );
      await sleep(500);
    }
  }

  console.log("Seed de TODOS os moves concluído!");
}

/**
 * Execução
 */
seedAllMoves()
  .then(() => {
    console.log("✅ Finalizado com sucesso.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Erro geral no seed:", err);
    process.exit(1);
  });
