const crypto = require("node:crypto");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const logger = require("firebase-functions/logger");
const { ensureStableInstanceId, randomUUID } = require("./pokemonDocIdentity");
const { resolveCallableUid } = require("./callableUid");
const gymServerActions = require("./gymServerActions");
const { starterFullHpFromSpeciesId, fullHpForSpeciesAtLevel } = require("./pokemonStatCalc");
const { buildMovePp } = require("./gameplaySecure").__test__;
const { expToNextForSpeciesAtLevel, normalizeExpBarCurrentForSpeciesLevel } = require("./experienceExp");
const { updatePokemonExpForAdmin } = require("./expWriteCanonical");

const REGION = { region: "southamerica-east1" };
const EGG_INCUBATOR_ITEM_ID = "egg-incubator";
const GYM_MAIN_TEAM_SLOT_ITEM_ID = "gym-main-team-slot-token";

function asInt(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function norm(v) {
  return String(v || "").trim().toLowerCase();
}

/**
 * Metadados de isca na mochila + fator de quantidade (Isca/Anzol: N usos por unidade comprada).
 */
function buildFishingBaitItemPatch(fishingConfig) {
  if (!fishingConfig || fishingConfig.enabled !== true) {
    return { metadata: null, perUnitUses: 1 };
  }
  const mode = norm(fishingConfig.mode).replace(/_/g, "-");
  if (mode === "isca-anzol") {
    const groupIds = Array.isArray(fishingConfig.fishingGroupIds)
      ? fishingConfig.fishingGroupIds.map((id) => norm(id)).filter(Boolean)
      : [];
    const speciesIds = Array.isArray(fishingConfig.fishingSpeciesIds)
      ? fishingConfig.fishingSpeciesIds
          .map((n) => Math.max(0, asInt(n, 0)))
          .filter((n) => n > 0)
      : [];
    return {
      perUnitUses: Math.max(1, asInt(fishingConfig.uses, 1)),
      metadata: {
        fishingBait: true,
        fishingBaitMode: "isca-anzol",
        baseSuccessPercent: 98,
        groupWeightBonusPercent: 0,
        attractTags: [],
        fishingGroupIds: groupIds,
        fishingSpeciesIds: speciesIds,
      },
    };
  }
  const fishingTags = Array.isArray(fishingConfig.attractTags)
    ? fishingConfig.attractTags.map((tag) => norm(tag)).filter(Boolean)
    : [];
  return {
    perUnitUses: 1,
    metadata: {
      fishingBait: true,
      attractTags: fishingTags,
      baseSuccessPercent: Math.max(0, Math.min(100, Number(fishingConfig.baseSuccessPercent ?? 98) || 98)),
      groupWeightBonusPercent: Math.max(0, Number(fishingConfig.groupWeightBonusPercent ?? 10) || 10),
    },
  };
}

function sanitizePendingLearnMoveQueue(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const x of raw) {
    const id = norm(x);
    if (!id || out.includes(id)) continue;
    out.push(id);
    if (out.length >= 32) break;
  }
  return out;
}

/** Chave opcional enviada pelo cliente (um UUID por tentativa de compra) para evitar debito duplicado em retry. */
function sanitizeIdempotencyKey(raw) {
  const s = String(raw || "").trim();
  if (!s || s.length > 120) return "";
  if (!/^[a-zA-Z0-9._-]+$/.test(s)) return "";
  return s;
}

function idempotentEcoinPurchaseDocId(uid, characterId, idemKey) {
  return crypto.createHash("sha256").update(`${uid}|${characterId}|${idemKey}`, "utf8").digest("hex");
}

function randomIvStat() {
  return Math.floor(Math.random() * 32);
}

function rollRandomIvs() {
  return {
    hp: randomIvStat(),
    atk: randomIvStat(),
    def: randomIvStat(),
    spa: randomIvStat(),
    spd: randomIvStat(),
    spe: randomIvStat(),
  };
}

function readBiomeAccessExpiresAtMs(row) {
  const data = row || {};
  const n = Number(data.expiresAtMs || 0);
  if (Number.isFinite(n) && n > 0) return Math.trunc(n);
  const ts = data.expiresAt;
  if (ts && typeof ts.toMillis === "function") return Math.max(0, ts.toMillis());
  return 0;
}

function requireCharacterId(raw) {
  const id = String(raw || "").trim();
  if (!id) throw new HttpsError("invalid-argument", "characterId obrigatorio.");
  return id;
}

function sanitizeForBox(mon) {
  const out = { ...(mon || {}) };
  delete out.slotIndex;
  return out;
}

/** Substitui o documento inteiro — evita campos órfãos de merge:true (corrupção espécie/nível). */
function setPokemonDoc(tx, ref, mon, extra) {
  const body = ensureStableInstanceId(sanitizeForBox(mon));
  tx.set(ref, { ...body, ...(extra || {}), updatedAt: FieldValue.serverTimestamp() });
}

function applyMoveDecision(currentMoves, moveId, forgetMoveIndex = null) {
  const moves = Array.isArray(currentMoves) ? currentMoves.map((m) => String(m || "").trim().toLowerCase()).filter(Boolean) : [];
  const candidate = String(moveId || "").trim().toLowerCase();
  if (!candidate) return moves.slice(0, 4);
  if (moves.includes(candidate)) return moves.slice(0, 4);
  if (moves.length < 4) return [...moves, candidate].slice(0, 4);
  const idx = Number.isFinite(Number(forgetMoveIndex)) ? Math.max(0, Math.min(3, asInt(forgetMoveIndex, 0))) : 3;
  const next = moves.slice(0, 4);
  next[idx] = candidate;
  return next;
}

function calcCaptureChance(encounter, captureBonus = 1, isMasterBall = false) {
  if (isMasterBall) return 1;
  const hpTotal = Math.max(1, Number(encounter?.hpTotal || 1));
  const hpCurrent = Math.max(0, Number(encounter?.hpCurrent || hpTotal));
  const ratio = hpCurrent / hpTotal;
  const base = Math.max(0.08, Math.min(0.65, 0.55 - ratio * 0.4));
  return Math.max(0.01, Math.min(0.95, base * Math.max(0.2, Number(captureBonus || 1))));
}

function deterministicRand(seed) {
  const text = String(seed || "");
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const u = (h >>> 0) / 4294967296;
  return u;
}

const FRIENDSHIP_DEFAULT_CAPTURE = 70;
const ZERO_IVS_CAPTURE = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const ZERO_EVS_CAPTURE = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

function clampFriendshipCapture(v) {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return FRIENDSHIP_DEFAULT_CAPTURE;
  return Math.max(0, Math.min(255, n));
}

/** M/F/U; se invalido, sorteia M/F (alinhado a encontros selvagens binarios no app). */
function sanitizeCaptureGender(raw) {
  const s = String(raw ?? "").trim().toUpperCase();
  if (s === "M" || s === "F" || s === "U") return s;
  return Math.random() < 0.5 ? "M" : "F";
}

function sanitizeNatureCapture(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "Serious";
  return s.length > 64 ? s.slice(0, 64) : s;
}

function sanitizeAbilityIdCapture(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  return s && s.length <= 96 ? s : null;
}

function readIvBlockCapture(raw) {
  if (!raw || typeof raw !== "object") return { ...ZERO_IVS_CAPTURE };
  return {
    hp: Math.max(0, Math.min(31, asInt(raw.hp, 0))),
    atk: Math.max(0, Math.min(31, asInt(raw.atk, 0))),
    def: Math.max(0, Math.min(31, asInt(raw.def, 0))),
    spa: Math.max(0, Math.min(31, asInt(raw.spa, 0))),
    spd: Math.max(0, Math.min(31, asInt(raw.spd, 0))),
    spe: Math.max(0, Math.min(31, asInt(raw.spe, 0))),
  };
}

function readEvBlockCapture(raw) {
  if (!raw || typeof raw !== "object") return { ...ZERO_EVS_CAPTURE };
  return {
    hp: Math.max(0, Math.min(252, asInt(raw.hp, 0))),
    atk: Math.max(0, Math.min(252, asInt(raw.atk, 0))),
    def: Math.max(0, Math.min(252, asInt(raw.def, 0))),
    spa: Math.max(0, Math.min(252, asInt(raw.spa, 0))),
    spd: Math.max(0, Math.min(252, asInt(raw.spd, 0))),
    spe: Math.max(0, Math.min(252, asInt(raw.spe, 0))),
  };
}

function readBattleStatsCapture(raw) {
  if (!raw || typeof raw !== "object") return null;
  const atk = asInt(raw.atk, -1);
  const def = asInt(raw.def, -1);
  const spa = asInt(raw.spa, -1);
  const spd = asInt(raw.spd, -1);
  const spe = asInt(raw.spe, -1);
  if (atk < 0 || def < 0 || spa < 0 || spd < 0 || spe < 0) return null;
  return {
    atk: Math.max(0, atk),
    def: Math.max(0, def),
    spa: Math.max(0, spa),
    spd: Math.max(0, spd),
    spe: Math.max(0, spe),
  };
}

