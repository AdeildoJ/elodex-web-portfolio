/**
 * Mutacoes GYM que antes gravavam productEntitlements no cliente.
 * Executadas com Admin SDK via itemMutationsHttp (Bearer).
 */
const path = require("node:path");
const fs = require("node:fs");
const { FieldValue } = require("firebase-admin/firestore");
const { HttpsError } = require("firebase-functions/v2/https");
const { expToNextForSpeciesAtLevel, normalizeExpBarCurrentForSpeciesLevel } = require("./experienceExp");
const { updatePokemonExpForAdmin } = require("./expWriteCanonical");

function toLower(v) {
  return String(v || "")
    .trim()
    .toLowerCase();
}

function toNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function biomeAllowsGym(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  const acceptsGym = typeof data.acceptsGym === "boolean" ? data.acceptsGym : null;
  const gymEnabled = typeof data.gymEnabled === "boolean" ? data.gymEnabled : null;
  if (acceptsGym === true || gymEnabled === true) return true;
  if (acceptsGym === false || gymEnabled === false) return false;
  return false;
}

function isEntitlementActive(entitlement) {
  if (!entitlement || toLower(entitlement.status) !== "active") return false;
  let validUntilMs = toNumber(entitlement.validUntilMs, 0);
  const vu = entitlement.validUntil;
  if ((!Number.isFinite(validUntilMs) || validUntilMs <= 0) && vu && typeof vu.toMillis === "function") {
    validUntilMs = vu.toMillis();
  }
  return validUntilMs <= 0 || validUntilMs >= Date.now();
}

function resolveGymTicketConfiguration(entitlement) {
  if (!entitlement) return null;
  const productType = toLower(entitlement.productType);
  const metadata = entitlement.benefits && typeof entitlement.benefits === "object" ? entitlement.benefits.metadata || {} : {};
  const ticketSubtype = toLower(metadata.ticketSubtype || metadata.ticketType);
  if (productType !== "gym_ticket" && !(productType === "ticket" && ticketSubtype === "gym")) {
    return null;
  }
  const gymMode = toLower(metadata.gymTicketMode) === "temporary" ? "temporary" : "permanent";
  const gymDurationDays = gymMode === "temporary" ? Math.max(1, Math.floor(toNumber(metadata.gymDurationDays, 1))) : null;
  return { gymMode, gymDurationDays };
}

