const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const crypto = require("crypto");
const logger = require("firebase-functions/logger");
const { ensureStableInstanceId } = require("./pokemonDocIdentity");
const { resolveCallableUid } = require("./callableUid");
const { fullHpForSpeciesAtLevel } = require("./pokemonStatCalc");
const { expToNextForSpeciesAtLevel } = require("./experienceExp");
const { updatePokemonExpForAdmin } = require("./expWriteCanonical");

const REGION = { region: "southamerica-east1" };

const EGG_INCUBATOR_ITEM_ID = "egg-incubator";
const MYSTERY_EGG_ITEM_ID = "mystery-egg";
const BABY_POOL = [172, 447, 175]; // Pichu, Riolu, Togepi
const PSEUDO_POOL = [147, 443, 246]; // Dratini, Gible, Larvitar

let pokemonMoves = {};
let pokemonMovesDex = {};
try {
  pokemonMoves = require("../../elodex-mobile/src/data/pokemon/pokemonMoves.json");
  pokemonMovesDex = require("../../elodex-mobile/src/data/pokemon/moves.json");
} catch (e) {
  // Em Cloud Run, esse caminho externo ao source pode nao existir.
  // Mantemos fallback seguro para nao derrubar o container no deploy.
  pokemonMoves = {};
  pokemonMovesDex = {};
}

function norm(v) {
  return String(v || "").trim().toLowerCase();
}