async function upsertItemWithMeta(
  tx,
  db,
  { uid, characterId, itemId, delta, patch, itemCapacityLimit = null, preloadedItemSnap = null, preloadedMetaSnap = null }
) {
  const safeItemId = norm(itemId);
  const safeDelta = asInt(delta, 0);
  if (!safeItemId) throw new HttpsError("invalid-argument", "itemId invalido.");
  if (safeDelta === 0) return;
  const itemRef = db.doc(`players/${uid}/characters/${characterId}/itens/${safeItemId}`);
  const itemMetaRef = db.doc(`players/${uid}/characters/${characterId}/itens/_meta`);
  const [itemSnap, metaSnap] =
    preloadedItemSnap != null && preloadedMetaSnap != null
      ? [preloadedItemSnap, preloadedMetaSnap]
      : await Promise.all([tx.get(itemRef), tx.get(itemMetaRef)]);
  const currentQty = Math.max(0, asInt(itemSnap.data()?.quantity, 0));
  const nextQty = currentQty + safeDelta;
  if (nextQty < 0) throw new HttpsError("failed-precondition", `Quantidade insuficiente para ${safeItemId}.`);
  if (nextQty === 0) tx.delete(itemRef);
  else {
    tx.set(
      itemRef,
      {
        id: safeItemId,
        kind: "ITEM",
        quantity: nextQty,
        updatedAt: FieldValue.serverTimestamp(),
        ...(patch || {}),
      },
      { merge: true }
    );
  }
  const totalQuantity = Math.max(0, asInt(metaSnap.data()?.totalQuantity, 0));
  tx.set(
    itemMetaRef,
    {
      totalQuantity: Math.max(0, totalQuantity + safeDelta),
      ...(itemCapacityLimit != null ? { limit: Math.max(1, asInt(itemCapacityLimit, 1)) } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function upsertPokeballWithMeta(
  tx,
  db,
  { uid, characterId, ballId, delta, patch, preloadedBallSnap = null, preloadedBallMetaSnap = null }
) {
  const safeBallId = norm(ballId);
  const safeDelta = asInt(delta, 0);
  if (!safeBallId) throw new HttpsError("invalid-argument", "ballId invalido.");
  if (safeDelta === 0) return;
  const ballRef = db.doc(`players/${uid}/characters/${characterId}/pokeballs/${safeBallId}`);
  const ballMetaRef = db.doc(`players/${uid}/characters/${characterId}/pokeballs/_meta`);
  const [ballSnap, metaSnap] =
    preloadedBallSnap != null && preloadedBallMetaSnap != null
      ? [preloadedBallSnap, preloadedBallMetaSnap]
      : await Promise.all([tx.get(ballRef), tx.get(ballMetaRef)]);
  const currentQty = Math.max(0, asInt(ballSnap.data()?.quantity, 0));
  const nextQty = currentQty + safeDelta;
  if (nextQty < 0) throw new HttpsError("failed-precondition", `Quantidade insuficiente para ${safeBallId}.`);
  if (nextQty === 0) tx.delete(ballRef);
  else {
    tx.set(
      ballRef,
      {
        id: safeBallId,
        kind: "POKEBALL",
        quantity: nextQty,
        updatedAt: FieldValue.serverTimestamp(),
        ...(patch || {}),
      },
      { merge: true }
    );
  }
  const totalQuantity = Math.max(0, asInt(metaSnap.data()?.totalQuantity, 0));
  tx.set(
    ballMetaRef,
    {
      totalQuantity: Math.max(0, totalQuantity + safeDelta),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

function setStarterBundleDocs(tx, db, uid, characterId) {
  const charRef = db.doc(`players/${uid}/characters/${characterId}`);
  const itemsMetaRef = db.doc(`players/${uid}/characters/${characterId}/itens/_meta`);
  const ballsMetaRef = db.doc(`players/${uid}/characters/${characterId}/pokeballs/_meta`);
  const potionRef = db.doc(`players/${uid}/characters/${characterId}/itens/potion`);
  const reviveRef = db.doc(`players/${uid}/characters/${characterId}/itens/revive`);
  const ballRef = db.doc(`players/${uid}/characters/${characterId}/pokeballs/poke-ball`);

  tx.set(
    potionRef,
    {
      id: "potion",
      kind: "ITEM",
      quantity: FieldValue.increment(10),
      name: "Potion",
      description: "Restaura um pouco de HP de um Pokémon.",
      effectType: "HEAL",
      healAmount: 20,
      consumable: true,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  tx.set(
    reviveRef,
    {
      id: "revive",
      kind: "ITEM",
      quantity: FieldValue.increment(10),
      name: "Revive",
      description: "Revive um Pokémon desmaiado com parte do HP.",
      effectType: "REVIVE",
      revivePercent: 50,
      consumable: true,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  tx.set(
    ballRef,
    {
      id: "poke-ball",
      kind: "POKEBALL",
      quantity: FieldValue.increment(20),
      name: "Poke Ball",
      description: "Pokebola padrao para capturas comuns.",
      captureBonus: 1,
      isMasterBall: false,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  tx.set(
    itemsMetaRef,
    {
      totalQuantity: FieldValue.increment(20),
      limit: 20,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  tx.set(
    ballsMetaRef,
    {
      totalQuantity: FieldValue.increment(20),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  tx.set(
    charRef,
    {
      pokeCoins: 1000,
      serverBootstrapCompleted: true,
      starterBundleGrantedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Grava no inventario do personagem o conteudo de um produto monetizado (mesma logica de claim_entitlement).
 * Nao altera documentos de entitlement — usar depois de validar entitlement ou na entrega direta do checkout.
 */
async function applyMonetizedCharacterItemGrantTx(tx, db, { uid, characterId, productType, benefits, quantity, itemCapacityLimit }) {
  const benefitsObj = benefits && typeof benefits === "object" ? benefits : {};
  const metadata = benefitsObj.metadata && typeof benefitsObj.metadata === "object" ? benefitsObj.metadata : {};
  const type = norm(productType);
  const entitlementQty = Math.max(1, asInt(quantity, 1));

  if (type === "incubator") {
    const amount = Math.max(1, asInt(benefitsObj?.incubators, 1)) * entitlementQty;
    await upsertItemWithMeta(tx, db, {
      uid,
      characterId,
      itemId: EGG_INCUBATOR_ITEM_ID,
      delta: amount,
      patch: {
        name: "Incubadora",
        description: "Usada para chocar ovos que exigem incubadora.",
        consumable: true,
      },
      itemCapacityLimit,
    });
  } else if (type === "iv_reset") {
    const amount = Math.max(1, asInt(benefitsObj?.ivResetCount, 1)) * entitlementQty;
    await upsertItemWithMeta(tx, db, {
      uid,
      characterId,
      itemId: "iv-reset-token",
      delta: amount,
      patch: {
        name: "Reset IV",
        description: "Reseta os IVs do Pokemon alvo.",
        effectType: "RESET_IV",
        consumable: true,
      },
      itemCapacityLimit,
    });
  } else if (type === "mystery_egg" || type === "egg" || type === "gym_type_egg") {
    await upsertItemWithMeta(tx, db, {
      uid,
      characterId,
      itemId: "mystery-egg",
      delta: Math.max(1, asInt(benefitsObj?.mysteryEggCount, 1)) * entitlementQty,
      patch: {
        name: "Ovo misterioso",
        description: "Coloque na incubadora pela Mochila.",
        consumable: true,
      },
      itemCapacityLimit,
    });
  } else if (type === "biome_ticket" || (type === "ticket" && norm(metadata.ticketSubtype || metadata.ticketType) === "biome")) {
    const biomeId = norm(metadata.biomeId || metadata.targetBiomeId);
    if (!biomeId) {
      throw new HttpsError(
        "failed-precondition",
        "Ticket de bioma sem biomeId. Configure benefits.metadata.biomeId no produto de monetizacao."
      );
    }
    const accessDays = Math.max(1, asInt(metadata.biomeAccessDays, 7));
    const durationHours = accessDays * 24 * Math.max(1, asInt(benefitsObj?.biomeTicketCount, 1)) * entitlementQty;
    const accessRef = db.doc(`players/${uid}/characters/${characterId}/biome_access/${biomeId}`);
    const accessSnap = await tx.get(accessRef);
    const nowMs = Date.now();
    const prevExpires = accessSnap.exists ? readBiomeAccessExpiresAtMs(accessSnap.data() || {}) : 0;
    const baseMs = Math.max(nowMs, prevExpires);
    const expiresAtMs = baseMs + durationHours * 60 * 60 * 1000;
    tx.set(
      accessRef,
      {
        biomeId,
        source: "monetization_ticket",
        expiresAtMs,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } else if (
    type === "slot" ||
    type === "gym_main_team_slot" ||
    asInt(benefitsObj?.gymDefenseSlotsAdded, 0) > 0 ||
    asInt(benefitsObj?.gymMainTeamSlots, 0) > 0
  ) {
    const amount = Math.max(1, asInt(benefitsObj?.gymDefenseSlotsAdded || benefitsObj?.gymMainTeamSlots || 1, 1)) * entitlementQty;
    await upsertItemWithMeta(tx, db, {
      uid,
      characterId,
      itemId: GYM_MAIN_TEAM_SLOT_ITEM_ID,
      delta: amount,
      patch: {
        name: "Slot do time principal do GYM",
        description: "Use na mochila do personagem para liberar um novo slot do time principal do GYM.",
        effectType: "ACTIVATE_GYM_MAIN_TEAM_SLOT",
        consumable: true,
      },
      itemCapacityLimit,
    });
  } else if (type === "fishing_bait") {
    const itemConfigId = norm(metadata.itemConfigId || benefitsObj.fishingBaitItemConfigId);
    if (!itemConfigId) {
      throw new HttpsError("failed-precondition", "Produto Isca/Anzol sem itemConfigId (itemsConfig) no beneficio.");
    }
    const uses = Math.max(1, asInt(metadata.uses ?? benefitsObj.fishingBaitUses, 1));
    const cfgRef = db.doc(`itemsConfig/${itemConfigId}`);
    const cfgSnap = await tx.get(cfgRef);
    if (!cfgSnap.exists) {
      throw new HttpsError("not-found", `itemsConfig/${itemConfigId} nao encontrado. Cadastre a loja do item em Itens.`);
    }
    const icfg = cfgSnap.data() || {};
    const groupFromBenefits = Array.isArray(benefitsObj.fishingBaitGroupIds) ? benefitsObj.fishingBaitGroupIds : [];
    const specFromBenefits = Array.isArray(benefitsObj.fishingBaitSpeciesIds) ? benefitsObj.fishingBaitSpeciesIds : [];
    let groupIds = groupFromBenefits
      .map((g) => norm(g))
      .filter(Boolean);
    let speciesIds = specFromBenefits
      .map((n) => Math.max(0, asInt(n, 0)))
      .filter((n) => n > 0);
    const legacyFish = icfg.fishingConfig && typeof icfg.fishingConfig === "object" ? icfg.fishingConfig : null;
    const legacyMode = norm(legacyFish?.mode || "")
      .replace(/_/g, "-");
    if (!groupIds.length && !speciesIds.length && legacyFish && legacyMode === "isca-anzol" && legacyFish.enabled) {
      if (Array.isArray(legacyFish.fishingGroupIds)) {
        groupIds = legacyFish.fishingGroupIds
          .map((g) => norm(g))
          .filter(Boolean);
      }
      if (Array.isArray(legacyFish.fishingSpeciesIds)) {
        speciesIds = legacyFish.fishingSpeciesIds
          .map((n) => Math.max(0, asInt(n, 0)))
          .filter((n) => n > 0);
      }
    }
    if (!groupIds.length && !speciesIds.length) {
      throw new HttpsError("failed-precondition", "Isca/Anzol: informe grupos e/ou especies no produto ou no itemsConfig.");
    }
    let usesFinal = uses;
    if (usesFinal < 1 && legacyFish && legacyMode === "isca-anzol" && legacyFish.enabled) {
      usesFinal = Math.max(1, asInt(legacyFish.uses, 1));
    }
    usesFinal = Math.max(1, asInt(usesFinal, 1));
    const cat = norm(icfg.category);
    const idLooksLikeBall = itemConfigId.endsWith("-ball") || itemConfigId.includes("poke-ball") || itemConfigId.includes("ultra-ball");
    const preferBall = cat === "pokebola" || idLooksLikeBall;
    const itemKind = preferBall ? "POKEBALL" : "ITEM";
    const fishingConfigEffective = {
      enabled: true,
      mode: "isca-anzol",
      uses: usesFinal,
      fishingGroupIds: groupIds,
      fishingSpeciesIds: speciesIds,
      baseSuccessPercent: 98,
      groupWeightBonusPercent: 0,
      attractTags: [],
    };
    await deliverItemsConfigShopPurchaseTx(tx, db, {
      uid,
      characterId,
      itemId: itemConfigId,
      qty: entitlementQty,
      itemKind,
      itemCapacityLimit,
      fishingConfigEffective,
    });
  } else {
    throw new HttpsError("failed-precondition", "Esse tipo de entitlement nao possui entrega manual.");
  }
}

/**
 * Entrega na conta do personagem um item da loja (itemsConfig), apos pagamento aprovado (pedido em paymentOrders do personagem).
 * @param {object} [fishingConfigEffective] - Se presente, substitui `cfg.fishingConfig` (ex.: Isca/Anzol vinda do produto monetizado).
 */
async function deliverItemsConfigShopPurchaseTx(tx, db, { uid, characterId, itemId, qty, itemKind, itemCapacityLimit, fishingConfigEffective = null }) {
  const safeId = norm(itemId);
  if (!safeId) throw new HttpsError("invalid-argument", "itemId invalido.");
  const addQty = Math.max(1, asInt(qty, 1));
  const cfgRef = db.doc(`itemsConfig/${safeId}`);
  const cfgSnap = await tx.get(cfgRef);
  if (!cfgSnap.exists) throw new HttpsError("not-found", "Configuracao do item da loja nao encontrada.");
  const cfg = cfgSnap.data() || {};
  const grantTypeCfg = norm(cfg.grantType);

  if (grantTypeCfg === "biome_access") {
    const biomeId = norm(cfg.biomeAccessBiomeId);
    const durationHours = Math.max(1, asInt(cfg.biomeAccessDurationHours, 24));
    if (!biomeId) {
      throw new HttpsError("failed-precondition", "itemsConfig de passe de bioma sem biomeAccessBiomeId.");
    }
    const accessRef = db.doc(`players/${uid}/characters/${characterId}/biome_access/${biomeId}`);
    const accessSnap = await tx.get(accessRef);
    const nowMs = Date.now();
    const prevExpires = accessSnap.exists ? readBiomeAccessExpiresAtMs(accessSnap.data() || {}) : 0;
    const baseMs = Math.max(nowMs, prevExpires);
    const expiresAtMs = baseMs + durationHours * addQty * 60 * 60 * 1000;
    tx.set(
      accessRef,
      {
        biomeId,
        source: "shop",
        expiresAtMs,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return;
  }

  const name = String(cfg.itemName || safeId);
  const description = String(cfg.descriptionPtBr || cfg.effectPtBr || "").trim() || "Item da loja.";
  const cat = norm(cfg.category);
  const idLooksLikeBall = safeId.endsWith("-ball") || safeId.includes("poke-ball") || safeId.includes("ultra-ball");
  const preferBall = cat === "pokebola" || idLooksLikeBall;
  const kind =
    String(itemKind || "").trim().toUpperCase() === "POKEBALL" || preferBall ? "POKEBALL" : "ITEM";

  if (kind === "POKEBALL") {
    const captureBonus = Math.max(1, asInt(cfg.captureBonus, 1));
    await upsertPokeballWithMeta(tx, db, {
      uid,
      characterId,
      ballId: safeId,
      delta: addQty,
      patch: {
        name,
        description,
        captureBonus,
        isMasterBall: safeId === "master-ball",
        consumable: true,
      },
    });
    return;
  }

  const effectType = String(cfg.effectType || "").trim().toUpperCase();
  const rawFc = cfg.fishingConfig && typeof cfg.fishingConfig === "object" ? cfg.fishingConfig : null;
  const fishingConfig =
    fishingConfigEffective && typeof fishingConfigEffective === "object" ? fishingConfigEffective : rawFc;
  const { metadata: fishingMeta, perUnitUses: fishingPerUnitUses } = buildFishingBaitItemPatch(fishingConfig);
  const patch = {
    name,
    description,
    consumable: cfg.consumable !== false,
    imageUrl: typeof cfg.imageUrl === "string" ? cfg.imageUrl : null,
    ...(effectType ? { effectType } : {}),
    ...(fishingMeta ? { metadata: fishingMeta } : {}),
  };
  if (cfg.healAmount != null) patch.healAmount = Math.max(0, asInt(cfg.healAmount, 0));
  if (cfg.revivePercent != null) patch.revivePercent = Math.max(0, asInt(cfg.revivePercent, 0));
  const itemDelta = addQty * Math.max(1, asInt(fishingPerUnitUses, 1));
  await upsertItemWithMeta(tx, db, {
    uid,
    characterId,
    itemId: safeId,
    delta: itemDelta,
    patch,
    itemCapacityLimit,
  });
}

async function claimEntitlementToCharacter(tx, db, uid, characterId, entitlementId, itemCapacityLimit) {
  const entitlementRef = db.doc(`players/${uid}/productEntitlements/${entitlementId}`);
  const freshSnap = await tx.get(entitlementRef);
  if (!freshSnap.exists) throw new HttpsError("not-found", "Entitlement nao encontrado.");
  const data = freshSnap.data() || {};
  if (data.claimedAt) throw new HttpsError("failed-precondition", "Esse item ja foi entregue.");
  const ds = norm(data.deliveryScope);
  const consumedBy = String(data.consumedByCharacterId || "").trim();
  if (ds === "character_backpack" && !consumedBy) {
    throw new HttpsError(
      "failed-precondition",
      "Entitlement de mochila sem personagem vinculado. Aguarde a entrega na mochila global da conta."
    );
  }
  if (consumedBy && consumedBy !== characterId) {
    throw new HttpsError("failed-precondition", "Esse beneficio esta vinculado a outro personagem.");
  }
  const productShape = {
    type: data.productType,
    code: data.productCode,
    id: data.productId,
    name: data.productName,
    benefits: data.benefits,
  };
  if (!isCharacterBagMonetizationProduct(productShape)) {
    throw new HttpsError("failed-precondition", "Este beneficio nao pode ser resgatado na mochila do personagem.");
  }
  const entitlementQty = Math.max(1, asInt(data.quantity, 1));

  await applyMonetizedCharacterItemGrantTx(tx, db, {
    uid,
    characterId,
    productType: data.productType,
    benefits: data.benefits,
    quantity: entitlementQty,
    itemCapacityLimit,
  });

  tx.set(
    entitlementRef,
    { claimedAt: FieldValue.serverTimestamp(), claimedByCharacterId: characterId, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
}

async function distributeAccountBackpackEntry(tx, db, uid, characterId, entryId) {
  const rewardRef = db.doc(`players/${uid}/accountBackpack/${entryId}`);
  const rewardSnap = await tx.get(rewardRef);
  if (!rewardSnap.exists) throw new HttpsError("not-found", "Recompensa nao encontrada.");
  const reward = { id: rewardSnap.id, ...(rewardSnap.data() || {}) };
  if (String(reward.status || "") !== "pending") throw new HttpsError("failed-precondition", "Essa recompensa ja foi distribuida.");

  if (norm(reward.rewardType) === "item_config") {
    const cfgId = norm(reward.itemConfigId);
    if (!cfgId) throw new HttpsError("failed-precondition", "Recompensa item_config sem itemConfigId.");
    const qty = Math.max(1, asInt(reward.quantity, 1));
    const cfgRef = db.doc(`itemsConfig/${cfgId}`);
    const cfgSnap = await tx.get(cfgRef);
    if (!cfgSnap.exists) throw new HttpsError("not-found", "itemsConfig nao encontrado para esta recompensa.");
    const cfg = cfgSnap.data() || {};
    const cfgIdNorm = norm(cfgId);
    const itemKindForDelivery =
      norm(cfg.category) === "pokebola" || cfgIdNorm.endsWith("-ball") || cfgIdNorm.includes("poke-ball")
        ? "POKEBALL"
        : "ITEM";
    await deliverItemsConfigShopPurchaseTx(tx, db, {
      uid,
      characterId,
      itemId: cfgId,
      qty,
      itemKind: itemKindForDelivery,
      itemCapacityLimit: 20,
    });
    const historyRefIc = db.collection(`players/${uid}/accountDistributionHistory`).doc();
    tx.set(historyRefIc, {
      accountBackpackEntryId: reward.id,
      rewardType: reward.rewardType || null,
      rewardName: reward.name || null,
      quantity: qty,
      characterId,
      source: reward.source || null,
      sourceOrderId: reward.sourceOrderId || null,
      sourcePlanId: reward.sourcePlanId || null,
      sourceProductId: reward.sourceProductId || reward.productId || null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.delete(rewardRef);
    return;
  }

  const type = norm(reward.productType);
  if (type === "incubator") {
    const amount = Math.max(1, asInt(reward?.benefits?.incubators, 1));
    await upsertItemWithMeta(tx, db, {
      uid,
      characterId,
      itemId: EGG_INCUBATOR_ITEM_ID,
      delta: amount,
      patch: { name: "Incubadora", description: "Usada para chocar ovos que exigem incubadora.", consumable: true },
    });
  } else if (type === "iv_reset") {
    const amount = Math.max(1, asInt(reward?.benefits?.ivResetCount, 1));
    await upsertItemWithMeta(tx, db, {
      uid,
      characterId,
      itemId: "iv-reset-token",
      delta: amount,
      patch: { name: "Reset IV", description: "Reseta os IVs do Pokemon alvo.", effectType: "RESET_IV", consumable: true },
    });
  } else if (type === "mystery_egg" || type === "egg" || type === "gym_type_egg") {
    const eggDelta = Math.max(1, asInt(reward?.benefits?.mysteryEggCount, 1)) * Math.max(1, asInt(reward.quantity, 1));
    await upsertItemWithMeta(tx, db, {
      uid,
      characterId,
      itemId: "mystery-egg",
      delta: eggDelta,
      patch: { name: "Ovo misterioso", description: "Coloque na incubadora pela Mochila.", consumable: true },
    });
  } else if (
    type === "biome_ticket" ||
    (type === "ticket" && norm(reward?.benefits?.metadata?.ticketSubtype || reward?.benefits?.metadata?.ticketType) === "biome")
  ) {
    const meta = reward.benefits?.metadata && typeof reward.benefits.metadata === "object" ? reward.benefits.metadata : {};
    const biomeId = norm(meta.biomeId || meta.targetBiomeId);
    if (!biomeId) {
      throw new HttpsError("failed-precondition", "Recompensa de ticket de bioma sem biomeId.");
    }
    const accessDays = Math.max(1, asInt(meta.biomeAccessDays, 7));
    const qty = Math.max(1, asInt(reward.quantity, 1));
    const durationHours =
      accessDays * 24 * Math.max(1, asInt(reward?.benefits?.biomeTicketCount, 1)) * qty;
    const accessRef = db.doc(`players/${uid}/characters/${characterId}/biome_access/${biomeId}`);
    const accessSnap = await tx.get(accessRef);
    const nowMs = Date.now();
    const prevExpires = accessSnap.exists ? readBiomeAccessExpiresAtMs(accessSnap.data() || {}) : 0;
    const baseMs = Math.max(nowMs, prevExpires);
    const expiresAtMs = baseMs + durationHours * 60 * 60 * 1000;
    tx.set(
      accessRef,
      {
        biomeId,
        source: "account_backpack_ticket",
        expiresAtMs,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } else if (type === "slot" || type === "gym_main_team_slot") {
    const amount = Math.max(1, asInt(reward?.benefits?.gymDefenseSlotsAdded || reward?.benefits?.gymMainTeamSlots || 1, 1));
    await upsertItemWithMeta(tx, db, {
      uid,
      characterId,
      itemId: GYM_MAIN_TEAM_SLOT_ITEM_ID,
      delta: amount,
      patch: {
        name: "Slot do time principal do GYM",
        description: "Use na mochila do personagem para liberar um novo slot do time principal do GYM.",
        effectType: "ACTIVATE_GYM_MAIN_TEAM_SLOT",
        consumable: true,
      },
    });
  } else {
    throw new HttpsError("failed-precondition", "Tipo de recompensa nao suportado.");
  }

  const historyRef = db.collection(`players/${uid}/accountDistributionHistory`).doc();
  tx.set(historyRef, {
    accountBackpackEntryId: reward.id,
    rewardType: reward.rewardType || null,
    rewardName: reward.name || null,
    quantity: Math.max(1, asInt(reward.quantity, 1)),
    characterId,
    source: reward.source || null,
    sourceOrderId: reward.sourceOrderId || null,
    sourcePlanId: reward.sourcePlanId || null,
    sourceProductId: reward.sourceProductId || reward.productId || null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  tx.delete(rewardRef);
}

async function purchaseGymCustomization(tx, db, uid, characterId, payload) {
  const kind = payload.kind === "npc" ? "npc" : "scenario";
  const itemId = norm(payload.itemId);
  const itemName = String(payload.itemName || itemId || "Item").trim();
  const price = Math.max(0, Number(payload.price || 0));
  if (!itemId || !price) throw new HttpsError("invalid-argument", "Parametros de compra invalidos.");
  const playerRef = db.doc(`players/${uid}`);
  const unlockRef = db.doc(`players/${uid}/${kind === "npc" ? "gymNpcUnlocks" : "gymScenarioUnlocks"}/${itemId}`);
  const inventoryId = `${kind === "npc" ? "gym-npc" : "gym-scenario"}-${itemId}`;
  const itemRef = db.doc(`players/${uid}/characters/${characterId}/itens/${inventoryId}`);
  const [playerSnap, unlockSnap, itemSnap] = await Promise.all([tx.get(playerRef), tx.get(unlockRef), tx.get(itemRef)]);
  if (unlockSnap.exists || itemSnap.exists) throw new HttpsError("failed-precondition", "Esse item ja foi desbloqueado/entregue.");
  const currentBalance = Math.max(0, Number(playerSnap.data()?.ecoinBalance || 0));
  if (currentBalance < price) throw new HttpsError("failed-precondition", "Saldo insuficiente de ECoins.");

  tx.set(playerRef, { ecoinBalance: currentBalance - price, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await upsertItemWithMeta(tx, db, {
    uid,
    characterId,
    itemId: inventoryId,
    delta: 1,
    patch: {
      name: itemName,
      description: kind === "scenario"
        ? "Ative na mochila para liberar este cenario na gestao do GYM."
        : "Ative na mochila para liberar este NPC na gestao do GYM.",
      effectType: kind === "scenario" ? "UNLOCK_GYM_SCENARIO" : "UNLOCK_GYM_NPC",
      imageUrl: String(payload.imageUrl || "").trim() || null,
      metadata: {
        customizationKind: kind,
        itemId,
        scenarioId: kind === "scenario" ? itemId : null,
        npcId: kind === "npc" ? itemId : null,
        source: "ecoin_purchase",
        pricePaid: price,
      },
    },
  });
}

async function resolveMonetizationProductRef(db, key) {
  const k = norm(key);
  if (!k) return null;
  const direct = await db.doc(`monetizationProducts/${k}`).get();
  if (direct.exists) return direct.ref;
  const col = await db.collection("monetizationProducts").where("code", "==", k).limit(1).get();
  if (!col.empty) return col.docs[0].ref;
  return null;
}

function isGymSlotMonetizationProduct(p) {
  const productType = norm(p?.type);
  const benefits = p && p.benefits && typeof p.benefits === "object" ? p.benefits : {};
  const metadata = benefits.metadata && typeof benefits.metadata === "object" ? benefits.metadata : {};
  const slotScope = norm(metadata.slotScope);
  const code = norm(p.code);
  const id = norm(p.id);
  const name = norm(p.name);
  const gymMainTeamSlots = asInt(benefits.gymMainTeamSlots, 0);
  const gymDefenseSlotsAdded = asInt(benefits.gymDefenseSlotsAdded, 0);
  const storeCategory = norm(metadata.storeCategory);
  return (
    productType === "gym_main_team_slot" ||
    (productType === "slot" && slotScope === "gym") ||
    code === "gym-main-team-slot" ||
    id === "gym-main-team-slot" ||
    ((gymMainTeamSlots > 0 || gymDefenseSlotsAdded > 0) &&
      (storeCategory === "gym" ||
        productType.includes("gym") ||
        code.includes("gym-main-team-slot") ||
        id.includes("gym-main-team-slot") ||
        name.includes("slot de defesa") ||
        name.includes("slot do time principal")))
  );
}

function isCharacterBagMonetizationProduct(p) {
  const productType = norm(p?.type);
  const benefits = p && p.benefits && typeof p.benefits === "object" ? p.benefits : {};
  const metadata = benefits.metadata && typeof benefits.metadata === "object" ? benefits.metadata : {};
  const ticketSubtype = norm(metadata.ticketSubtype || metadata.ticketType);
  return (
    isGymSlotMonetizationProduct(p) ||
    ["incubator", "iv_reset", "biome_ticket", "mystery_egg", "egg", "fishing_bait"].includes(productType) ||
    (productType === "ticket" && ticketSubtype === "biome")
  );
}

/**
 * Compra de produto monetizado com ECoins na loja do personagem (preco e saldo validados no servidor).
 * Itens de mochila (exceto slot GYM imediato) viram entitlement para claim posterior; slot GYM aplica na mesma transacao.
 */
async function executePurchaseMonetizedWithEcoins(db, uid, characterId, requestData) {
  const productIdRaw = String(requestData?.productId || "").trim();
  const qty = Math.max(1, asInt(requestData?.qty, 1));
  const itemCapacityLimit = asInt(requestData?.itemCapacityLimit, 20);
  const idemKey = sanitizeIdempotencyKey(requestData?.idempotencyKey);
  if (!productIdRaw) throw new HttpsError("invalid-argument", "productId obrigatorio.");
  const productRef = await resolveMonetizationProductRef(db, productIdRaw);
  if (!productRef) throw new HttpsError("not-found", "Produto nao encontrado.");

  let nextEcoinBalance = 0;
  let idempotentReplay = false;
  await db.runTransaction(async (tx) => {
    const playerRef = db.doc(`players/${uid}`);
    const itemRefGym = db.doc(`players/${uid}/characters/${characterId}/itens/${GYM_MAIN_TEAM_SLOT_ITEM_ID}`);
    const metaRefGym = db.doc(`players/${uid}/characters/${characterId}/itens/_meta`);

    if (idemKey) {
      const dedupRef = db.doc(`players/${uid}/idempotentEcoinPurchases/${idempotentEcoinPurchaseDocId(uid, characterId, idemKey)}`);
      const dedupSnap = await tx.get(dedupRef);
      if (dedupSnap.exists) {
        nextEcoinBalance = Math.max(0, Number(dedupSnap.data()?.nextEcoinBalance || 0));
        idempotentReplay = true;
        return;
      }
    }

    const [playerSnap, productSnap] = await Promise.all([tx.get(playerRef), tx.get(productRef)]);
    if (!productSnap.exists) throw new HttpsError("not-found", "Produto nao encontrado.");
    const productData = { id: productSnap.id, ...(productSnap.data() || {}) };
    if (String(productData.status || "").toLowerCase() !== "active") {
      throw new HttpsError("failed-precondition", "Produto indisponivel.");
    }
    const unitPrice = Math.max(0, Number(productData.price || 0));
    const total = unitPrice * qty;
    if (total <= 0) throw new HttpsError("failed-precondition", "Preco em ECoins invalido.");

    const isGymSlot = isGymSlotMonetizationProduct(productData);
    let gymItemSnap = null;
    let gymMetaSnap = null;
    if (isGymSlot) {
      const pair = await Promise.all([tx.get(itemRefGym), tx.get(metaRefGym)]);
      gymItemSnap = pair[0];
      gymMetaSnap = pair[1];
    }

    const currentBalance = Math.max(0, Number(playerSnap.data()?.ecoinBalance || 0));
    if (currentBalance < total) throw new HttpsError("failed-precondition", "Saldo insuficiente de ECoins.");
    nextEcoinBalance = currentBalance - total;

    tx.set(playerRef, { ecoinBalance: nextEcoinBalance, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

    if (isGymSlot) {
      const metaSlots =
        productData.benefits?.metadata && typeof productData.benefits.metadata === "object"
          ? productData.benefits.metadata
          : {};
      const amount = Math.max(
        1,
        asInt(
          productData.benefits?.gymDefenseSlotsAdded ||
            productData.benefits?.gymMainTeamSlots ||
            metaSlots.slotsAdded ||
            1,
          1
        )
      );
      await upsertItemWithMeta(tx, db, {
        uid,
        characterId,
        itemId: GYM_MAIN_TEAM_SLOT_ITEM_ID,
        delta: amount,
        patch: {
          name: "Slot do time principal do GYM",
          description: "Use na mochila do personagem para liberar um novo slot do time principal do GYM.",
          effectType: "ACTIVATE_GYM_MAIN_TEAM_SLOT",
          consumable: true,
          metadata: {
            source: "ecoin_character_store_purchase",
            productId: String(productData.id || ""),
            productCode: productData.code || null,
            purchaseContext: "character_store",
            deliveredCharacterId: characterId,
          },
        },
        itemCapacityLimit,
        preloadedItemSnap: gymItemSnap,
        preloadedMetaSnap: gymMetaSnap,
      });
    }

    const bag = isCharacterBagMonetizationProduct(productData);
    const deliveryScope = bag ? "character_backpack" : "account";
    const consumedByCharacterId = bag ? characterId : null;
    const isGymSlotClaimed = isGymSlot;

    const entRef = db.collection(`players/${uid}/productEntitlements`).doc();
    tx.set(entRef, {
      entitlementId: entRef.id,
      productId: String(productData.id || ""),
      productCode: productData.code || null,
      productType: String(productData.type || "product"),
      productName: String(productData.name || "Produto"),
      benefits: productData.benefits || null,
      quantity: qty,
      status: "active",
      source: "system",
      deliveryScope,
      consumedCurrency: "ECOIN",
      purchaseContext: "character_store",
      consumedByCharacterId,
      claimedAt: isGymSlotClaimed ? FieldValue.serverTimestamp() : null,
      claimedByCharacterId: isGymSlotClaimed ? characterId : null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const historyRef = db.collection(`players/${uid}/monetizationHistory`).doc();
    tx.set(historyRef, {
      type: "product_activation",
      source: "system",
      status: "active",
      itemId: String(productData.id || ""),
      itemType: "product",
      itemName: String(productData.name || "Produto"),
      amountPaid: total,
      currency: "ECOIN",
      purchaseContext: "character_store",
      consumedByCharacterId,
      ecoinAmount: total,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const txRef = db.collection(`players/${uid}/characters/${characterId}/transactions`).doc();
    tx.set(txRef, {
      type: "ecoin_product_purchase",
      paymentType: "ECOIN",
      itemId: String(productData.id || ""),
      itemName: String(productData.name || "Produto"),
      quantity: qty,
      unitPrice: unitPrice,
      totalPaid: total,
      status: "approved",
      consumedCurrency: "ECOIN",
      purchaseContext: "character_store",
      consumedByCharacterId,
      createdAt: FieldValue.serverTimestamp(),
    });

    if (idemKey) {
      const dedupRef = db.doc(`players/${uid}/idempotentEcoinPurchases/${idempotentEcoinPurchaseDocId(uid, characterId, idemKey)}`);
      tx.set(dedupRef, {
        productId: String(productData.id || ""),
        characterId,
        qty,
        nextEcoinBalance,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  });

  return { nextEcoinBalance, idempotentReplay };
}

/**
 * Compra na loja (itemsConfig) com PokeCoins — servidor apenas (Firestore rules bloqueiam itens no cliente).
 * Transação: todas as leituras antes de qualquer escrita.
 */
async function executePurchaseItemsConfigWithPokecoins(db, uid, characterId, requestData) {
  const itemId = norm(requestData?.itemId);
  const qty = Math.max(1, asInt(requestData?.qty, 1));
  const itemCapacityLimit = asInt(requestData?.itemCapacityLimit, 20);
  if (!itemId) throw new HttpsError("invalid-argument", "itemId obrigatorio.");

  let nextPokeCoins = 0;

  await db.runTransaction(async (tx) => {
    const charRef = db.doc(`players/${uid}/characters/${characterId}`);
    const cfgRef = db.doc(`itemsConfig/${itemId}`);
    const [charSnap, cfgSnap] = await Promise.all([tx.get(charRef), tx.get(cfgRef)]);
    if (!charSnap.exists) throw new HttpsError("not-found", "Personagem nao encontrado.");
    if (!cfgSnap.exists) throw new HttpsError("not-found", "Item da loja nao encontrado.");

    const cfg = cfgSnap.data() || {};
    const unit = Math.max(0, Number(cfg.gamePrice ?? cfg.price ?? 0));
    if (unit <= 0) throw new HttpsError("failed-precondition", "Item nao vende por PokeCoins.");
    const total = unit * qty;
    const coins = Math.max(0, asInt(charSnap.data()?.pokeCoins, 0));
    if (coins < total) throw new HttpsError("failed-precondition", "Saldo insuficiente de PokeCoins.");
    nextPokeCoins = coins - total;

    const grantTypeCfg = norm(cfg.grantType);
    const txRef = db.collection(`players/${uid}/characters/${characterId}/transactions`).doc();

    if (grantTypeCfg === "biome_access") {
      const biomeId = norm(cfg.biomeAccessBiomeId);
      const durationHours = Math.max(1, asInt(cfg.biomeAccessDurationHours, 24));
      if (!biomeId) throw new HttpsError("failed-precondition", "Passe de bioma invalido na configuracao.");
      const accessRef = db.doc(`players/${uid}/characters/${characterId}/biome_access/${biomeId}`);
      const accessSnap = await tx.get(accessRef);

      tx.set(charRef, { pokeCoins: nextPokeCoins, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      const nowMs = Date.now();
      const prevExpires = accessSnap.exists ? readBiomeAccessExpiresAtMs(accessSnap.data() || {}) : 0;
      const baseMs = Math.max(nowMs, prevExpires);
      const expiresAtMs = baseMs + durationHours * qty * 60 * 60 * 1000;
      tx.set(
        accessRef,
        { biomeId, source: "shop", expiresAtMs, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
      tx.set(txRef, {
        type: "biome_access_purchase",
        paymentType: "POKECOINS",
        itemId,
        itemName: String(cfg.itemName || itemId),
        biomeId,
        durationHours,
        quantity: qty,
        unitPrice: unit,
        totalPaid: total,
        status: "approved",
        createdAt: FieldValue.serverTimestamp(),
      });
      return;
    }

    const name = String(cfg.itemName || itemId);
    const description = String(cfg.descriptionPtBr || cfg.effectPtBr || "").trim() || "Item da loja.";
    const cat = norm(cfg.category);
    const idLooksLikeBall = itemId.endsWith("-ball") || itemId.includes("poke-ball") || itemId.includes("ultra-ball");
    const preferBall = cat === "pokebola" || idLooksLikeBall;
    const kind = preferBall ? "POKEBALL" : "ITEM";

    if (kind === "POKEBALL") {
      const ballRef = db.doc(`players/${uid}/characters/${characterId}/pokeballs/${itemId}`);
      const ballMetaRef = db.doc(`players/${uid}/characters/${characterId}/pokeballs/_meta`);
      const [ballSnap, ballMetaSnap] = await Promise.all([tx.get(ballRef), tx.get(ballMetaRef)]);
      const metaTotal = ballMetaSnap.exists ? Math.max(0, asInt(ballMetaSnap.data()?.totalQuantity, 0)) : 0;
      const lim = ballMetaSnap.exists ? asInt(ballMetaSnap.data()?.limit, 0) : 0;
      const nextTotal = metaTotal + qty;
      if (lim > 0 && nextTotal > lim) {
        throw new HttpsError("failed-precondition", `Limite da mochila excedido (${nextTotal}/${lim}).`);
      }
      const captureBonus = Math.max(1, asInt(cfg.captureBonus, 1));

      tx.set(charRef, { pokeCoins: nextPokeCoins, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      await upsertPokeballWithMeta(tx, db, {
        uid,
        characterId,
        ballId: itemId,
        delta: qty,
        patch: {
          name,
          description,
          captureBonus,
          isMasterBall: itemId === "master-ball",
          consumable: true,
        },
        preloadedBallSnap: ballSnap,
        preloadedBallMetaSnap: ballMetaSnap,
      });
    } else {
      const itemRef = db.doc(`players/${uid}/characters/${characterId}/itens/${itemId}`);
      const itemMetaRef = db.doc(`players/${uid}/characters/${characterId}/itens/_meta`);
      const [itemSnap, metaSnap] = await Promise.all([tx.get(itemRef), tx.get(itemMetaRef)]);
      const metaTotal = metaSnap.exists ? Math.max(0, asInt(metaSnap.data()?.totalQuantity, 0)) : 0;
      const lim = metaSnap.exists ? asInt(metaSnap.data()?.limit, 0) : 0;
      const nextTotal = metaTotal + qty;
      if (lim > 0 && nextTotal > lim) {
        throw new HttpsError("failed-precondition", `Limite da mochila excedido (${nextTotal}/${lim}).`);
      }

      tx.set(charRef, { pokeCoins: nextPokeCoins, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

      const effectType = String(cfg.effectType || "").trim().toUpperCase();
      const fishingConfig = cfg.fishingConfig && typeof cfg.fishingConfig === "object" ? cfg.fishingConfig : null;
      const { metadata: fishingMeta, perUnitUses: fishingPerUnitUses } = buildFishingBaitItemPatch(fishingConfig);
      const patch = {
        name,
        description,
        consumable: cfg.consumable !== false,
        imageUrl: typeof cfg.imageUrl === "string" ? cfg.imageUrl : null,
        ...(effectType ? { effectType } : {}),
        ...(fishingMeta ? { metadata: fishingMeta } : {}),
      };
      if (cfg.healAmount != null) patch.healAmount = Math.max(0, asInt(cfg.healAmount, 0));
      if (cfg.revivePercent != null) patch.revivePercent = Math.max(0, asInt(cfg.revivePercent, 0));
      const itemDelta = qty * Math.max(1, asInt(fishingPerUnitUses, 1));

      await upsertItemWithMeta(tx, db, {
        uid,
        characterId,
        itemId,
        delta: itemDelta,
        patch,
        itemCapacityLimit,
        preloadedItemSnap: itemSnap,
        preloadedMetaSnap: metaSnap,
      });
    }

    tx.set(txRef, {
      type: "item_purchase",
      paymentType: "POKECOINS",
      itemId,
      itemName: name,
      quantity: qty,
      unitPrice: unit,
      totalPaid: total,
      status: "approved",
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  return { nextPokeCoins };
}

/**
 * Coliseu: moedas + ECoin + itens de aposta com base no resultado oficial em
 * battleRooms (lado dono). Idempotente via `coliseuPvpCurrencySettled`.
 *
 * Duas rotas conforme `coliseu_rooms.escrowActive`:
 *
 *  1) **Com escrow** (`escrowActive === true`): ECoin/itens dos dois lados já
 *     foram debitados no momento de entrar na sala e vivem em
 *     `players/{uid}/pvpEscrow/{roomId}`. O settle apenas:
 *       - Credita ao vencedor os valores dos DOIS escrows (o dele + o do perdedor).
 *       - Apaga ambos os docs de escrow.
 *       - Se o resultado for "ran" (forfeit mútuo), devolve cada escrow ao dono.
 *     Nunca re-debita o perdedor. PokeCoins são sempre creditadas (300/poké
 *     ao vencedor, 150/poké ao perdedor como consolação — ambos ganham).
 *
 *  2) **Sem escrow** (compat): comportamento legado — debita ECoin do perdedor
 *     e credita ao vencedor no momento do settle. Usado por salas antigas
 *     criadas antes da Fase C.
 */
async function executeSettleColiseuPvp(db, uid, data) {
  const battleRoomId = String(data?.battleRoomId || "").trim();
  if (!battleRoomId) throw new HttpsError("invalid-argument", "battleRoomId obrigatorio.");

  let out = { settled: true };

  await db.runTransaction(async (tx) => {
    const brRef = db.doc(`battleRooms/${battleRoomId}`);
    const brSnap = await tx.get(brRef);
    if (!brSnap.exists) throw new HttpsError("not-found", "Sala de batalha nao encontrada.");
    const br = brSnap.data() || {};
    const ownerUid = String(br.ownerUid || "").trim();
    const challengerUid = String(br.challengerUid || "").trim();
    if (!ownerUid || !challengerUid) throw new HttpsError("failed-precondition", "Batalha incompleta.");
    if (uid !== ownerUid && uid !== challengerUid) throw new HttpsError("permission-denied", "Voce nao participou dessa batalha.");
    if (String(br.status || "").trim().toLowerCase() !== "finished") {
      throw new HttpsError("failed-precondition", "Batalha ainda nao finalizada no servidor.");
    }
    if (br.coliseuPvpCurrencySettled === true) {
      out = { settled: false, alreadySettled: true };
      return;
    }

    const coliseuRoomId = String(br.coliseuRoomId || "").trim();
    if (!coliseuRoomId) throw new HttpsError("failed-precondition", "Sala sem coliseu vinculado.");

    const colRef = db.doc(`coliseu_rooms/${coliseuRoomId}`);
    const colSnap = await tx.get(colRef);
    if (!colSnap.exists) throw new HttpsError("not-found", "Sala Coliseu nao encontrada.");
    const c = colSnap.data() || {};
    const bet = c.bet && typeof c.bet === "object" ? c.bet : {};
    const gain = Math.max(0, Number(bet.coinsWin || 0));
    const loss = Math.max(0, Number(bet.coinsLose || 0));
    const escrowActive = c.escrowActive === true;

    const rawResult = String(br.pvpLastBattleResult || "ongoing").trim().toLowerCase();
    const isRan = rawResult === "ran";
    let ownerWon = false;
    if (rawResult === "victory") ownerWon = true;
    else if (rawResult === "defeat") ownerWon = false;
    else if (!isRan) throw new HttpsError("failed-precondition", "Resultado da batalha ainda nao consolidado.");

    const winnerUid = ownerWon ? ownerUid : challengerUid;
    const loserUid = ownerWon ? challengerUid : ownerUid;
    const winnerCharId = ownerWon ? String(br.ownerCharacterId || "").trim() : String(br.challengerCharacterId || "").trim();
    const loserCharId = ownerWon ? String(br.challengerCharacterId || "").trim() : String(br.ownerCharacterId || "").trim();
    if (!winnerCharId || !loserCharId) throw new HttpsError("failed-precondition", "Personagens da batalha incompletos.");

    const wCharRef = db.doc(`players/${winnerUid}/characters/${winnerCharId}`);
    const lCharRef = db.doc(`players/${loserUid}/characters/${loserCharId}`);

    // PokeCoins (regra econômica atual): ambos ganham, vencedor coinsWin, perdedor coinsLose.
    // Em "ran" (forfeit mútuo), ninguém ganha PokeCoins — é um empate técnico.
    const wCharSnap = await tx.get(wCharRef);
    const lCharSnap = await tx.get(lCharRef);
    const wCoins = Math.max(0, Number(wCharSnap.data()?.pokeCoins || 0));
    const lCoins = Math.max(0, Number(lCharSnap.data()?.pokeCoins || 0));

    if (!isRan) {
      tx.set(wCharRef, { pokeCoins: wCoins + gain, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      tx.set(lCharRef, { pokeCoins: lCoins + loss, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }

    // --- Aposta ECoin/itens: rota dependente de escrow ---
    if (escrowActive) {
      const ownerEscRef = db.doc(`players/${ownerUid}/pvpEscrow/${coliseuRoomId}`);
      const challengerEscRef = db.doc(`players/${challengerUid}/pvpEscrow/${coliseuRoomId}`);
      const [ownerEscSnap, challengerEscSnap] = await Promise.all([
        tx.get(ownerEscRef),
        tx.get(challengerEscRef),
      ]);

      if (isRan) {
        // Forfeit mútuo: devolve escrow a cada um (usando refund inline).
        await _refundEscrowDataInTx(tx, db, ownerUid, ownerEscSnap);
        await _refundEscrowDataInTx(tx, db, challengerUid, challengerEscSnap);
      } else {
        // Vencedor leva tudo: soma escrow próprio (devolvendo-o) + escrow do perdedor (transferindo-o).
        await _refundEscrowDataInTx(tx, db, winnerUid, ownerWon ? ownerEscSnap : challengerEscSnap);
        await _transferEscrowDataToWinnerInTx(
          tx,
          db,
          winnerUid,
          winnerCharId,
          ownerWon ? challengerEscSnap : ownerEscSnap,
        );
      }
    } else {
      // --- Rota legada (compat sem escrow) ---
      const ec = Math.max(0, Number(bet.ecoin || 0));
      const items = Array.isArray(bet.items) ? bet.items : [];

      let wpRef = null;
      let lpRef = null;
      const itemOps = [];
      for (const it of items) {
        const itemId = norm(it?.itemId);
        const qty = Math.max(1, asInt(it?.qty, 1));
        if (!itemId) continue;
        itemOps.push({
          itemId,
          qty,
          loseRef: db.doc(`players/${loserUid}/characters/${loserCharId}/itens/${itemId}`),
          winRef: db.doc(`players/${winnerUid}/characters/${winnerCharId}/itens/${itemId}`),
        });
      }
      const reads = [];
      if (ec > 0) {
        wpRef = db.doc(`players/${winnerUid}`);
        lpRef = db.doc(`players/${loserUid}`);
        reads.push(tx.get(wpRef), tx.get(lpRef));
      }
      for (const op of itemOps) reads.push(tx.get(op.loseRef), tx.get(op.winRef));
      const snaps = await Promise.all(reads);

      let idx = 0;
      if (ec > 0 && !isRan) {
        const wpSnap = snaps[idx++];
        const lpSnap = snaps[idx++];
        const we = Math.max(0, Number(wpSnap.data()?.ecoinBalance || 0));
        const le = Math.max(0, Number(lpSnap.data()?.ecoinBalance || 0));
        if (le < ec) throw new HttpsError("failed-precondition", "Saldo ECoin insuficiente para a aposta.");
        tx.set(wpRef, { ecoinBalance: we + ec, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        tx.set(lpRef, { ecoinBalance: Math.max(0, le - ec), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      } else if (ec > 0 && isRan) {
        idx += 2; // pula leituras; em "ran" legado não transferimos nada.
      }

      for (const op of itemOps) {
        const loseSnap = snaps[idx++];
        const winSnap = snaps[idx++];
        if (isRan) continue;
        const lq = Math.max(0, asInt(loseSnap.data()?.quantity, 0));
        if (lq < op.qty) continue;
        const wq = Math.max(0, asInt(winSnap.data()?.quantity, 0));
        tx.set(op.loseRef, { quantity: lq - op.qty, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        tx.set(
          op.winRef,
          { id: op.itemId, kind: "ITEM", quantity: wq + op.qty, updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        );
      }
    }

    tx.set(brRef, { coliseuPvpCurrencySettled: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(colRef, {
      status: "finished",
      escrowActive: false,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  return out;
}

/**
 * Devolve todo o conteúdo de um snapshot de escrow para o `uid` indicado.
 * Recebe o snapshot JÁ LIDO dentro da transação (contrato: todas as leituras
 * antes das escritas). Apaga o doc de escrow no fim.
 */
async function _refundEscrowDataInTx(tx, db, uid, escSnap) {
  if (!escSnap.exists) return;
  const data = escSnap.data() || {};
  const characterId = String(data.characterId || "").trim();
  if (!characterId) { tx.delete(escSnap.ref); return; }
  const ecoin = Math.max(0, asInt(data.ecoin, 0));
  const items = Array.isArray(data.items) ? data.items : [];

  const playerRef = db.doc(`players/${uid}`);
  const reads = [];
  if (ecoin > 0) reads.push(tx.get(playerRef));
  const itemPairs = [];
  for (const it of items) {
    const itemId = String(it?.itemId || "").trim();
    const qty = Math.max(0, asInt(it?.qty, 0));
    if (!itemId || qty <= 0) continue;
    const iRef = db.doc(`players/${uid}/characters/${characterId}/itens/${itemId}`);
    itemPairs.push({ itemId, qty, ref: iRef, idx: reads.length });
    reads.push(tx.get(iRef));
  }
  const snaps = await Promise.all(reads);
  let i = 0;
  if (ecoin > 0) {
    const bal = Math.max(0, Number(snaps[i++].data()?.ecoinBalance || 0));
    tx.set(playerRef, { ecoinBalance: bal + ecoin, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  for (const p of itemPairs) {
    const have = Math.max(0, asInt(snaps[p.idx].data()?.quantity, 0));
    tx.set(p.ref, { id: p.itemId, kind: "ITEM", quantity: have + p.qty, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  tx.delete(escSnap.ref);
}

/**
 * Transfere o conteúdo de um escrow (do perdedor) para a conta do vencedor.
 * Apaga o doc de escrow no fim. Não re-debita ninguém.
 */
async function _transferEscrowDataToWinnerInTx(tx, db, winnerUid, winnerCharId, escSnap) {
  if (!escSnap.exists) return;
  const data = escSnap.data() || {};
  const ecoin = Math.max(0, asInt(data.ecoin, 0));
  const items = Array.isArray(data.items) ? data.items : [];

  const playerRef = db.doc(`players/${winnerUid}`);
  const reads = [];
  if (ecoin > 0) reads.push(tx.get(playerRef));
  const itemPairs = [];
  for (const it of items) {
    const itemId = String(it?.itemId || "").trim();
    const qty = Math.max(0, asInt(it?.qty, 0));
    if (!itemId || qty <= 0) continue;
    const iRef = db.doc(`players/${winnerUid}/characters/${winnerCharId}/itens/${itemId}`);
    itemPairs.push({ itemId, qty, ref: iRef, idx: reads.length });
    reads.push(tx.get(iRef));
  }
  const snaps = await Promise.all(reads);
  let i = 0;
  if (ecoin > 0) {
    const bal = Math.max(0, Number(snaps[i++].data()?.ecoinBalance || 0));
    tx.set(playerRef, { ecoinBalance: bal + ecoin, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  for (const p of itemPairs) {
    const have = Math.max(0, asInt(snaps[p.idx].data()?.quantity, 0));
    tx.set(p.ref, { id: p.itemId, kind: "ITEM", quantity: have + p.qty, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  tx.delete(escSnap.ref);
}

function isNurseNpcRole(roleRaw) {
  const r = norm(roleRaw);
  return r === "nurse" || r === "enfermeiro" || r === "enfermeira";
}

/**
 * Centro Pokémon (NPC enfermeira): restaura HP/PP/status nos slots escolhidos (inclui reviver).
 * Preço por Pokémon vem de `npcs/{npcId}.healPricePokeCoins` (não confiar no cliente).
 */
async function executePokemonCenterHealSlots(db, uid, characterId, data) {
  const npcId = String(data?.npcId || "").trim();
  if (!npcId) throw new HttpsError("invalid-argument", "npcId obrigatorio.");
  const slotsRaw = Array.isArray(data?.slotIndices) ? data.slotIndices : [];
  const slotSet = new Set();
  for (const s of slotsRaw) {
    const si = Math.max(1, Math.min(6, asInt(s, 0)));
    if (si >= 1 && si <= 6) slotSet.add(si);
  }
  const slots = [...slotSet].sort((a, b) => a - b);
  if (!slots.length) throw new HttpsError("invalid-argument", "Selecione pelo menos um Pokemon do time.");

  let nextPokeCoins = null;

  await db.runTransaction(async (tx) => {
    const npcRef = db.doc(`npcs/${npcId}`);
    const charRef = db.doc(`players/${uid}/characters/${characterId}`);
    const slotRefs = slots.map((si) => db.doc(`players/${uid}/characters/${characterId}/time/slot_${si}`));
    const snaps = await Promise.all([tx.get(npcRef), tx.get(charRef), ...slotRefs.map((r) => tx.get(r))]);
    const npcSnap = snaps[0];
    const charSnap = snaps[1];
    if (!npcSnap.exists) throw new HttpsError("not-found", "NPC nao encontrado.");
    const nd = npcSnap.data() || {};
    if (!isNurseNpcRole(nd.role)) throw new HttpsError("failed-precondition", "Esse NPC nao oferece servico de cura.");
    const pricePer = Math.max(0, asInt(nd.healPricePokeCoins, 0));
    if (!charSnap.exists) throw new HttpsError("not-found", "Personagem nao encontrado.");
    const coins0 = Math.max(0, Number(charSnap.data()?.pokeCoins || 0));
    const totalCost = pricePer * slots.length;
    if (totalCost > coins0) {
      throw new HttpsError("failed-precondition", "PokeCoins insuficientes para esta cura.");
    }

    for (let i = 0; i < slots.length; i++) {
      const snap = snaps[2 + i];
      if (!snap.exists) throw new HttpsError("not-found", `Pokemon do slot ${slots[i]} nao encontrado.`);
      const mon = snap.data() || {};
      if (asInt(mon.speciesId, 0) <= 0) throw new HttpsError("invalid-argument", `Slot ${slots[i]} esta vazio.`);
    }

    const nextCoins = Math.max(0, coins0 - totalCost);
    nextPokeCoins = nextCoins;
    tx.set(charRef, { pokeCoins: nextCoins, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

    for (let i = 0; i < slots.length; i++) {
      const snap = snaps[2 + i];
      const mon = snap.data() || {};
      const speciesId = asInt(mon.speciesId, 0);
      const ivs =
        mon.ivs && typeof mon.ivs === "object"
          ? mon.ivs
          : { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
      const evs =
        mon.evs && typeof mon.evs === "object"
          ? mon.evs
          : { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
      const level = Math.max(1, asInt(mon.level, 1));
      const hpTotalPrev = Math.max(1, asInt(mon?.hp?.total ?? mon?.hpTotal, 1));
      const canonicalHp = fullHpForSpeciesAtLevel(speciesId, level, ivs, evs);
      const hpTotalCanonical = Math.max(1, asInt(canonicalHp.total, 1));
      const hpTotal = Math.max(hpTotalPrev, hpTotalCanonical);
      const moves = Array.isArray(mon.moves) ? mon.moves.map((m) => norm(m)).filter(Boolean).slice(0, 4) : [];
      const movePp = buildMovePp(moves);
      tx.set(
        slotRefs[i],
        {
          hp: { current: hpTotal, total: hpTotal },
          ...(movePp.length ? { movePp } : {}),
          status: FieldValue.delete(),
          statusCondition: FieldValue.delete(),
          nonVolatileStatus: FieldValue.delete(),
          volatileStatus: FieldValue.delete(),
          battleStatus: FieldValue.delete(),
          statusTurns: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  });

  return { nextPokeCoins };
}

async function handleItemMutationsCore(request) {
  const payload = request.data && typeof request.data === "object" ? request.data : {};
  const hasIdToken = typeof payload.idToken === "string" && payload.idToken.trim().length > 0;
  let uid = "";
  try {
    uid = await resolveCallableUid(request);
  } catch (err) {
    logger.error("[itemMutations] falha auth", {
      functionName: "itemMutations",
      hasAuth: !!request.auth?.uid,
      hasIdToken,
      requestAuthUid: request.auth?.uid || null,
      resolvedUid: null,
      code: err?.code || null,
      message: err?.message || String(err),
    });
    throw err;
  }
  logger.info("[itemMutations] auth resolvida", {
    functionName: "itemMutations",
    hasAuth: !!request.auth?.uid,
    hasIdToken,
    requestAuthUid: request.auth?.uid || null,
    resolvedUid: uid,
  });
  const action = norm(request.data?.action);
  const db = getFirestore();

  if (action === "settle_coliseu_pvp") {
    const extra = await executeSettleColiseuPvp(db, uid, request.data || {});
    return { ok: true, ...extra };
  }
  if (action === "apply_gym_upgrade_entitlement") {
    const characterId = requireCharacterId(request.data?.characterId);
    await gymServerActions.executeApplyGymUpgradeEntitlement(db, uid, characterId, request.data || {});
    return { ok: true };
  }
  if (action === "renew_gym_with_entitlement") {
    const characterId = requireCharacterId(request.data?.characterId);
    await gymServerActions.executeRenewGymWithEntitlement(db, uid, characterId, request.data || {});
    return { ok: true };
  }
  if (action === "create_gym_with_ticket") {
    const characterId = requireCharacterId(request.data?.characterId);
    await gymServerActions.executeCreateGymWithTicket(db, uid, characterId, request.data || {});
    return { ok: true };
  }

  const characterId = requireCharacterId(request.data?.characterId);

  if (action === "purchase_items_config_with_pokecoins") {
    const extra = await executePurchaseItemsConfigWithPokecoins(db, uid, characterId, request.data || {});
    return { ok: true, ...extra };
  }

  if (action === "purchase_monetized_with_ecoins") {
    const extra = await executePurchaseMonetizedWithEcoins(db, uid, characterId, request.data || {});
    return { ok: true, ...extra };
  }

  if (action === "pokemon_center_heal_slots") {
    const extra = await executePokemonCenterHealSlots(db, uid, characterId, request.data || {});
    return { ok: true, ...extra };
  }

  await db.runTransaction(async (tx) => {
    if (action === "claim_entitlement") {
      const entitlementId = String(request.data?.entitlementId || "").trim();
      if (!entitlementId) throw new HttpsError("invalid-argument", "entitlementId obrigatorio.");
      await claimEntitlementToCharacter(tx, db, uid, characterId, entitlementId, asInt(request.data?.itemCapacityLimit, 20));
      return;
    }
    if (action === "distribute_account_backpack") {
      const entryId = String(request.data?.entryId || "").trim();
      if (!entryId) throw new HttpsError("invalid-argument", "entryId obrigatorio.");
      await distributeAccountBackpackEntry(tx, db, uid, characterId, entryId);
      return;
    }
    if (action === "purchase_gym_customization") {
      await purchaseGymCustomization(tx, db, uid, characterId, request.data || {});
      return;
    }
    if (action === "transfer_coliseu_bet_items") {
      const winnerUid = String(request.data?.winnerUid || "").trim();
      const loserUid = String(request.data?.loserUid || "").trim();
      const winnerCharId = String(request.data?.winnerCharacterId || "").trim();
      const loserCharId = String(request.data?.loserCharacterId || "").trim();
      const items = Array.isArray(request.data?.items) ? request.data.items : [];
      if (!winnerUid || !loserUid || !winnerCharId || !loserCharId) throw new HttpsError("invalid-argument", "Parametros invalidos.");
      const itemOps = [];
      for (const it of items) {
        const itemId = norm(it?.itemId);
        const qty = Math.max(1, asInt(it?.qty, 1));
        if (!itemId) continue;
        itemOps.push({
          itemId,
          qty,
          loseRef: db.doc(`players/${loserUid}/characters/${loserCharId}/itens/${itemId}`),
          winRef: db.doc(`players/${winnerUid}/characters/${winnerCharId}/itens/${itemId}`),
        });
      }
      if (itemOps.length) {
        const itemSnaps = await Promise.all(itemOps.flatMap((op) => [tx.get(op.loseRef), tx.get(op.winRef)]));
        for (let i = 0; i < itemOps.length; i++) {
          const op = itemOps[i];
          const loseSnap = itemSnaps[i * 2];
          const winSnap = itemSnaps[i * 2 + 1];
          const lq = Math.max(0, asInt(loseSnap.data()?.quantity, 0));
          if (lq < op.qty) continue;
          const wq = Math.max(0, asInt(winSnap.data()?.quantity, 0));
          tx.set(op.loseRef, { quantity: lq - op.qty, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
          tx.set(
            op.winRef,
            { id: op.itemId, kind: "ITEM", quantity: wq + op.qty, updatedAt: FieldValue.serverTimestamp() },
            { merge: true }
          );
        }
      }
      return;
    }
    if (action === "use_item") {
      const itemId = norm(request.data?.itemId);
      const slotIndex = Math.max(1, Math.min(6, asInt(request.data?.slotIndex, 1)));
      const boxDocId = String(request.data?.boxDocId || "").trim();
      if (!itemId) throw new HttpsError("invalid-argument", "itemId obrigatorio.");
      const itemRef = db.doc(`players/${uid}/characters/${characterId}/itens/${itemId}`);
      const itemMetaRef = db.doc(`players/${uid}/characters/${characterId}/itens/_meta`);
      const [itemSnap, metaSnap] = await Promise.all([tx.get(itemRef), tx.get(itemMetaRef)]);
      if (!itemSnap.exists) throw new HttpsError("not-found", "Item nao encontrado no inventario.");
      const itemData = itemSnap.data() || {};
      const qty = Math.max(0, asInt(itemData.quantity, 0));
      if (qty <= 0) throw new HttpsError("failed-precondition", "Quantidade insuficiente.");
      let effectType = String(itemData.effectType || "").trim().toUpperCase();
      // Rare Candy: muitos inventários legados / grants sem `effectType` caíam no fallback
      // final que só debitava quantidade, sem subir nível.
      if (!effectType && norm(itemId) === "rare-candy") {
        effectType = "LEVEL_UP";
      }
      const targetRef = boxDocId
        ? db.doc(`players/${uid}/characters/${characterId}/box/${boxDocId}`)
        : db.doc(`players/${uid}/characters/${characterId}/time/slot_${slotIndex}`);

      const consumeOne = () => {
        const nextQty = qty - 1;
        if (nextQty <= 0) tx.delete(itemRef);
        else tx.set(itemRef, { quantity: nextQty, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        const total = Math.max(0, asInt(metaSnap.data()?.totalQuantity, 0));
        tx.set(itemMetaRef, { totalQuantity: Math.max(0, total - 1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      };

      if (effectType === "HEAL" || effectType === "REVIVE") {
        if (boxDocId) throw new HttpsError("failed-precondition", "Esse item so pode ser usado no time.");
        const slotSnap = await tx.get(targetRef);
        if (!slotSnap.exists) throw new HttpsError("not-found", "Pokemon alvo nao encontrado.");
        const mon = slotSnap.data() || {};
        const hpTotal = Math.max(1, Number(mon.hp?.total || 1));
        const hpCurrent = Math.max(0, Number(mon.hp?.current || 0));
        if (effectType === "HEAL") {
          if (hpCurrent <= 0) throw new HttpsError("failed-precondition", "Pokemon nocauteado. Use um Revive.");
          if (hpCurrent >= hpTotal) throw new HttpsError("failed-precondition", "Esse Pokemon ja esta com HP completo.");
          const healAmount = Math.max(1, Number(itemData.healAmount || 20));
          tx.set(targetRef, { hp: { current: Math.min(hpTotal, hpCurrent + healAmount), total: hpTotal }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        } else {
          if (hpCurrent > 0) throw new HttpsError("failed-precondition", "Revive so pode ser usado em Pokemon nocauteado.");
          const revivePercent = Math.max(1, Number(itemData.revivePercent || 50));
          tx.set(targetRef, { hp: { current: Math.max(1, Math.floor((hpTotal * revivePercent) / 100)), total: hpTotal }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        }
        consumeOne();
        return;
      }

      if (effectType === "EQUIP_HELD") {
        const monSnap = await tx.get(targetRef);
        if (!monSnap.exists) throw new HttpsError("not-found", "Pokemon alvo nao encontrado.");
        const mon = monSnap.data() || {};
        if (asInt(mon.speciesId, 0) <= 0) throw new HttpsError("failed-precondition", "Alvo invalido.");
        const equipId = itemId;
        const prevHeld = norm(mon.heldItemId || mon.itemId);
        if (prevHeld === equipId) throw new HttpsError("failed-precondition", "Este Pokemon ja segura esse item.");
        if (prevHeld) {
          await upsertItemWithMeta(tx, db, {
            uid,
            characterId,
            itemId: prevHeld,
            delta: 1,
            patch: { id: prevHeld },
          });
        }
        tx.set(targetRef, { heldItemId: equipId, itemId: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        consumeOne();
        return;
      }

      if (effectType === "ACTIVATE_GYM_MAIN_TEAM_SLOT") {
        if (boxDocId) throw new HttpsError("failed-precondition", "Este item nao e aplicavel na BOX.");
        const gymRef = db.doc(`gyms/${uid}`);
        const creditRef = db.doc(`players/${uid}/gymUpgradeCredits/main_team_slot`);
        const gymSnap = await tx.get(gymRef);
        if (gymSnap.exists) {
          const gym = gymSnap.data() || {};
          const currentTotalSlots = Math.max(1, Math.min(6, asInt(gym.totalSlots || gym.mainTeamSlotLimit, 1)));
          if (currentTotalSlots >= 6) throw new HttpsError("failed-precondition", "O GYM ja atingiu o limite maximo de 6 slots.");
          const nextTotalSlots = Math.min(6, currentTotalSlots + 1);
          tx.set(
            gymRef,
            {
              mainTeamSlotLimit: nextTotalSlots,
              totalSlots: nextTotalSlots,
              extraSlotsApplied: Math.max(0, nextTotalSlots - 1),
              upgrades: {
                ...(gym.upgrades || {}),
                mainTeamSlotsAdded: Math.max(0, nextTotalSlots - 1),
              },
              updatedAtMs: Date.now(),
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        } else {
          const creditSnap = await tx.get(creditRef);
          const availableCredits = Math.max(0, asInt(creditSnap.data()?.availableCredits, 0));
          tx.set(
            creditRef,
            {
              availableCredits: availableCredits + 1,
              lastCreditFromShopItemAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
        consumeOne();
        return;
      }

      if (effectType === "RESET_IV") {
        const monSnap = await tx.get(targetRef);
        if (!monSnap.exists) throw new HttpsError("not-found", "Pokemon alvo nao encontrado.");
        const mon = monSnap.data() || {};
        if (asInt(mon.speciesId, 0) <= 0) throw new HttpsError("failed-precondition", "Alvo invalido.");
        const speciesId = asInt(mon.speciesId, 1);
        const level = Math.max(1, Math.min(100, asInt(mon.level, 1)));
        const evs = mon.evs && typeof mon.evs === "object" ? mon.evs : { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
        const nextIvs = rollRandomIvs();
        const nextHp = fullHpForSpeciesAtLevel(speciesId, level, nextIvs, evs);
        const hpTotalOld = Math.max(1, Number(mon.hp?.total || 1));
        const hpCurrentOld = Math.max(0, Number(mon.hp?.current || 0));
        const ratio = Math.max(0, Math.min(1, hpCurrentOld / hpTotalOld));
        const hpCurrentNext = Math.max(0, Math.min(nextHp.total, Math.round(ratio * nextHp.total)));
        tx.set(
          targetRef,
          {
            ivs: nextIvs,
            hp: { current: hpCurrentNext, total: nextHp.total },
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        consumeOne();
        return;
      }

      if (effectType === "LEVEL_UP") {
        const monSnap = await tx.get(targetRef);
        if (!monSnap.exists) throw new HttpsError("not-found", "Pokemon alvo nao encontrado.");
        const mon = monSnap.data() || {};
        if (asInt(mon.speciesId, 0) <= 0) throw new HttpsError("failed-precondition", "Alvo invalido.");
        const hpCur = Math.max(0, Number(mon.hp?.current || 0));
        if (hpCur <= 0) throw new HttpsError("failed-precondition", "Pokemon nocauteado nao pode usar Rare Candy.");
        const level = Math.max(1, Math.min(100, asInt(mon.level, 1)));
        const gain = Math.max(1, asInt(itemData.levelGain, 1));
        if (level >= 100) throw new HttpsError("failed-precondition", "Pokemon ja esta no nivel maximo.");
        const nextLevel = Math.min(100, level + gain);
        const speciesId = asInt(mon.speciesId, 1);
        const ivs = mon.ivs && typeof mon.ivs === "object" ? mon.ivs : { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
        const evs = mon.evs && typeof mon.evs === "object" ? mon.evs : { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
        const nextHp = fullHpForSpeciesAtLevel(speciesId, nextLevel, ivs, evs);
        const expToNext = expToNextForSpeciesAtLevel(speciesId, nextLevel);
        tx.set(
          targetRef,
          {
            level: nextLevel,
            ...updatePokemonExpForAdmin(0, expToNext),
            updatedAt: FieldValue.serverTimestamp(),
            hp: { current: nextHp.total, total: nextHp.total },
          },
          { merge: true }
        );
        consumeOne();
        return;
      }

      if (effectType === "UNLOCK_GYM_SCENARIO" || effectType === "UNLOCK_GYM_NPC") {
        const sourceId = norm(itemData?.metadata?.scenarioId || itemData?.metadata?.npcId || itemData?.metadata?.itemId);
        if (!sourceId) throw new HttpsError("failed-precondition", "Item de unlock invalido.");
        const unlockPath = effectType === "UNLOCK_GYM_SCENARIO" ? `players/${uid}/gymScenarioUnlocks/${sourceId}` : `players/${uid}/gymNpcUnlocks/${sourceId}`;
        const unlockRef = db.doc(unlockPath);
        const unlockSnap = await tx.get(unlockRef);
        if (unlockSnap.exists) throw new HttpsError("failed-precondition", "Esse item ja foi ativado.");
        tx.set(unlockRef, { kind: effectType === "UNLOCK_GYM_SCENARIO" ? "scenario" : "npc", itemId: sourceId, activatedByCharacterId: characterId, unlockedAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        consumeOne();
        return;
      }

      consumeOne();
      return;
    }
    if (action === "grant_weekly_vip_incubator") {
      const weeklyAmount = Math.max(0, asInt(request.data?.weeklyAmount, 0));
      if (weeklyAmount <= 0) return;
      const playerRef = db.doc(`players/${uid}`);
      const playerSnap = await tx.get(playerRef);
      const lastGrantAtMs = Math.max(0, Number(playerSnap.data()?.vipWeeklyIncubatorLastGrantAtMs || 0));
      if (lastGrantAtMs > 0 && Date.now() - lastGrantAtMs < 7 * 24 * 60 * 60 * 1000) return;
      await upsertItemWithMeta(tx, db, {
        uid,
        characterId,
        itemId: EGG_INCUBATOR_ITEM_ID,
        delta: weeklyAmount,
        patch: {
          name: "Incubadora",
          description: "Usada para chocar ovos que exigem incubadora.",
          consumable: true,
        },
        itemCapacityLimit: Math.max(1, asInt(request.data?.itemCapacityLimit, 20)),
      });
      tx.set(playerRef, { vipWeeklyIncubatorLastGrantAtMs: Date.now(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return;
    }
    if (action === "grant_starter_bundle") {
      const charRef = db.doc(`players/${uid}/characters/${characterId}`);
      const charSnap = await tx.get(charRef);
      if (!charSnap.exists) throw new HttpsError("not-found", "Personagem nao encontrado.");

      // Idempotencia: evita duplicar bundle caso a chamada repita.
      if (charSnap.data()?.starterBundleGrantedAt) return;
      setStarterBundleDocs(tx, db, uid, characterId);
      return;
    }
    throw new HttpsError("invalid-argument", "Acao de itemMutations invalida.");
  });

  return { ok: true };
}

exports.applyMonetizedCharacterItemGrantTx = applyMonetizedCharacterItemGrantTx;
exports.deliverItemsConfigShopPurchaseTx = deliverItemsConfigShopPurchaseTx;

exports.itemMutations = onCall(REGION, async (request) => handleItemMutationsCore(request));

async function handleTeamMutationsCore(request) {
  const uid = await resolveCallableUid(request);
  const action = norm(request.data?.action);
  const characterId = requireCharacterId(request.data?.characterId);
  const db = getFirestore();

  /** Corpo JSON retornado ao cliente (HTTP + callable). Enriquecido por ações específicas. */
  let teamMutationResponse = { ok: true };

  if (action === "reset_all_pokemon_to_level") {
    const targetLevel = Math.max(1, Math.min(100, asInt(request.data?.level, 25)));
    const base = `players/${uid}/characters/${characterId}`;
    const ops = [];

    for (let s = 1; s <= 6; s++) {
      const ref = db.doc(`${base}/time/slot_${s}`);
      const snap = await ref.get();
      if (!snap.exists) continue;
      const mon = snap.data() || {};
      if (asInt(mon.speciesId, 0) <= 0) continue;
      const speciesId = asInt(mon.speciesId, 1);
      const ivs = mon.ivs && typeof mon.ivs === "object" ? mon.ivs : { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
      const evs = mon.evs && typeof mon.evs === "object" ? mon.evs : { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
      const nextHp = fullHpForSpeciesAtLevel(speciesId, targetLevel, ivs, evs);
      const expTN = expToNextForSpeciesAtLevel(speciesId, targetLevel);
      ops.push({
        ref,
        patch: {
          level: targetLevel,
          ...updatePokemonExpForAdmin(0, expTN),
          hp: { current: nextHp.total, total: nextHp.total },
          updatedAt: FieldValue.serverTimestamp(),
        },
      });
    }

    const boxSnap = await db.collection(`${base}/box`).get();
    for (const doc of boxSnap.docs) {
      const mon = doc.data() || {};
      if (asInt(mon.speciesId, 0) <= 0) continue;
      const speciesId = asInt(mon.speciesId, 1);
      const ivs = mon.ivs && typeof mon.ivs === "object" ? mon.ivs : { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
      const evs = mon.evs && typeof mon.evs === "object" ? mon.evs : { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
      const nextHp = fullHpForSpeciesAtLevel(speciesId, targetLevel, ivs, evs);
      const expTN = expToNextForSpeciesAtLevel(speciesId, targetLevel);
      ops.push({
        ref: doc.ref,
        patch: {
          level: targetLevel,
          ...updatePokemonExpForAdmin(0, expTN),
          hp: { current: nextHp.total, total: nextHp.total },
          updatedAt: FieldValue.serverTimestamp(),
        },
      });
    }

    const BATCH = 400;
    for (let i = 0; i < ops.length; i += BATCH) {
      const batch = db.batch();
      for (const row of ops.slice(i, i + BATCH)) {
        batch.set(row.ref, row.patch, { merge: true });
      }
      await batch.commit();
    }

    return { ok: true, resetAllPokemonToLevel: targetLevel, updatedCount: ops.length };
  }

  await db.runTransaction(async (tx) => {
    if (action === "sync_hp_rows") {
      // Bug 9 (fix): além de HP, aceita `friendshipDelta` por linha. Clampa
      // [0,255] após ler o valor atual do slot. Permite ao client disparar
      // eventos de amizade (care, etc.) de forma server-authoritative, sem
      // precisar de callable próprio para cada evento.
      const rowsRaw = Array.isArray(request.data?.rows) ? request.data.rows : [];
      const rows = rowsRaw
        .map((r) => ({
          slotIndex: Math.max(1, Math.min(6, asInt(r?.slotIndex, 0))),
          hpCurrent: Math.max(0, Number(r?.hpCurrent || 0)),
          friendshipDelta:
            Number.isFinite(Number(r?.friendshipDelta))
              ? Math.max(-255, Math.min(255, Math.trunc(Number(r.friendshipDelta))))
              : 0,
          // Bug 13 (fix): PP persistido entre batalhas PvE.
          movePp: Array.isArray(r?.movePp)
            ? r.movePp
                .map((mv) => ({
                  moveId: String(mv?.moveId || "").trim().toLowerCase(),
                  index:
                    Number.isFinite(Number(mv?.index))
                      ? Math.max(0, Math.min(3, Math.trunc(Number(mv.index))))
                      : 0,
                  pp: Math.max(0, Math.trunc(Number(mv?.pp || 0))),
                  ppMax: Math.max(1, Math.trunc(Number(mv?.ppMax || mv?.pp || 1))),
                }))
                .filter((mv) => mv.moveId)
                .slice(0, 4)
            : null,
        }))
        .filter((r) => r.slotIndex >= 1 && r.slotIndex <= 6);
      const rowBySlot = new Map();
      for (const row of rows) rowBySlot.set(row.slotIndex, row);
      const slotIndices = [...rowBySlot.keys()];
      const slotRefs = slotIndices.map((slotIndex) => ({
        slotIndex,
        ref: db.doc(`players/${uid}/characters/${characterId}/time/slot_${slotIndex}`),
      }));
      const snaps = await Promise.all(slotRefs.map(({ ref }) => tx.get(ref)));
      for (let i = 0; i < slotRefs.length; i++) {
        const snap = snaps[i];
        if (!snap.exists) continue;
        const data = snap.data() || {};
        const hpTotal = Math.max(1, Number(data.hp?.total || 1));
        const row = rowBySlot.get(slotRefs[i].slotIndex);
        const hpCurrent = row?.hpCurrent ?? 0;
        const update = {
          hp: { current: Math.max(0, Math.min(hpTotal, hpCurrent)), total: hpTotal },
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (row && row.friendshipDelta !== 0) {
          const baseFriendship = clampFriendshipCapture(data.friendship);
          update.friendship = Math.max(0, Math.min(255, baseFriendship + row.friendshipDelta));
        }
        if (row && Array.isArray(row.movePp) && row.movePp.length > 0) {
          // Mescla com o movePp existente (se houver), atualizando pp por moveId/index.
          const prevPp = Array.isArray(data.movePp) ? data.movePp : [];
          const byKey = new Map();
          for (const p of prevPp) {
            const id = String(p?.moveId || "").trim().toLowerCase();
            const idx = Number.isFinite(Number(p?.index)) ? Math.max(0, Math.min(3, Math.trunc(Number(p.index)))) : 0;
            if (!id) continue;
            byKey.set(`${id}#${idx}`, {
              moveId: id,
              index: idx,
              pp: Math.max(0, Math.trunc(Number(p?.pp || 0))),
              ppMax: Math.max(1, Math.trunc(Number(p?.ppMax || p?.pp || 1))),
            });
          }
          for (const p of row.movePp) {
            byKey.set(`${p.moveId}#${p.index}`, p);
          }
          update.movePp = [...byKey.values()];
        }
        tx.set(slotRefs[i].ref, update, { merge: true });
      }
      return;
    }

    if (action === "rename_once") {
      const slotIndex = Math.max(1, Math.min(6, asInt(request.data?.slotIndex, 1)));
      const nickname = String(request.data?.nickname || "").trim();
      if (!nickname) throw new HttpsError("invalid-argument", "Nickname invalido.");
      const slotRef = db.doc(`players/${uid}/characters/${characterId}/time/slot_${slotIndex}`);
      const snap = await tx.get(slotRef);
      if (!snap.exists) throw new HttpsError("not-found", "Pokemon nao encontrado.");
      if (snap.data()?.nicknameEdited) throw new HttpsError("failed-precondition", "Pokemon ja teve apelido editado.");
      tx.set(slotRef, { nickname, nicknameEdited: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return;
    }

    if (action === "sync_slot_moves") {
      const slotIndex = Math.max(1, Math.min(6, asInt(request.data?.slotIndex, 1)));
      const slotRef = db.doc(`players/${uid}/characters/${characterId}/time/slot_${slotIndex}`);
      const snap = await tx.get(slotRef);
      if (!snap.exists) throw new HttpsError("not-found", "Pokemon nao encontrado.");
      tx.set(
        slotRef,
        {
          moves: Array.isArray(request.data?.moves) ? request.data.moves.slice(0, 4) : [],
          moveHistory: Array.isArray(request.data?.moveHistory) ? request.data.moveHistory.slice(0, 24) : [],
          relearnableMoves: Array.isArray(request.data?.relearnableMoves) ? request.data.relearnableMoves.slice(0, 64) : [],
          pendingLearnMove: request.data?.pendingLearnMove ?? null,
          pendingLearnMoveQueue: sanitizePendingLearnMoveQueue(request.data?.pendingLearnMoveQueue),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return;
    }

    if (action === "clear_pending_evolution") {
      const slotIndex = Math.max(1, Math.min(6, asInt(request.data?.slotIndex, 1)));
      const slotRef = db.doc(`players/${uid}/characters/${characterId}/time/slot_${slotIndex}`);
      tx.set(slotRef, { pendingEvolution: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return;
    }

    if (action === "move_team_to_box") {
      const slotIndex = Math.max(1, Math.min(6, asInt(request.data?.slotIndex, 1)));
      const slotRefs = Array.from({ length: 6 }, (_, i) =>
        db.doc(`players/${uid}/characters/${characterId}/time/slot_${i + 1}`)
      );
      const snaps = await Promise.all(slotRefs.map((r) => tx.get(r)));
      const occupants = [];
      for (let i = 0; i < 6; i++) {
        if (!snaps[i].exists) continue;
        const d = snaps[i].data() || {};
        if (asInt(d.speciesId, 0) <= 0) continue;
        occupants.push({ fromSlot: i + 1, data: d });
      }
      const remIdx = occupants.findIndex((o) => o.fromSlot === slotIndex);
      if (remIdx < 0) throw new HttpsError("not-found", "Pokemon do slot nao encontrado.");
      if (occupants.length < 2) {
        throw new HttpsError("failed-precondition", "Mantenha ao menos 1 Pokemon no time. Nao e possivel enviar todos para a BOX.");
      }
      const removed = occupants.splice(remIdx, 1)[0];
      occupants.sort((a, b) => a.fromSlot - b.fromSlot);
      const boxRef = db.collection(`players/${uid}/characters/${characterId}/box`).doc();
      setPokemonDoc(tx, boxRef, removed.data, {});
      for (let j = 0; j < 6; j++) {
        const ref = slotRefs[j];
        if (j < occupants.length) {
          setPokemonDoc(tx, ref, occupants[j].data, { slotIndex: j + 1 });
        } else if (snaps[j].exists) {
          tx.delete(ref);
        }
      }
      return;
    }

    if (action === "swap_team_slots") {
      const fromSlot = Math.max(1, Math.min(6, asInt(request.data?.fromSlotIndex, 1)));
      const toSlot = Math.max(1, Math.min(6, asInt(request.data?.toSlotIndex, 1)));
      if (fromSlot === toSlot) return;

      const fromRef = db.doc(`players/${uid}/characters/${characterId}/time/slot_${fromSlot}`);
      const toRef = db.doc(`players/${uid}/characters/${characterId}/time/slot_${toSlot}`);
      const [fromSnap, toSnap] = await Promise.all([tx.get(fromRef), tx.get(toRef)]);
      const fromMon = fromSnap.exists ? (fromSnap.data() || {}) : null;
      const toMon = toSnap.exists ? (toSnap.data() || {}) : null;
      const hasFrom = asInt(fromMon?.speciesId, 0) > 0;
      const hasTo = asInt(toMon?.speciesId, 0) > 0;

      if (!hasFrom && !hasTo) {
        throw new HttpsError("failed-precondition", "Nao ha Pokemon para trocar entre esses slots.");
      }

      if (hasFrom && hasTo) {
        setPokemonDoc(tx, fromRef, toMon, { slotIndex: fromSlot });
        setPokemonDoc(tx, toRef, fromMon, { slotIndex: toSlot });
        return;
      }

      if (hasFrom) {
        setPokemonDoc(tx, toRef, fromMon, { slotIndex: toSlot });
        tx.delete(fromRef);
        return;
      }

      setPokemonDoc(tx, fromRef, toMon, { slotIndex: fromSlot });
      tx.delete(toRef);
      return;
    }

    if (action === "move_box_to_team") {
      const slotIndex = Math.max(1, Math.min(6, asInt(request.data?.slotIndex, 1)));
      const boxDocId = String(request.data?.boxDocId || "").trim();
      if (!boxDocId) throw new HttpsError("invalid-argument", "boxDocId obrigatorio.");
      const slotRef = db.doc(`players/${uid}/characters/${characterId}/time/slot_${slotIndex}`);
      const boxRef = db.doc(`players/${uid}/characters/${characterId}/box/${boxDocId}`);
      const [slotSnap, boxSnap] = await Promise.all([tx.get(slotRef), tx.get(boxRef)]);
      if (!boxSnap.exists) throw new HttpsError("not-found", "Pokemon da BOX nao encontrado.");
      const fromBox = boxSnap.data() || {};
      if (asInt(fromBox.speciesId, 0) <= 0) throw new HttpsError("failed-precondition", "Pokemon invalido na BOX.");
      if (slotSnap.exists && asInt(slotSnap.data()?.speciesId, 0) > 0) throw new HttpsError("failed-precondition", "Slot do time ocupado.");
      setPokemonDoc(tx, slotRef, fromBox, { slotIndex });
      tx.delete(boxRef);
      return;
    }

    if (action === "swap_team_with_box") {
      const slotIndex = Math.max(1, Math.min(6, asInt(request.data?.slotIndex, 1)));
      const boxDocId = String(request.data?.boxDocId || "").trim();
      if (!boxDocId) throw new HttpsError("invalid-argument", "boxDocId obrigatorio.");
      const slotRef = db.doc(`players/${uid}/characters/${characterId}/time/slot_${slotIndex}`);
      const boxRef = db.doc(`players/${uid}/characters/${characterId}/box/${boxDocId}`);
      const [slotSnap, boxSnap] = await Promise.all([tx.get(slotRef), tx.get(boxRef)]);
      if (!slotSnap.exists || !boxSnap.exists) throw new HttpsError("not-found", "Pokemon nao encontrado.");
      const teamMon = slotSnap.data() || {};
      const boxMon = boxSnap.data() || {};
      if (asInt(teamMon.speciesId, 0) <= 0 || asInt(boxMon.speciesId, 0) <= 0) {
        throw new HttpsError("failed-precondition", "Nao foi possivel trocar com slot vazio.");
      }
      setPokemonDoc(tx, slotRef, boxMon, { slotIndex });
      setPokemonDoc(tx, boxRef, teamMon, {});
      return;
    }
    if (action === "relearn_move" || action === "teach_move") {
      const slotIndex = Math.max(1, Math.min(6, asInt(request.data?.slotIndex, 1)));
      const moveId = norm(request.data?.moveId);
      const forgetMoveIndex = request.data?.forgetMoveIndex ?? null;
      if (!moveId) throw new HttpsError("invalid-argument", "moveId obrigatorio.");
      const slotRef = db.doc(`players/${uid}/characters/${characterId}/time/slot_${slotIndex}`);
      const slotSnap = await tx.get(slotRef);
      if (!slotSnap.exists) throw new HttpsError("not-found", "Pokemon alvo nao encontrado.");
      const mon = slotSnap.data() || {};
      const relearnable = Array.isArray(mon.relearnableMoves) ? mon.relearnableMoves.map((m) => norm(m)) : [];
      const moveHistory = Array.isArray(mon.moveHistory) ? mon.moveHistory.map((m) => norm(m)) : [];
      if (action === "relearn_move" && !relearnable.includes(moveId) && !moveHistory.includes(moveId)) {
        throw new HttpsError("failed-precondition", "Esse golpe nao esta disponivel para reaprendizado.");
      }
      const payment = norm(request.data?.payment || "coins");
      if (action === "teach_move" && payment === "heart-scale") {
        await upsertItemWithMeta(tx, db, { uid, characterId, itemId: "heart-scale", delta: -1 });
      }
      if (payment === "coins") {
        const price = Math.max(0, asInt(request.data?.coinPrice, 0));
        if (price > 0) {
          const charRef = db.doc(`players/${uid}/characters/${characterId}`);
          const charSnap = await tx.get(charRef);
          const coins = Math.max(0, asInt(charSnap.data()?.pokeCoins, 0));
          if (coins < price) throw new HttpsError("failed-precondition", `Moedas insuficientes. Necessario: ${price}.`);
          tx.set(charRef, { pokeCoins: coins - price, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        }
      }
      const nextMoves = applyMoveDecision(mon.moves || [], moveId, forgetMoveIndex);
      const nextHistory = Array.from(new Set([...(moveHistory || []), ...nextMoves])).slice(0, 24);
      tx.set(slotRef, {
        moves: nextMoves,
        moveHistory: nextHistory,
        relearnableMoves: Array.from(new Set([...(relearnable || []), ...nextHistory])).slice(0, 64),
        pendingLearnMove: null,
        pendingLearnMoveQueue: [],
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return;
    }
    if (action === "capture_pokemon") {
      const encounter = request.data?.encounter || {};
      const ballId = norm(request.data?.ballId);
      const encounterId = String(request.data?.encounterId || "").trim();
      if (!ballId || !encounterId) throw new HttpsError("invalid-argument", "ballId e encounterId obrigatorios.");
      const claimRef = db.doc(`players/${uid}/characters/${characterId}/captureClaims/${encounterId}`);
      const claimSnap = await tx.get(claimRef);
      if (claimSnap.exists) {
        const prev = claimSnap.data() || {};
        const prevSuccess = !!prev.success;
        const prevChosen = prev.chosenSlot != null && prev.chosenSlot !== undefined ? prev.chosenSlot : null;
        const sidEarly = Math.max(1, asInt(encounter.speciesId, 1));
        const lvEarly = Math.max(1, asInt(encounter.level, 1));
        teamMutationResponse = {
          ok: true,
          capture: {
            outcome: prevSuccess ? "captured" : "failed",
            captured: prevSuccess,
            speciesId: sidEarly,
            speciesName: String(encounter.speciesName || `#${sidEarly}`),
            level: lvEarly,
            storage: prevSuccess ? (prevChosen ? "team" : "box") : "none",
            chosenSlot: prevSuccess ? prevChosen : null,
            encounterId,
          },
        };
        return;
      }
      const ballRef = db.doc(`players/${uid}/characters/${characterId}/pokeballs/${ballId}`);
      const ballMetaRef = db.doc(`players/${uid}/characters/${characterId}/pokeballs/_meta`);
      const [ballSnap, ballMetaSnap] = await Promise.all([tx.get(ballRef), tx.get(ballMetaRef)]);
      if (!ballSnap.exists) throw new HttpsError("not-found", "Pokebola nao encontrada.");
      const ball = ballSnap.data() || {};
      const qty = Math.max(0, asInt(ball.quantity, 0));
      if (qty <= 0) throw new HttpsError("failed-precondition", "Quantidade insuficiente.");
      const speciesIdCaptured = Math.max(1, asInt(encounter.speciesId, 1));
      const levelCaptured = Math.max(1, asInt(encounter.level, 1));
      const zeroStats = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
      const canonicalHp = fullHpForSpeciesAtLevel(speciesIdCaptured, levelCaptured, zeroStats, zeroStats);
      const hpTotalCanonical = Math.max(1, asInt(canonicalHp.total, 1));
      const clientTotal = asInt(encounter.hpTotal, 0);
      const clientCurrent = asInt(encounter.hpCurrent, -1);
      let hpCurrentFinal;
      if (clientTotal > 0 && clientCurrent >= 0) {
        const frac = Math.max(0, Math.min(1, clientCurrent / clientTotal));
        hpCurrentFinal = Math.max(0, Math.min(hpTotalCanonical, Math.round(frac * hpTotalCanonical)));
      } else {
        hpCurrentFinal = hpTotalCanonical;
      }
      const chance = calcCaptureChance(
        { ...encounter, hpTotal: hpTotalCanonical, hpCurrent: hpCurrentFinal },
        Number(ball.captureBonus || 1),
        !!ball.isMasterBall
      );
      const success = deterministicRand(`${encounterId}:${ballId}`) < chance;
      /**
       * Firestore: todas as leituras antes de qualquer escrita na transacao.
       * (Leitura dos slots do time apos decrementar a pokebola gerava:
       * "Firestore transactions require all reads to be executed before all writes.")
       */
      const slotRefs = [];
      for (let slot = 1; slot <= 6; slot++) {
        slotRefs.push(db.doc(`players/${uid}/characters/${characterId}/time/slot_${slot}`));
      }
      const slotSnaps = await Promise.all(slotRefs.map((ref) => tx.get(ref)));
      let chosenSlot = null;
      if (success) {
        for (let i = 0; i < slotSnaps.length; i++) {
          const s = slotSnaps[i];
          if (!s.exists || asInt(s.data()?.speciesId, 0) <= 0) {
            chosenSlot = i + 1;
            break;
          }
        }
        if (hpCurrentFinal < 1) hpCurrentFinal = Math.min(1, hpTotalCanonical);
      }

      const nextQty = qty - 1;
      const totalBalls = Math.max(0, asInt(ballMetaSnap.data()?.totalQuantity, 0));
      if (nextQty <= 0) tx.delete(ballRef);
      else tx.set(ballRef, { quantity: nextQty, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      tx.set(ballMetaRef, { totalQuantity: Math.max(0, totalBalls - 1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      if (success) {
        const ivsCaptured = readIvBlockCapture(encounter.ivs);
        const evsCaptured = readEvBlockCapture(encounter.evs);
        const statsCaptured = readBattleStatsCapture(encounter.stats);
        const capExpTn = expToNextForSpeciesAtLevel(speciesIdCaptured, levelCaptured);
        const payload = {
          stableInstanceId: randomUUID(),
          speciesId: speciesIdCaptured,
          speciesName: String(encounter.speciesName || `#${encounter.speciesId}`),
          nickname: String(encounter.speciesName || `#${encounter.speciesId}`),
          level: levelCaptured,
          gender: sanitizeCaptureGender(encounter.gender),
          nature: sanitizeNatureCapture(encounter.nature),
          abilityId: sanitizeAbilityIdCapture(encounter.abilityId),
          friendship: clampFriendshipCapture(encounter.friendship),
          ivs: ivsCaptured,
          evs: evsCaptured,
          ...(statsCaptured ? { stats: statsCaptured } : {}),
          hp: { current: hpCurrentFinal, total: hpTotalCanonical },
          ...updatePokemonExpForAdmin(0, capExpTn),
          moves: Array.isArray(encounter.moves) ? encounter.moves.slice(0, 4) : [],
          moveHistory: Array.isArray(encounter.moves) ? encounter.moves.slice(0, 4) : [],
          relearnableMoves: [],
          pendingLearnMove: null,
          isShiny: !!encounter.isShiny,
          updatedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
          capturedAt: FieldValue.serverTimestamp(),
        };
        if (chosenSlot) {
          tx.set(db.doc(`players/${uid}/characters/${characterId}/time/slot_${chosenSlot}`), {
            ...payload,
            slotIndex: chosenSlot,
            updatedAt: FieldValue.serverTimestamp(),
          });
        } else {
          tx.set(db.collection(`players/${uid}/characters/${characterId}/box`).doc(), {
            ...payload,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      }
      tx.set(claimRef, { encounterId, ballId, success, chosenSlot, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      teamMutationResponse = {
        ok: true,
        capture: {
          outcome: success ? "captured" : "failed",
          captured: !!success,
          speciesId: speciesIdCaptured,
          speciesName: String(encounter.speciesName || `#${speciesIdCaptured}`),
          level: levelCaptured,
          storage: success ? (chosenSlot ? "team" : "box") : "none",
          chosenSlot: success ? chosenSlot : null,
          encounterId,
        },
      };
      return;
    }
    if (action === "normalize_legacy_team") {
      const docs = Array.isArray(request.data?.docs) ? request.data.docs : [];
      for (const row of docs) {
        const docId = String(row?.id || "").trim();
        const data = row?.data || null;
        if (!docId || !data || !docId.startsWith("slot_")) continue;
        const slotIndex = Math.max(1, Math.min(6, asInt(data.slotIndex, asInt(docId.split("_")[1], 1))));
        tx.set(db.doc(`players/${uid}/characters/${characterId}/time/${docId}`), {
          ...data,
          slotIndex,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      return;
    }

    throw new HttpsError("invalid-argument", "Acao de teamMutations invalida.");
  });
  return teamMutationResponse;
}

exports.teamMutations = onCall(REGION, async (request) => handleTeamMutationsCore(request));

/**
 * Corpo JSON sem idToken (evita duplicar credencial; auth vem do Bearer).
 */
/**
 * Corpo JSON em `onRequest` v2: às vezes vem como string ou Buffer (não objeto).
 * Sem isso, `request.data` fica vazio → "Acao de teamMutations invalida" ou falhas opacas.
 */
function bodyWithoutIdToken(req) {
  let raw = req.body;
  if (Buffer.isBuffer(raw)) {
    try {
      raw = JSON.parse(raw.toString("utf8"));
    } catch {
      raw = {};
    }
  } else if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) raw = {};
    else {
      try {
        raw = JSON.parse(t);
      } catch {
        raw = {};
      }
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) raw = {};
  const body = { ...raw };
  delete body.idToken;
  return body;
}

async function uidAndDecodedFromHttpBearer(req) {
  const authHeader = req.get("authorization") || req.get("Authorization") || "";
  const match = typeof authHeader === "string" ? authHeader.match(/^Bearer (.*)$/i) : null;
  const idToken = match ? String(match[1] || "").trim() : "";
  if (!idToken) throw new HttpsError("unauthenticated", "Token ausente.");
  try {
    const decoded = await getAuth().verifyIdToken(idToken);
    const uid = String(decoded?.uid || "").trim();
    if (!uid) throw new HttpsError("unauthenticated", "Token invalido.");
    return { uid, decoded };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.warn("verifyIdToken (HTTP phase2) falhou", { message: String(err?.message || err) });
    throw new HttpsError("unauthenticated", "Token invalido.");
  }
}

function callableLikeRequest(req, decoded) {
  const data = bodyWithoutIdToken(req);
  return {
    auth: { uid: decoded.uid, token: decoded },
    data,
    rawRequest: req,
  };
}

exports.itemMutationsHttp = onRequest({ ...REGION, cors: true }, async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    const { decoded } = await uidAndDecodedFromHttpBearer(req);
    const out = await handleItemMutationsCore(callableLikeRequest(req, decoded));
    res.status(200).json(out && typeof out === "object" ? out : { ok: true });
  } catch (e) {
    if (e instanceof HttpsError) {
      const status = e.httpErrorCode?.status ?? 500;
      res.status(status).json({ error: e.message, code: e.code });
      return;
    }
    logger.error("itemMutationsHttp", e);
    res.status(500).json({ error: e?.message || "Erro em itemMutationsHttp." });
  }
});

exports.teamMutationsHttp = onRequest({ ...REGION, cors: true }, async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    const { decoded } = await uidAndDecodedFromHttpBearer(req);
    const mutationResult = await handleTeamMutationsCore(callableLikeRequest(req, decoded));
    res.status(200).json(mutationResult && typeof mutationResult === "object" ? mutationResult : { ok: true });
  } catch (e) {
    if (e instanceof HttpsError) {
      const status = e.httpErrorCode?.status ?? 500;
      res.status(status).json({ error: e.message, code: e.code });
      return;
    }
    logger.error("teamMutationsHttp", e);
    res.status(500).json({ error: e?.message || "Erro em teamMutationsHttp." });
  }
});

/**
 * Inicialização de personagem novo (time slot 1 + itens + PokeCoins).
 * Idempotente via serverBootstrapCompleted.
 */
async function applyCharacterBootstrapInTransaction(tx, db, uid, characterId, starter) {
  const charRef = db.doc(`players/${uid}/characters/${characterId}`);
  const slotRef = db.doc(`players/${uid}/characters/${characterId}/time/slot_1`);
  const charSnap = await tx.get(charRef);
  if (!charSnap.exists) throw new HttpsError("not-found", "Personagem nao encontrado.");
  const charData = charSnap.data() || {};
  const bootstrapDone = charData.serverBootstrapCompleted === true;
  const slotSnap = await tx.get(slotRef);
  const slotOk = slotSnap.exists && asInt(slotSnap.data()?.speciesId, 0) > 0;
  /** Bootstrap completo e slot 1 valido: nada a fazer. */
  if (bootstrapDone && slotOk) return;

  if (!slotOk) {
    const level = Math.max(1, asInt(starter.level, 5));
    const computedHp = starterFullHpFromSpeciesId(starter.speciesId, level, starter.ivs, starter.evs);
    const hpTotal = computedHp.total;
    const rawTotal = Number(starter.hp?.total);
    const rawCurrent = Number(starter.hp?.current);
    const legacyPristine = rawTotal === 22 && rawCurrent === 18;
    let hp = computedHp;
    if (Number.isFinite(rawTotal) && rawTotal > 0 && Number.isFinite(rawCurrent)) {
      const total = Math.max(1, Math.trunc(rawTotal));
      const cur = Math.max(0, Math.min(total, Math.trunc(rawCurrent)));
      if (legacyPristine) {
        hp = { current: hpTotal, total: hpTotal };
      } else if (total === 22 && hpTotal > 22) {
        /**
         * Slot 1 do bootstrap: total 22 e quase sempre placeholder do cap antigo, nao HP real.
         * Escalar (cur/22)*hpTotal gerava starter "meio vida" quando cur vinha errado (ex.: 11/22).
         * Aqui so gravamos o inicial; dano real e tratado depois no jogo.
         */
        hp = { current: hpTotal, total: hpTotal };
      } else {
        hp = { current: cur <= 0 ? 0 : Math.max(1, Math.min(hpTotal, cur)), total: hpTotal };
      }
    }
    const sid0 = asInt(starter.speciesId, 1);
    const expRaw = Math.max(0, Math.trunc(Number((starter.exp && starter.exp.current) || 0)));
    const expCurrent0 = normalizeExpBarCurrentForSpeciesLevel(sid0, level, expRaw);
    const expToNext0 = expToNextForSpeciesAtLevel(sid0, level);
    tx.set(slotRef, {
      stableInstanceId: randomUUID(),
      slotIndex: 1,
      speciesId: sid0,
      speciesName: String(starter.speciesName || `#${starter.speciesId}`),
      nickname: String(starter.nickname || starter.speciesName || "").trim() || String(starter.speciesName || ""),
      level,
      nature: String(starter.nature || "Docile"),
      gender: String(starter.gender || "M"),
      abilityId: String(starter.abilityId || ""),
      ...updatePokemonExpForAdmin(expCurrent0, expToNext0),
      hp,
      ivs: starter.ivs || { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      evs: starter.evs || { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      moves: Array.isArray(starter.moves) ? starter.moves.slice(0, 4) : [],
      moveHistory: Array.isArray(starter.moveHistory) ? starter.moveHistory.slice(0, 12) : [],
      relearnableMoves: [],
      pendingLearnMove: null,
      isShiny: !!starter.isShiny,
      isStarter: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  /** Bundle inicial so na primeira conclusao de bootstrap (evita increment duplo). */
  if (!bootstrapDone) {
    setStarterBundleDocs(tx, db, uid, characterId);
  }
}

exports.characterBootstrap = onCall(REGION, async (request) => {
  const uid = await resolveCallableUid(request);
  const characterId = requireCharacterId(request.data?.characterId);
  const starter = request.data?.starter || null;
  if (!starter || asInt(starter.speciesId, 0) <= 0) {
    throw new HttpsError("invalid-argument", "Starter invalido.");
  }
  const db = getFirestore();

  await db.runTransaction(async (tx) => {
    await applyCharacterBootstrapInTransaction(tx, db, uid, characterId, starter);
  });

  return { ok: true };
});

/**
 * Mesma logica de `characterBootstrap` (callable), exposta como HTTPS `onRequest` + Bearer.
 * O protocolo callable (onCall) em alguns clientes Expo/RN falha na borda com 401 antes do Node;
 * este endpoint segue o mesmo padrao de `registerBiomeCapture` (verifyIdToken no handler).
 */
exports.characterBootstrapHttp = onRequest({ ...REGION, cors: true }, async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    const authHeader = req.get("authorization") || req.get("Authorization") || "";
    const match = typeof authHeader === "string" ? authHeader.match(/^Bearer (.*)$/i) : null;
    const idToken = match ? String(match[1] || "").trim() : "";
    if (!idToken) {
      res.status(401).json({ error: "Token ausente." });
      return;
    }
    let uid;
    try {
      const decoded = await getAuth().verifyIdToken(idToken);
      uid = String(decoded?.uid || "").trim();
    } catch (err) {
      logger.warn("characterBootstrapHttp verifyIdToken falhou", { message: String(err?.message || err) });
      res.status(401).json({ error: "Token invalido." });
      return;
    }
    if (!uid) {
      res.status(401).json({ error: "Token invalido." });
      return;
    }
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const characterId = requireCharacterId(body.characterId);
    const starter = body.starter || null;
    if (!starter || asInt(starter.speciesId, 0) <= 0) {
      res.status(400).json({ error: "Starter invalido." });
      return;
    }
    const db = getFirestore();
    await db.runTransaction(async (tx) => {
      await applyCharacterBootstrapInTransaction(tx, db, uid, characterId, starter);
    });
    res.status(200).json({ ok: true });
  } catch (e) {
    if (e instanceof HttpsError) {
      const status = e.httpErrorCode?.status ?? 500;
      res.status(status).json({ error: e.message, code: e.code });
      return;
    }
    logger.error("characterBootstrapHttp", e);
    res.status(500).json({ error: e?.message || "Erro no bootstrap." });
  }
});

/** Não depende do callable (auth no app RN): roda no servidor ao criar o documento do personagem. */
exports.onCharacterCreatedBootstrap = onDocumentCreated(
  {
    document: "players/{uid}/characters/{characterId}",
    ...REGION,
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const { uid, characterId } = event.params;
    const db = getFirestore();
    const data = snap.data() || {};
    if (data.serverBootstrapCompleted === true) return;
    const sp = data.starterPokemon;
    if (!sp || asInt(sp.speciesId, 0) <= 0) {
      logger.warn("onCharacterCreatedBootstrap: starterPokemon invalido", { uid, characterId });
      return;
    }
    const shinyRoll = deterministicRand(`${uid}:${characterId}`);
    const starterHp = starterFullHpFromSpeciesId(asInt(sp.speciesId, 0), 5, { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });
    const starter = {
      speciesId: asInt(sp.speciesId, 0),
      speciesName: String(sp.speciesName || `#${sp.speciesId}`),
      nickname: String(sp.nickname || sp.speciesName || "").trim() || String(sp.speciesName || ""),
      level: 5,
      nature: String(sp.nature || "Docile"),
      gender: String(sp.gender || "M"),
      abilityId: String(sp.abilityId || ""),
      exp: { current: 0, toNext: expToNextForSpeciesAtLevel(asInt(sp.speciesId, 0), 5) },
      hp: starterHp,
      ivs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      moves: [],
      moveHistory: [],
      isShiny: shinyRoll < 0.001,
      isStarter: true,
    };
    try {
      await db.runTransaction(async (tx) => {
        await applyCharacterBootstrapInTransaction(tx, db, uid, characterId, starter);
      });
    } catch (e) {
      logger.error("onCharacterCreatedBootstrap falhou", { uid, characterId, err: e });
      throw e;
    }
  }
);

/**
 * Export explícito da função interna de liquidação do Coliseu para que o
 * trigger `coliseuAutoSettleOnFinish` (em `coliseuPvpStart.js`) possa
 * invocá-la diretamente após `battleRooms.status` transitar para `finished`.
 * A função é idempotente (`coliseuPvpCurrencySettled`), então múltiplas
 * execuções são seguras.
 */
exports.executeSettleColiseuPvp = executeSettleColiseuPvp;