function normalizeBadgeRecord(id, raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  const badgeId = String(data.badgeId || id || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const bonusTypeRaw = String(data.bonusType || "shiny")
    .trim()
    .toLowerCase();
  return {
    id: badgeId,
    badgeId,
    name: String(data.name || badgeId || "").trim(),
    imageUrl: String(data.imageUrl || "").trim(),
    description: String(data.description || "").trim(),
    bonusType: bonusTypeRaw,
    bonusValue: Math.max(0, Number(data.bonusValue || 0)),
    isActive: data.isActive === false ? false : true,
  };
}

function normalizeGymScenarioRecord(id, raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  const docId = String(id || "")
    .trim()
    .toLowerCase();
  const fromField = String(data.scenarioId || "").trim().toLowerCase();
  const resolvedId = (fromField || docId).toLowerCase();
  const processedDay = String(data.processedImageDay || data.processedImageUrl || data.imageDay || data.imageUrl || "").trim();
  const processedNight = String(data.processedImageNight || data.processedImageUrl || data.imageNight || data.imageUrl || "").trim();
  return {
    id: resolvedId || docId,
    name: String(data.name || id || "").trim(),
    imageDay: String(data.imageDay || data.imageUrl || "").trim(),
    imageNight: String(data.imageNight || data.imageUrl || "").trim(),
    processedImageDay: processedDay,
    processedImageNight: processedNight,
    isActive: data.isActive === false ? false : true,
    isCommercialized: Boolean(data.isCommercialized),
    isPaid: Boolean(data.isPaid ?? data.isCommercialized),
    priceEcoin:
      typeof data.priceEcoin === "number" && Number.isFinite(data.priceEcoin)
        ? data.priceEcoin
        : typeof data.ecoinPrice === "number" && Number.isFinite(data.ecoinPrice)
          ? data.ecoinPrice
          : null,
    weather: String(data.weather || data.climateType || "clear")
      .trim()
      .toLowerCase(),
    gymType: String(data.gymType || data.gymElementType || "")
      .trim()
      .toLowerCase() || null,
  };
}

let speciesListCache = null;
function speciesList() {
  if (speciesListCache) return speciesListCache;
  try {
    const p = path.join(__dirname, "../../elodex-mobile/src/data/pokemon/pokemonSpecies.json");
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    speciesListCache = Array.isArray(raw) ? raw : Object.values(raw);
  } catch {
    speciesListCache = [];
  }
  return speciesListCache;
}

function getSpeciesEntry(speciesId) {
  const sid = Math.max(1, Number(speciesId) || 1);
  return speciesList().find((row) => Number(row?.id ?? row?.speciesId) === sid) || null;
}

function getSpeciesTypes(speciesId, mon) {
  if (mon && Array.isArray(mon.pokemonTypes) && mon.pokemonTypes.length) {
    return mon.pokemonTypes.map((value) => toLower(value)).filter(Boolean);
  }
  const entry = getSpeciesEntry(speciesId);
  const types = Array.isArray(entry?.types) ? entry.types : [];
  return types.map((value) => toLower(value)).filter(Boolean);
}

function buildInitialGymState() {
  return {
    storageLimit: 50,
    mainTeamSlotLimit: 1,
    badgeCount: 0,
    activeNpcs: {
      nurse: true,
      police: false,
      additionalNpcCount: 0,
    },
  };
}

function buildRosterEntryId(sourceCollection, sourceDocId) {
  return `${String(sourceCollection || "").trim()}_${String(sourceDocId || "").trim()}`;
}

function newStableInstanceId() {
  try {
    const { randomUUID } = require("node:crypto");
    return randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

function ensureStableInstanceIdFromMon(mon) {
  const existing = String(mon?.stableInstanceId ?? "").trim();
  if (existing.length >= 16) return existing;
  return newStableInstanceId();
}

async function executeApplyGymUpgradeEntitlement(db, uid, characterId, data) {
  const entitlementId = String(data?.entitlementId || "").trim();
  if (!entitlementId) throw new HttpsError("invalid-argument", "entitlementId obrigatorio.");
  await db.runTransaction(async (tx) => {
    const gymRef = db.doc(`gyms/${uid}`);
    const entitlementRef = db.doc(`players/${uid}/productEntitlements/${entitlementId}`);
    const [gymSnap, entitlementSnap] = await Promise.all([tx.get(gymRef), tx.get(entitlementRef)]);
    if (!gymSnap.exists) throw new HttpsError("failed-precondition", "Crie um GYM antes de aplicar upgrades.");
    if (!entitlementSnap.exists) throw new HttpsError("not-found", "Upgrade nao encontrado.");
    const freshEntitlement = { id: entitlementId, ...(entitlementSnap.data() || {}) };
    if (!isEntitlementActive(freshEntitlement)) throw new HttpsError("failed-precondition", "Upgrade inativo ou expirado.");
    if (freshEntitlement.claimedAt) throw new HttpsError("failed-precondition", "Esse upgrade ja foi aplicado.");

    const gym = gymSnap.data() || {};
    const productType = toLower(freshEntitlement.productType);
    const metadata = freshEntitlement.benefits && typeof freshEntitlement.benefits === "object" ? freshEntitlement.benefits.metadata || {} : {};
    const isGymSlot =
      productType === "gym_main_team_slot" || (productType === "slot" && toLower(metadata.slotScope) === "gym");
    if (!isGymSlot) throw new HttpsError("failed-precondition", "Esse produto nao e um upgrade de GYM aplicavel.");

    const add = Math.max(
      1,
      toNumber(freshEntitlement.benefits?.gymDefenseSlotsAdded || freshEntitlement.benefits?.gymMainTeamSlots || metadata.slotsAdded, 1)
    );
    const currentTotalSlots = Math.max(1, Math.min(6, toNumber(gym.totalSlots || gym.mainTeamSlotLimit, 1)));
    const nextTotalSlots = Math.min(6, currentTotalSlots + add);
    const nextPatch = {
      mainTeamSlotLimit: nextTotalSlots,
      totalSlots: nextTotalSlots,
      extraSlotsApplied: Math.max(0, nextTotalSlots - 1),
      upgrades: {
        ...(gym.upgrades || {}),
        mainTeamSlotsAdded: Math.max(0, nextTotalSlots - 1),
      },
      updatedAtMs: Date.now(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    tx.set(gymRef, nextPatch, { merge: true });
    tx.set(
      entitlementRef,
      { claimedAt: FieldValue.serverTimestamp(), claimedByCharacterId: characterId, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
  });
  return {};
}

async function executeRenewGymWithEntitlement(db, uid, characterId, data) {
  const entitlementId = String(data?.entitlementId || "").trim();
  if (!entitlementId) throw new HttpsError("invalid-argument", "entitlementId obrigatorio.");
  await db.runTransaction(async (tx) => {
    const gymRef = db.doc(`gyms/${uid}`);
    const entitlementRef = db.doc(`players/${uid}/productEntitlements/${entitlementId}`);
    const [gymSnap, entitlementSnap] = await Promise.all([tx.get(gymRef), tx.get(entitlementRef)]);
    if (!gymSnap.exists) throw new HttpsError("not-found", "GYM nao encontrado.");
    if (!entitlementSnap.exists) throw new HttpsError("not-found", "Ticket GYM nao encontrado.");
    const gym = gymSnap.data() || {};
    if (toLower(gym.status) === "removed") throw new HttpsError("failed-precondition", "GYM removido.");
    const freshEntitlement = { id: entitlementId, ...(entitlementSnap.data() || {}) };
    const freshTicket = resolveGymTicketConfiguration(freshEntitlement);
    if (!freshTicket || freshTicket.gymMode !== "temporary" || !freshTicket.gymDurationDays) {
      throw new HttpsError("failed-precondition", "Ticket de renovacao invalido.");
    }
    if (!isEntitlementActive(freshEntitlement)) throw new HttpsError("failed-precondition", "Ticket GYM inativo ou expirado.");
    if (freshEntitlement.claimedAt) throw new HttpsError("failed-precondition", "Esse ticket ja foi utilizado.");
    const expiresAtMs = Date.now() + freshTicket.gymDurationDays * 24 * 60 * 60 * 1000;
    tx.set(
      gymRef,
      {
        ticketMode: "temporary",
        expiresAtMs,
        blockedAtMs: null,
        status: "active",
        active: true,
        updatedAtMs: Date.now(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    tx.set(
      entitlementRef,
      { claimedAt: FieldValue.serverTimestamp(), claimedByCharacterId: characterId, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
  });
  return {};
}

async function executeCreateGymWithTicket(db, uid, characterId, data) {
  const biomeId = toLower(data?.biomeId);
  const gymName = String(data?.gymName || "").trim();
  const gymType = toLower(data?.gymType);
  const scenarioThemeId = toLower(data?.scenarioThemeId);
  const primaryBadgeId = toLower(data?.primaryBadgeId);
  const creationEntitlementId = String(data?.creationEntitlementId || "").trim();
  const initialMainTeam = Array.isArray(data?.initialMainTeam) ? data.initialMainTeam : [];
  const linkedNpcId = String(data?.linkedNpcId || "")
    .trim()
    .toLowerCase();
  const characterName = String(data?.characterName || "").trim() || null;

  if (!biomeId) throw new HttpsError("invalid-argument", "Bioma invalido.");
  if (!gymName) throw new HttpsError("invalid-argument", "Informe o nome do GYM.");
  if (!gymType) throw new HttpsError("invalid-argument", "Informe o tipo do GYM.");
  if (!scenarioThemeId) throw new HttpsError("invalid-argument", "Selecione o cenario.");
  if (!primaryBadgeId) throw new HttpsError("invalid-argument", "Selecione a insignia principal.");
  if (!creationEntitlementId) throw new HttpsError("invalid-argument", "Ticket GYM obrigatorio.");

  const baseState = buildInitialGymState();
  const initialMainTeamLimit = Math.max(1, Number(baseState.mainTeamSlotLimit || 1));
  const uniqueSelections = [];
  const seen = new Set();
  for (const row of initialMainTeam) {
    const sourceCollection = String(row?.sourceCollection || "").trim();
    const sourceDocId = String(row?.sourceDocId || "").trim();
    if (!sourceDocId || (sourceCollection !== "time" && sourceCollection !== "box")) continue;
    const k = `${sourceCollection}_${sourceDocId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniqueSelections.push({ sourceCollection, sourceDocId });
  }
  if (!uniqueSelections.length) throw new HttpsError("invalid-argument", "Selecione ao menos 1 Pokemon para o time principal.");
  if (uniqueSelections.length > initialMainTeamLimit) {
    throw new HttpsError("invalid-argument", "O time principal selecionado excede o limite inicial desse GYM.");
  }

  const now = Date.now();

  await db.runTransaction(async (tx) => {
    const gymRef = db.doc(`gyms/${uid}`);
    const playerRef = db.doc(`players/${uid}`);
    const biomeRef = db.doc(`biomes/${biomeId}`);
    const scenarioRef = db.doc(`scenarios/${scenarioThemeId}`);
    const badgeRef = db.doc(`badges/${primaryBadgeId}`);
    const creationEntitlementRef = db.doc(`players/${uid}/productEntitlements/${creationEntitlementId}`);
    const nameRegistryRef = db.doc(`gymNames/${gymName.trim().toLowerCase()}`);
    const sourceRefs = uniqueSelections.map((entry) =>
      db.doc(`players/${uid}/characters/${characterId}/${entry.sourceCollection}/${entry.sourceDocId}`)
    );
    const linkedNpcRef = linkedNpcId ? db.doc(`npcs/${linkedNpcId}`) : null;

    const reads = [
      tx.get(gymRef),
      tx.get(playerRef),
      tx.get(biomeRef),
      tx.get(creationEntitlementRef),
      tx.get(scenarioRef),
      tx.get(badgeRef),
      tx.get(nameRegistryRef),
      ...sourceRefs.map((r) => tx.get(r)),
    ];
    if (linkedNpcRef) reads.push(tx.get(linkedNpcRef));
    const snaps = await Promise.all(reads);
    const gymSnap = snaps[0];
    const playerSnap = snaps[1];
    const biomeSnap = snaps[2];
    const entitlementSnap = snaps[3];
    const scenarioSnap = snaps[4];
    const badgeSnap = snaps[5];
    const nameRegistrySnap = snaps[6];
    const sourceSnaps = snaps.slice(7, 7 + sourceRefs.length);
    const linkedNpcSnap = linkedNpcRef ? snaps[7 + sourceRefs.length] : null;

    if (gymSnap.exists && toLower(gymSnap.data()?.status) !== "removed") {
      throw new HttpsError("failed-precondition", "Voce ja possui um GYM registrado.");
    }
    const po = playerSnap.exists ? playerSnap.data()?.gymOwnership : null;
    if (playerSnap.exists && po?.gymId && toLower(po?.status) !== "removed") {
      throw new HttpsError("failed-precondition", "Sua conta ja possui um GYM vinculado.");
    }
    if (!biomeSnap.exists) throw new HttpsError("not-found", "Bioma nao encontrado.");
    if (!biomeAllowsGym(biomeSnap.data())) throw new HttpsError("failed-precondition", "Esse bioma nao permite criacao de GYM.");
    if (nameRegistrySnap.exists) throw new HttpsError("failed-precondition", "Ja existe um GYM com esse nome.");
    if (!entitlementSnap.exists) throw new HttpsError("not-found", "Ticket GYM nao encontrado.");
    const freshEntitlement = { id: creationEntitlementId, ...(entitlementSnap.data() || {}) };
    if (!resolveGymTicketConfiguration(freshEntitlement)) throw new HttpsError("failed-precondition", "Ticket GYM invalido.");
    if (!isEntitlementActive(freshEntitlement)) throw new HttpsError("failed-precondition", "Ticket GYM inativo ou expirado.");
    if (freshEntitlement.claimedAt) throw new HttpsError("failed-precondition", "Esse ticket de GYM ja foi utilizado.");
    if (!scenarioSnap.exists) throw new HttpsError("not-found", "Cenario do GYM nao encontrado.");
    const scenario = normalizeGymScenarioRecord(scenarioSnap.id, scenarioSnap.data());
    if (!scenario.isActive) throw new HttpsError("failed-precondition", "O cenario escolhido esta inativo.");
    if (!badgeSnap.exists) throw new HttpsError("not-found", "Insignia principal nao encontrada.");
    const badge = normalizeBadgeRecord(badgeSnap.id, badgeSnap.data());
    if (!badge.isActive) throw new HttpsError("failed-precondition", "A insignia selecionada esta inativa.");

    const rosterEntries = uniqueSelections.map((entry, index) => {
      const sourceSnap = sourceSnaps[index];
      if (!sourceSnap?.exists) throw new HttpsError("not-found", "Um dos Pokemon selecionados nao foi encontrado.");
      const mon = sourceSnap.data() || {};
      const hpData = mon.hp && typeof mon.hp === "object" ? mon.hp : null;
      const speciesId = Math.max(1, Number(mon.speciesId || 0));
      const monLevel = Math.max(1, Number(mon.level || 1));
      const expFromNested = mon.exp && typeof mon.exp === "object" ? Number(mon.exp.current) : NaN;
      const expBarRaw = Number.isFinite(expFromNested) && expFromNested >= 0
        ? Math.floor(expFromNested)
        : Math.max(0, Number(mon.expCurrent ?? mon.currentExp ?? (typeof mon.exp === "number" ? mon.exp : 0) ?? 0));
      const expCurrentNorm = normalizeExpBarCurrentForSpeciesLevel(speciesId, monLevel, expBarRaw);
      const expToNextCanon = expToNextForSpeciesAtLevel(speciesId, monLevel);
      const pokemonTypes = getSpeciesTypes(speciesId, mon);
      if (!pokemonTypes.includes(gymType)) {
        throw new HttpsError("failed-precondition", "O time principal possui Pokemon incompativeis com o tipo do GYM.");
      }
      return {
        id: buildRosterEntryId(entry.sourceCollection, entry.sourceDocId),
        payload: {
          stableInstanceId: ensureStableInstanceIdFromMon(mon),
          sourceCollection: entry.sourceCollection,
          sourceDocId: entry.sourceDocId,
          sourceCharacterId: characterId,
          speciesId,
          speciesName: String(mon.speciesName || `#${speciesId}`),
          level: monLevel,
          pokemonTypes,
          nickname: String(mon.nickname || "") || null,
          nature: String(mon.nature || "") || null,
          hpCurrent: Math.max(1, Number(mon.hpCurrent ?? hpData?.current ?? mon.hpTotal ?? hpData?.total ?? 1)),
          hpTotal: Math.max(1, Number(mon.hpTotal ?? hpData?.total ?? mon.hpCurrent ?? hpData?.current ?? 1)),
          ...updatePokemonExpForAdmin(expCurrentNorm, expToNextCanon),
          isStarter: Boolean(mon.isStarter),
          spriteUrl: String(mon.spriteUrl || "") || null,
          createdAtMs: now,
          updatedAtMs: now,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
      };
    });

    const freshTicketConfig = resolveGymTicketConfiguration(freshEntitlement);
    const linkedNpcData =
      linkedNpcId && linkedNpcSnap && linkedNpcSnap.exists ? linkedNpcSnap.data() || {} : null;
    const expiresAtMs =
      freshTicketConfig && freshTicketConfig.gymMode === "temporary" && freshTicketConfig.gymDurationDays
        ? now + freshTicketConfig.gymDurationDays * 24 * 60 * 60 * 1000
        : null;
    const normalizedGymName = gymName.trim().toLowerCase();

    tx.set(
      gymRef,
      {
        ownerUid: uid,
        ownerCharacterId: characterId,
        ownerCharacterName: characterName,
        name: gymName,
        gymType,
        scenarioThemeId,
        primaryBadgeId: badge.id,
        primaryBadgeName: badge.name,
        primaryBadgeDescription: badge.description || null,
        primaryBadgeImageUrl: badge.imageUrl || null,
        primaryBadgeBonusType: badge.bonusType,
        primaryBadgeBonusValue: badge.bonusValue,
        sourceType: "ticket",
        sourceEntitlementId: creationEntitlementId,
        biomeId,
        ticketMode: freshTicketConfig ? freshTicketConfig.gymMode : "permanent",
        expiresAtMs,
        blockedAtMs: null,
        status: "active",
        approved: true,
        active: true,
        xpBonusPercent: 20,
        storageLimit: baseState.storageLimit,
        storageCount: rosterEntries.length,
        mainTeamSlotLimit: baseState.mainTeamSlotLimit,
        totalSlots: baseState.mainTeamSlotLimit,
        extraSlotsApplied: 0,
        mainTeamCount: rosterEntries.length,
        badgeCount: baseState.badgeCount,
        assignedNpcIds: linkedNpcId ? [linkedNpcId] : [],
        assignedNpcCount: linkedNpcId ? 1 : 0,
        linkedNpcId: linkedNpcId || null,
        linkedNpcName: linkedNpcData ? String(linkedNpcData.nome || linkedNpcId) : null,
        linkedNpcRole: linkedNpcData ? String(linkedNpcData.role || "") : null,
        linkedNpcImageUrl: linkedNpcData ? String(linkedNpcData.imageUrl || "") || null : null,
        activeNpcs: {
          ...baseState.activeNpcs,
          police: linkedNpcData ? toLower(linkedNpcData.role) === "policial" : false,
          additionalNpcCount: 0,
        },
        upgrades: {
          policeUnlocked: linkedNpcData ? toLower(linkedNpcData.role) === "policial" : false,
          additionalNpcCount: 0,
          storageSlotsAdded: 0,
          mainTeamSlotsAdded: 0,
          badgeCountAdded: 0,
        },
        policeInterceptPrepared: linkedNpcData ? toLower(linkedNpcData.role) === "policial" : false,
        challengeQueueCount: 0,
        normalizedName: normalizedGymName,
        createdAtMs: now,
        updatedAtMs: now,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    rosterEntries.forEach((entry, index) => {
      tx.set(db.doc(`gyms/${uid}/storage/${entry.id}`), entry.payload);
      tx.set(db.doc(`gyms/${uid}/mainTeam/${entry.id}`), { ...entry.payload, slotOrder: index + 1 });
    });
    if (linkedNpcId && linkedNpcData) {
      tx.set(
        db.doc(`gyms/${uid}/assignedNpcs/${linkedNpcId}`),
        {
          npcId: linkedNpcId,
          name: String(linkedNpcData.nome || linkedNpcId),
          role: String(linkedNpcData.role || ""),
          imageUrl: String(linkedNpcData.imageUrl || "") || null,
          appearanceRate: typeof linkedNpcData.appearanceRate === "number" ? linkedNpcData.appearanceRate : null,
          isCommercialized: Boolean(linkedNpcData.isCommercialized),
          ecoinPrice: typeof linkedNpcData.ecoinPrice === "number" ? linkedNpcData.ecoinPrice : null,
          createdAtMs: now,
          updatedAtMs: now,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    tx.set(
      playerRef,
      {
        gymOwnership: {
          gymId: uid,
          sourceType: "ticket",
          status: "active",
          gymType,
          biomeId,
          updatedAtMs: now,
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    tx.set(
      nameRegistryRef,
      { ownerUid: uid, gymId: uid, name: gymName, normalizedName: normalizedGymName, createdAtMs: now, createdAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    tx.set(
      creationEntitlementRef,
      {
        claimedAt: FieldValue.serverTimestamp(),
        claimedByCharacterId: characterId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

  return {};
}

module.exports = {
  executeApplyGymUpgradeEntitlement,
  executeRenewGymWithEntitlement,
  executeCreateGymWithTicket,
};