function asInt(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function getSpeciesMoves(speciesId) {
  const sid = String(Math.max(1, asInt(speciesId, 1)));
  const byKey = pokemonMoves?.[sid];
  const raw = Array.isArray(byKey?.moves) ? byKey.moves : Array.isArray(byKey) ? byKey : [];
  return raw
    .map((m) => ({
      moveId: norm(m?.moveId ?? m?.id ?? m?.name ?? m?.moveName ?? m?.move),
      level: Number.isFinite(Number(m?.level ?? m?.levelLearnedAt ?? m?.lvl))
        ? Math.max(1, asInt(m?.level ?? m?.levelLearnedAt ?? m?.lvl, 1))
        : null,
      method: String(m?.method || "").toLowerCase() || (Number.isFinite(Number(m?.level ?? m?.levelLearnedAt ?? m?.lvl)) ? "level-up" : "other"),
    }))
    .filter((x) => !!x.moveId);
}

function resolveActiveMoveset(speciesId, level) {
  const lv = Math.max(1, asInt(level, 1));
  const learned = getSpeciesMoves(speciesId)
    .filter((m) => m.method === "level-up" && m.level != null && m.level <= lv)
    .sort((a, b) => a.level - b.level);
  const out = [];
  for (let i = learned.length - 1; i >= 0; i--) {
    const mid = norm(learned[i].moveId);
    if (!mid || out.includes(mid)) continue;
    out.unshift(mid);
    if (out.length >= 4) break;
  }
  if (!out.length) out.push("pound");
  return out.slice(0, 4);
}

function buildMovePp(moveIds) {
  return (Array.isArray(moveIds) ? moveIds : []).map((id) => {
    const row = pokemonMovesDex?.[norm(id)] || null;
    const pp = Number(row?.pp);
    return Math.max(1, Number.isFinite(pp) ? Math.trunc(pp) : 35);
  });
}

function randomHatchSpeciesId() {
  const pool = Math.random() < 0.9 ? BABY_POOL : PSEUDO_POOL;
  return pool[Math.floor(Math.random() * pool.length)];
}

function randomNatureName() {
  const natures = [
    "Hardy", "Lonely", "Brave", "Adamant", "Naughty",
    "Bold", "Docile", "Relaxed", "Impish", "Lax",
    "Timid", "Hasty", "Serious", "Jolly", "Naive",
    "Modest", "Mild", "Quiet", "Bashful", "Rash",
    "Calm", "Gentle", "Sassy", "Careful", "Quirky",
  ];
  return natures[Math.floor(Math.random() * natures.length)] || "Docile";
}

function randomGenderSimple() {
  return Math.random() < 0.5 ? "M" : "F";
}

function getFirstAbilityIdFromSpeciesMoves(speciesId) {
  // Fallback seguro quando catalogo de espécies não estiver disponível nas functions.
  // Evita gravar valor vazio.
  return "unknown-ability";
}

exports.placeMysteryEggInIncubator = onCall(REGION, async (request) => {
  const uid = await resolveCallableUid(request);
  const characterId = String(request.data?.characterId || "").trim();
  if (!characterId) throw new HttpsError("invalid-argument", "characterId obrigatorio.");

  const db = getFirestore();
  const characterRef = db.doc(`players/${uid}/characters/${characterId}`);
  const mysteryRef = db.doc(`players/${uid}/characters/${characterId}/itens/${MYSTERY_EGG_ITEM_ID}`);
  const itemMetaRef = db.doc(`players/${uid}/characters/${characterId}/itens/_meta`);

  await db.runTransaction(async (tx) => {
    const teamRefs = Array.from({ length: 6 }, (_, i) => db.doc(`players/${uid}/characters/${characterId}/time/slot_${i + 1}`));
    const teamSnaps = await Promise.all(teamRefs.map((ref) => tx.get(ref)));
    const activeTeamCount = teamSnaps.filter((snap) => snap.exists && asInt(snap.data()?.speciesId, 0) > 0).length;
    if (activeTeamCount >= 6) {
      throw new HttpsError("failed-precondition", "Seu time está cheio. Libere espaço antes de incubar o ovo.");
    }

    const incubatorQuerySnap = await tx.get(
      db.collection(`players/${uid}/characters/${characterId}/itens`)
        .where("quantity", ">", 0)
        .limit(30)
    );
    const incubators = incubatorQuerySnap.docs
      .map((d) => ({ id: d.id, data: d.data() || {} }))
      .filter((x) => x.id === EGG_INCUBATOR_ITEM_ID || x.id.startsWith(`${EGG_INCUBATOR_ITEM_ID}-`));
    if (!incubators.length) {
      throw new HttpsError("failed-precondition", "Voce nao possui incubadora disponivel.");
    }
    incubators.sort((a, b) => {
      const da = Math.max(1, asInt(a.data?.metadata?.incubatorDays || (String(a.id).match(/egg-incubator-(\d+)d/) || [])[1] || 3, 3));
      const dbb = Math.max(1, asInt(b.data?.metadata?.incubatorDays || (String(b.id).match(/egg-incubator-(\d+)d/) || [])[1] || 3, 3));
      return da - dbb;
    });
    const chosenIncubator = incubators[0];
    const incubatorRef = db.doc(`players/${uid}/characters/${characterId}/itens/${chosenIncubator.id}`);
    const hatchDays = Math.max(
      1,
      asInt(chosenIncubator.data?.metadata?.incubatorDays || (String(chosenIncubator.id).match(/egg-incubator-(\d+)d/) || [])[1] || 3, 3)
    );

    const [charSnap, mysterySnap, incubatorSnap, metaSnap] = await Promise.all([
      tx.get(characterRef),
      tx.get(mysteryRef),
      tx.get(incubatorRef),
      tx.get(itemMetaRef),
    ]);
    if (!charSnap.exists) throw new HttpsError("not-found", "Personagem nao encontrado.");
    if (!mysterySnap.exists) throw new HttpsError("failed-precondition", "Voce nao possui ovo misterioso.");
    if (!incubatorSnap.exists) throw new HttpsError("failed-precondition", "Voce nao possui incubadora disponivel.");

    const mysteryQty = Math.max(0, asInt(mysterySnap.data()?.quantity, 0));
    const incubatorQty = Math.max(0, asInt(incubatorSnap.data()?.quantity, 0));
    if (mysteryQty <= 0) throw new HttpsError("failed-precondition", "Voce nao possui ovo misterioso.");
    if (incubatorQty <= 0) throw new HttpsError("failed-precondition", "Voce nao possui incubadora disponivel.");

    const nextMystery = mysteryQty - 1;
    if (nextMystery <= 0) tx.delete(mysteryRef);
    else tx.update(mysteryRef, { quantity: nextMystery, updatedAt: FieldValue.serverTimestamp() });

    const nextIncubator = incubatorQty - 1;
    if (nextIncubator <= 0) tx.delete(incubatorRef);
    else tx.update(incubatorRef, { quantity: nextIncubator, updatedAt: FieldValue.serverTimestamp() });

    const total = Math.max(0, asInt(metaSnap.data()?.totalQuantity, 0));
    tx.set(
      itemMetaRef,
      {
        totalQuantity: Math.max(0, total - 2),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const startedAtMs = Date.now();
    const endsAtMs = startedAtMs + hatchDays * 24 * 60 * 60 * 1000;
    const eggRef = db.collection(`players/${uid}/characters/${characterId}/eggs`).doc();
    tx.set(eggRef, {
      isMysteryEgg: true,
      speciesId: 0,
      speciesName: "Ovo misterioso",
      status: "incubating",
      hatchMode: "time",
      requiresIncubator: false,
      incubatorAssignedAt: FieldValue.serverTimestamp(),
      incubatorId: chosenIncubator.id,
      startedAtMs,
      endsAtMs,
      readyAtMs: endsAtMs,
      hatchClaimedAt: null,
      hatchTxnId: null,
      hatched: false,
      source: "mystery_bag",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  return { ok: true };
});

exports.placeEggInIncubator = onCall(REGION, async (request) => {
  const uid = await resolveCallableUid(request);
  const characterId = String(request.data?.characterId || "").trim();
  const eggId = String(request.data?.eggId || "").trim();
  const preferredIncubatorId = norm(request.data?.incubatorItemId || "");
  if (!characterId || !eggId) throw new HttpsError("invalid-argument", "characterId e eggId obrigatorios.");

  const db = getFirestore();
  const eggRef = db.doc(`players/${uid}/characters/${characterId}/eggs/${eggId}`);
  const itemMetaRef = db.doc(`players/${uid}/characters/${characterId}/itens/_meta`);

  await db.runTransaction(async (tx) => {
    const eggSnap = await tx.get(eggRef);
    if (!eggSnap.exists) throw new HttpsError("not-found", "Ovo nao encontrado.");
    const egg = eggSnap.data() || {};
    const status = String(egg.status || "stored");
    const hatchMode = String(egg.hatchMode || "steps") === "time" ? "time" : "steps";
    if (status === "ready" || status === "hatched") throw new HttpsError("failed-precondition", "Esse ovo ja esta pronto.");
    if (status !== "stored" && hatchMode === "time") throw new HttpsError("failed-precondition", "Esse ovo ja esta incubando.");
    if (!egg.requiresIncubator && status !== "stored") throw new HttpsError("failed-precondition", "Esse ovo nao exige incubadora.");
    if (egg.incubatorAssignedAt || egg.incubatorId) throw new HttpsError("failed-precondition", "Esse ovo ja possui incubadora ativa.");

    const incubatorQuerySnap = await tx.get(
      db.collection(`players/${uid}/characters/${characterId}/itens`)
        .where("quantity", ">", 0)
        .limit(30)
    );
    const incubators = incubatorQuerySnap.docs
      .map((d) => ({ id: d.id, data: d.data() || {} }))
      .filter((x) => x.id === EGG_INCUBATOR_ITEM_ID || x.id.startsWith(`${EGG_INCUBATOR_ITEM_ID}-`));
    if (!incubators.length) throw new HttpsError("failed-precondition", "Voce nao possui incubadora disponivel.");
    incubators.sort((a, b) => {
      const da = Math.max(1, asInt(a.data?.metadata?.incubatorDays || (String(a.id).match(/egg-incubator-(\d+)d/) || [])[1] || 3, 3));
      const dbb = Math.max(1, asInt(b.data?.metadata?.incubatorDays || (String(b.id).match(/egg-incubator-(\d+)d/) || [])[1] || 3, 3));
      return da - dbb;
    });
    const chosenIncubator =
      (preferredIncubatorId && incubators.find((x) => norm(x.id) === preferredIncubatorId)) || incubators[0];
    const incubatorRef = db.doc(`players/${uid}/characters/${characterId}/itens/${chosenIncubator.id}`);
    const incubatorSnap = await tx.get(incubatorRef);
    if (!incubatorSnap.exists) throw new HttpsError("failed-precondition", "Voce nao possui incubadora disponivel.");
    const incubatorQty = Math.max(0, asInt(incubatorSnap.data()?.quantity, 0));
    if (incubatorQty <= 0) throw new HttpsError("failed-precondition", "Voce nao possui incubadora disponivel.");

    const nextQty = incubatorQty - 1;
    if (nextQty <= 0) tx.delete(incubatorRef);
    else tx.update(incubatorRef, { quantity: nextQty, updatedAt: FieldValue.serverTimestamp() });

    const metaSnap = await tx.get(itemMetaRef);
    const total = Math.max(0, asInt(metaSnap.data()?.totalQuantity, 0));
    tx.set(itemMetaRef, { totalQuantity: Math.max(0, total - 1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });

    const hatchDays = Math.max(
      1,
      asInt(chosenIncubator.data?.metadata?.incubatorDays || (String(chosenIncubator.id).match(/egg-incubator-(\d+)d/) || [])[1] || 3, 3)
    );
    const startedAtMs = Date.now();
    const endsAtMs = startedAtMs + hatchDays * 24 * 60 * 60 * 1000;
    tx.set(
      eggRef,
      {
        status: "incubating",
        hatchMode: "time",
        requiresIncubator: false,
        incubatorAssignedAt: FieldValue.serverTimestamp(),
        incubatorId: chosenIncubator.id,
        startedAtMs,
        endsAtMs,
        readyAtMs: endsAtMs,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

  return { ok: true };
});

exports.hatchEgg = onCall(REGION, async (request) => {
  const payload = request.data && typeof request.data === "object" ? request.data : {};
  const hasIdToken = typeof payload.idToken === "string" && payload.idToken.trim().length > 0;
  let uid = "";
  try {
    uid = await resolveCallableUid(request);
  } catch (err) {
    logger.error("[hatchEgg] falha auth", {
      functionName: "hatchEgg",
      hasAuth: !!request.auth?.uid,
      hasIdToken,
      requestAuthUid: request.auth?.uid || null,
      resolvedUid: null,
      code: err?.code || null,
      message: err?.message || String(err),
    });
    throw err;
  }
  logger.info("[hatchEgg] auth resolvida", {
    functionName: "hatchEgg",
    hasAuth: !!request.auth?.uid,
    hasIdToken,
    requestAuthUid: request.auth?.uid || null,
    resolvedUid: uid,
  });
  const characterId = String(request.data?.characterId || "").trim();
  const eggId = String(request.data?.eggId || "").trim();
  if (!characterId || !eggId) throw new HttpsError("invalid-argument", "characterId e eggId obrigatorios.");

  const db = getFirestore();
  const eggRef = db.doc(`players/${uid}/characters/${characterId}/eggs/${eggId}`);
  const claimId = crypto.randomUUID();

  let chosenSlot = null;
  let hatchSpeciesId = 0;
  let hatchSpeciesName = "";

  await db.runTransaction(async (tx) => {
    const teamRefs = Array.from({ length: 6 }, (_, i) => db.doc(`players/${uid}/characters/${characterId}/time/slot_${i + 1}`));
    const [eggSnap, ...teamSnaps] = await Promise.all([tx.get(eggRef), ...teamRefs.map((ref) => tx.get(ref))]);
    if (!eggSnap.exists) throw new HttpsError("not-found", "Ovo nao encontrado.");
    const egg = eggSnap.data() || {};
    if (egg.hatched === true) throw new HttpsError("failed-precondition", "Ovo ja foi chocado.");
    if (egg.hatchClaimedAt) throw new HttpsError("aborted", "Chocagem em andamento. Tente novamente.");

    const status = String(egg.status || "");
    const readyAtMs = asInt(egg.readyAtMs, 0);
    const ready = status === "ready" || (readyAtMs > 0 && Date.now() >= readyAtMs);
    if (!ready) throw new HttpsError("failed-precondition", "Ovo ainda nao esta pronto para chocar.");

    const activeTeamCount = teamSnaps.filter((snap) => snap.exists && asInt(snap.data()?.speciesId, 0) > 0).length;
    if (activeTeamCount >= 6) {
      throw new HttpsError("failed-precondition", "Seu time está cheio. Libere espaço antes de incubar o ovo.");
    }

    for (let i = 0; i < teamSnaps.length; i++) {
      const snap = teamSnaps[i];
      if (!snap.exists || asInt(snap.data()?.speciesId, 0) <= 0) {
        chosenSlot = i + 1;
        break;
      }
    }
    if (!chosenSlot) {
      throw new HttpsError("failed-precondition", "Seu time está cheio. Libere espaço antes de incubar o ovo.");
    }

    hatchSpeciesId = randomHatchSpeciesId();
    hatchSpeciesName = String(request.data?.speciesNameOverride || "").trim() || `#${hatchSpeciesId}`;

    tx.set(
      eggRef,
      {
        hatchClaimedAt: FieldValue.serverTimestamp(),
        hatchTxnId: claimId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

  const level = 1;
  const hatchExpToNext = expToNextForSpeciesAtLevel(hatchSpeciesId, level);
  const moves = resolveActiveMoveset(hatchSpeciesId, level);
  const movePp = buildMovePp(moves);
  const zeroIvEvs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  const hatchHp = fullHpForSpeciesAtLevel(hatchSpeciesId, level, zeroIvEvs, zeroIvEvs);
  const teamRef = db.doc(`players/${uid}/characters/${characterId}/time/slot_${chosenSlot}`);

  await db.runTransaction(async (tx) => {
    const eggSnap = await tx.get(eggRef);
    if (!eggSnap.exists) throw new HttpsError("not-found", "Ovo nao encontrado.");
    const egg = eggSnap.data() || {};
    if (egg.hatched === true) return;
    if (String(egg.hatchTxnId || "") !== claimId) {
      throw new HttpsError("aborted", "Outra tentativa assumiu a chocagem.");
    }

    tx.set(
      teamRef,
      ensureStableInstanceId({
        slotIndex: chosenSlot,
        speciesId: hatchSpeciesId,
        speciesName: hatchSpeciesName,
        nickname: hatchSpeciesName,
        level,
        nature: randomNatureName(),
        gender: randomGenderSimple(),
        abilityId: getFirstAbilityIdFromSpeciesMoves(hatchSpeciesId),
        hp: { current: hatchHp.current, total: hatchHp.total },
        ...updatePokemonExpForAdmin(0, hatchExpToNext),
        moves,
        movePp,
        moveHistory: moves,
        friendship: 70,
        isStarter: false,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
    );

    tx.set(
      eggRef,
      {
        hatched: true,
        status: "hatched",
        hatchCompletedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    tx.delete(eggRef);
  });

  return { ok: true };
});

exports.healFullTeam = onCall(REGION, async (request) => {
  const payload = request.data && typeof request.data === "object" ? request.data : {};
  const hasIdToken = typeof payload.idToken === "string" && payload.idToken.trim().length > 0;
  let uid = "";
  try {
    uid = await resolveCallableUid(request);
  } catch (err) {
    logger.error("[healFullTeam] falha auth", {
      functionName: "healFullTeam",
      hasAuth: !!request.auth?.uid,
      hasIdToken,
      requestAuthUid: request.auth?.uid || null,
      resolvedUid: null,
      code: err?.code || null,
      message: err?.message || String(err),
    });
    throw err;
  }
  logger.info("[healFullTeam] auth resolvida", {
    functionName: "healFullTeam",
    hasAuth: !!request.auth?.uid,
    hasIdToken,
    requestAuthUid: request.auth?.uid || null,
    resolvedUid: uid,
  });
  const characterId = String(request.data?.characterId || "").trim();
  if (!characterId) throw new HttpsError("invalid-argument", "characterId obrigatorio.");
  const db = getFirestore();

  await db.runTransaction(async (tx) => {
    const teamRefs = Array.from({ length: 6 }, (_, i) => db.doc(`players/${uid}/characters/${characterId}/time/slot_${i + 1}`));
    const teamSnaps = await Promise.all(teamRefs.map((ref) => tx.get(ref)));

    for (let i = 0; i < teamSnaps.length; i++) {
      const snap = teamSnaps[i];
      if (!snap.exists) continue;
      const mon = snap.data() || {};
      const speciesId = asInt(mon.speciesId, 0);
      if (speciesId <= 0) continue;
      const slotIndex = i + 1;
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
      const hpCurrentPrev = Math.max(0, asInt(mon?.hp?.current ?? mon?.hpCurrent ?? hpTotalPrev, hpTotalPrev));
      const canonicalHp = fullHpForSpeciesAtLevel(speciesId, level, ivs, evs);
      const hpTotalCanonical = Math.max(1, asInt(canonicalHp.total, 1));
      const hpTotal = Math.max(hpTotalPrev, hpTotalCanonical);
      const healReason = hpTotalPrev > hpTotalCanonical ? "fallback_keep_legacy_total" : "canonical";
      logger.info("[healFullTeam] hp normalization", {
        slotIndex,
        speciesId,
        level,
        ivs,
        evs,
        hpPrev: { current: hpCurrentPrev, total: hpTotalPrev },
        hpCanonical: { current: hpTotalCanonical, total: hpTotalCanonical },
        hpApplied: { current: hpTotal, total: hpTotal },
        reason: healReason,
      });
      const moves = Array.isArray(mon.moves) ? mon.moves.map((m) => norm(m)).filter(Boolean).slice(0, 4) : [];
      const movePp = buildMovePp(moves);
      // Bug 9 (fix): cura completa é tratada como evento `care` (+4 amizade
      // canon: 4 por uso de item de cura). Clampa [0,255].
      const rawFriend = Math.trunc(Number(mon.friendship));
      const baseFriend = Number.isFinite(rawFriend) ? Math.max(0, Math.min(255, rawFriend)) : 70;
      const nextFriend = Math.max(0, Math.min(255, baseFriend + 4));
      tx.set(
        teamRefs[i],
        {
          hp: { current: hpTotal, total: hpTotal },
          ...(movePp.length ? { movePp } : {}),
          status: FieldValue.delete(),
          statusCondition: FieldValue.delete(),
          nonVolatileStatus: FieldValue.delete(),
          volatileStatus: FieldValue.delete(),
          battleStatus: FieldValue.delete(),
          statusTurns: FieldValue.delete(),
          friendship: nextFriend,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  });

  return { ok: true };
});

exports.__test__ = {
  resolveActiveMoveset,
  buildMovePp,
  randomHatchSpeciesId,
};

