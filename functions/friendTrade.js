const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { logger } = require("firebase-functions");
const { ensureStableInstanceId } = require("./pokemonDocIdentity");
const { resolveCallableUid } = require("./callableUid");

let pe;
try {
  pe = require("./lib/pokemonEvolution.cjs");
} catch (e) {
  console.error("[friendTrade] Falha ao carregar pokemonEvolution.cjs", e?.message || e);
  throw e;
}

const REGION = { region: "southamerica-east1" };
const MAX_ITEM_TYPES = 12;
const MAX_BOX_PER_SIDE = 6;
const TRADE_TTL_MS = 60 * 60 * 1000;

let cachedMergedRules = null;
let cachedMergedAtMs = 0;
const MERGED_TTL_MS = 60_000;

async function loadMergedEvolutionRules(db) {
  const now = Date.now();
  if (cachedMergedRules && now - cachedMergedAtMs < MERGED_TTL_MS) {
    return cachedMergedRules;
  }
  const snap = await db.collection("evolutionConfigRules").get();
  const docs = snap.docs.map((d) => ({ id: d.id, data: d.data() || {} }));
  const extras = pe.parseEvolutionConfigDocuments(docs);
  cachedMergedRules = pe.mergeEvolutionRulesMaps(pe.EVOLUTION_RULES_BY_SPECIES, extras);
  cachedMergedAtMs = now;
  return cachedMergedRules;
}

function n(v, f = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : f;
}

async function assertFriends(db, a, b) {
  const s = await db.doc(`players/${a}/friends/${b}`).get();
  if (!s.exists) throw new HttpsError("failed-precondition", "Somente amigos podem trocar.");
}

function normalizeOffer(raw) {
  const itemsRaw = Array.isArray(raw?.items) ? raw.items : Array.isArray(raw?.itemStacks) ? raw.itemStacks : [];
  const boxDocIds = Array.isArray(raw?.boxDocIds) ? raw.boxDocIds.map((x) => String(x || "").trim()).filter(Boolean) : [];
  const map = new Map();
  for (const r of itemsRaw) {
    const itemId = String(r.itemId || r.id || "")
      .trim()
      .toLowerCase();
    const qty = Math.max(1, Math.floor(n(r.qty || r.quantity, 1)));
    if (!itemId) continue;
    map.set(itemId, (map.get(itemId) || 0) + qty);
  }
  const items = [...map.entries()].map(([itemId, qty]) => ({ itemId, qty }));
  const ids = [...new Set(boxDocIds)];
  return { items, boxDocIds: ids };
}

function normalizeHeldItemId(mon) {
  const raw = String(mon.heldItemId || mon.itemId || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  return raw || null;
}

/**
 * Pós-troca: `itemId` no contexto de evolução = item segurado (`heldItemId`) do documento do Pokémon.
 * Se a regra exige `tradeOnly` + `itemId`, o motor só casa com o item segurado; ao evoluir, o item é
 * removido (comportamento alinhado aos jogos principais: item de troca consumido na evolução).
 */
function applyTradeEvolutionToMon(mon, biomeId, merged) {
  const currentSpeciesId = Math.max(1, Math.trunc(Number(mon.speciesId || 0)));
  const level = Math.max(1, Math.trunc(Number(mon.level || 1)));
  const heldItemIdForCtx = normalizeHeldItemId(mon);
  const ctx = pe.buildEvolutionContext({
    speciesId: currentSpeciesId,
    level,
    friendship: Number(mon.friendship ?? pe.FRIENDSHIP_DEFAULT),
    knownMoves: Array.isArray(mon.moves) ? mon.moves : [],
    moveHistory: Array.isArray(mon.moveHistory) ? mon.moveHistory : [],
    relearnableMoves: Array.isArray(mon.relearnableMoves) ? mon.relearnableMoves : [],
    biomeId: pe.normalizeBiomeId(biomeId),
    itemId: heldItemIdForCtx,
    chosenToSpeciesId: null,
    utcTimestampMs: Date.now(),
    isTrade: true,
    abilityId: mon.abilityId != null && String(mon.abilityId).trim() !== "" ? String(mon.abilityId) : null,
  });

  const toSpeciesId = pe.resolveEvolutionTarget(ctx, merged);
  if (!toSpeciesId) {
    // Bug 2 (fix): sem evolução nesta troca → preserva pendingEvolution/pendingLearnMove
    // do documento original (caso o Pokémon já tivesse evolução pendente por level-up).
    return { mon: { ...mon }, evolved: false };
  }

  const ruleList = merged[currentSpeciesId] || [];
  const usedRule = ruleList.find((r) => r.toSpeciesId === toSpeciesId && pe.ruleMatches(ctx, r));
  if (!usedRule) {
    return { mon: { ...mon }, evolved: false };
  }

  const newSpeciesName = pe.getSpeciesName(toSpeciesId);
  const oldSpeciesName = String(mon.speciesName || pe.getSpeciesName(currentSpeciesId));
  const nicknameEdited = !!mon.nicknameEdited;
  const currentNickname = String(mon.nickname || "").trim();
  const shouldAutoRename = !nicknameEdited && (!currentNickname || currentNickname === oldSpeciesName);
  const nextNickname = shouldAutoRename ? newSpeciesName : currentNickname;
  const nextAbilityId = pe.pickAbilityForEvolution(currentSpeciesId, mon.abilityId, toSpeciesId);
  const base = pe.resolveBaseStats(toSpeciesId);
  const ivs = mon.ivs || { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  const evs = mon.evs || { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  const real = base
    ? pe.calcRealStats({
        level,
        nature: mon.nature || "Docile",
        base,
        ivs,
        evs,
      })
    : null;

  const oldHpTotal = Math.max(1, Number(mon.hp?.total ?? 1));
  const oldHpCurrent = Math.max(0, Number(mon.hp?.current ?? 0));
  const newHpTotal = Math.max(1, Number(real?.hp ?? oldHpTotal));
  const hpDelta = newHpTotal - oldHpTotal;
  const newHpCurrent = Math.max(1, Math.min(newHpTotal, oldHpCurrent + hpDelta));

  const next = {
    ...mon,
    speciesId: toSpeciesId,
    speciesName: newSpeciesName,
    nickname: nextNickname,
    nicknameEdited,
    abilityId: nextAbilityId ?? mon.abilityId ?? "",
    ...(real
      ? {
          stats: { atk: real.atk, def: real.def, spa: real.spa, spd: real.spd, spe: real.spe },
          hp: { current: newHpCurrent, total: newHpTotal },
        }
      : {}),
  };
  delete next.pendingEvolution;
  delete next.pendingLearnMove;
  delete next.pendingLearnMoveQueue;
  if (usedRule.itemId) {
    next.heldItemId = null;
    next.itemId = null;
  }
  return { mon: next, evolved: true };
}

async function decrementCharacterItems(tx, db, uid, cid, items) {
  const itensCol = db.collection(`players/${uid}/characters/${cid}/itens`);
  const metaRef = db.doc(`players/${uid}/characters/${cid}/itens/_meta`);
  const metaSnap = await tx.get(metaRef);
  let totalQuantity = Math.max(0, n(metaSnap.data()?.totalQuantity, 0));

  for (const row of items) {
    const itemId = row.itemId;
    const qty = row.qty;
    const itemRef = itensCol.doc(itemId);
    const itemSnap = await tx.get(itemRef);
    const have = Math.max(0, Math.trunc(n(itemSnap.data()?.quantity, 0)));
    if (have < qty) {
      throw new HttpsError("failed-precondition", `Item insuficiente: ${itemId}`);
    }
    const nextQ = have - qty;
    totalQuantity -= qty;
    if (nextQ <= 0) tx.delete(itemRef);
    else tx.update(itemRef, { quantity: nextQ, updatedAt: FieldValue.serverTimestamp() });
  }
  tx.set(
    metaRef,
    { totalQuantity: Math.max(0, totalQuantity), updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
}

async function incrementCharacterItems(tx, db, uid, cid, items) {
  const itensCol = db.collection(`players/${uid}/characters/${cid}/itens`);
  const metaRef = db.doc(`players/${uid}/characters/${cid}/itens/_meta`);
  const metaSnap = await tx.get(metaRef);
  let totalQuantity = Math.max(0, n(metaSnap.data()?.totalQuantity, 0));

  for (const row of items) {
    const itemId = row.itemId;
    const qty = row.qty;
    const itemRef = itensCol.doc(itemId);
    const itemSnap = await tx.get(itemRef);
    const prev = itemSnap.exists ? Math.max(0, n(itemSnap.data()?.quantity, 0)) : 0;
    const template = itemSnap.exists && itemSnap.data() ? itemSnap.data() : { id: itemId };
    totalQuantity += qty;
    tx.set(
      itemRef,
      {
        ...template,
        id: itemId,
        itemId,
        quantity: prev + qty,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
  tx.set(
    metaRef,
    { totalQuantity: Math.max(0, totalQuantity), updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
}

exports.createFriendTrade = onCall(REGION, async (request) => {
  const me = await resolveCallableUid(request);
  const toUid = String(request.data?.toUid || "").trim();
  const characterId = String(request.data?.characterId || "").trim();
  const offer = normalizeOffer(request.data?.offer);
  if (!toUid || !characterId) {
    throw new HttpsError("invalid-argument", "toUid e characterId sao obrigatorios.");
  }
  if (offer.items.length > MAX_ITEM_TYPES || offer.boxDocIds.length > MAX_BOX_PER_SIDE) {
    throw new HttpsError("invalid-argument", "Oferta excede limites.");
  }

  const db = getFirestore();
  await assertFriends(db, me, toUid);

  const charSnap = await db.doc(`players/${me}/characters/${characterId}`).get();
  if (!charSnap.exists) throw new HttpsError("not-found", "Personagem nao encontrado.");

  const tradeRef = db.collection("friendTrades").doc();
  const expiresAt = new Date(Date.now() + TRADE_TTL_MS);
  await tradeRef.set({
    fromUid: me,
    toUid,
    fromCharacterId: characterId,
    fromOffer: offer,
    status: "awaiting_peer",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    expiresAt,
  });

  logger.info("createFriendTrade", { tradeId: tradeRef.id, fromUid: me, toUid });
  return { ok: true, tradeId: tradeRef.id };
});

exports.completeFriendTrade = onCall(REGION, async (request) => {
  const me = await resolveCallableUid(request);
  const tradeId = String(request.data?.tradeId || "").trim();
  const characterId = String(request.data?.characterId || "").trim();
  const toOffer = normalizeOffer(request.data?.offer);
  if (!tradeId || !characterId) {
    throw new HttpsError("invalid-argument", "tradeId e characterId sao obrigatorios.");
  }
  if (toOffer.items.length > MAX_ITEM_TYPES || toOffer.boxDocIds.length > MAX_BOX_PER_SIDE) {
    throw new HttpsError("invalid-argument", "Oferta excede limites.");
  }

  const db = getFirestore();
  let merged;
  try {
    merged = await loadMergedEvolutionRules(db);
  } catch (e) {
    logger.error("completeFriendTrade_loadRules", e);
    throw new HttpsError("internal", "Falha ao carregar regras de evolucao.");
  }

  try {
  await db.runTransaction(async (tx) => {
    const tRef = db.doc(`friendTrades/${tradeId}`);
    const tSnap = await tx.get(tRef);
    if (!tSnap.exists) throw new HttpsError("not-found", "Troca nao encontrada.");
    const tr = tSnap.data() || {};
    if (String(tr.status) !== "awaiting_peer") {
      throw new HttpsError("failed-precondition", "Esta troca nao esta aguardando conclusao.");
    }
    if (String(tr.toUid) !== me) {
      throw new HttpsError("permission-denied", "Apenas o convidado pode concluir a troca.");
    }

    const exp = tr.expiresAt;
    const expMs = exp && typeof exp.toMillis === "function" ? exp.toMillis() : 0;
    if (expMs > 0 && expMs < Date.now()) {
      tx.set(tRef, { status: "expired", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      throw new HttpsError("failed-precondition", "Troca expirada. Pecao outra.");
    }

    const fromUid = String(tr.fromUid);
    const fromCid = String(tr.fromCharacterId);
    const fromOffer = normalizeOffer(tr.fromOffer);

    const friendEdge = await tx.get(db.doc(`players/${fromUid}/friends/${me}`));
    if (!friendEdge.exists) {
      throw new HttpsError("failed-precondition", "Amizade nao encontrada; troca nao pode concluir.");
    }

    const charFromRef = db.doc(`players/${fromUid}/characters/${fromCid}`);
    const charToRef = db.doc(`players/${me}/characters/${characterId}`);
    const [charFromSnap, charToSnap] = await Promise.all([tx.get(charFromRef), tx.get(charToRef)]);
    if (!charFromSnap.exists || !charToSnap.exists) {
      throw new HttpsError("not-found", "Personagem de um dos lados nao encontrado.");
    }

    const biomeFrom = pe.normalizeBiomeId(charFromSnap.data()?.biomeAtualId);
    const biomeTo = pe.normalizeBiomeId(charToSnap.data()?.biomeAtualId);

    const fromBoxCol = db.collection(`players/${fromUid}/characters/${fromCid}/box`);
    const toBoxCol = db.collection(`players/${me}/characters/${characterId}/box`);

    const fromMons = [];
    for (const id of fromOffer.boxDocIds) {
      const ref = fromBoxCol.doc(id);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpsError("failed-precondition", "Pokemon oferecido pelo amigo sumiu da BOX.");
      const data = snap.data() || {};
      if (Boolean(data.isStarter)) throw new HttpsError("failed-precondition", "Pokemon inicial nao pode entrar na troca.");
      if (Math.trunc(Number(data.speciesId || 0)) <= 0) throw new HttpsError("failed-precondition", "BOX invalida no lado do amigo.");
      fromMons.push({ ref, data });
    }

    const toMons = [];
    for (const id of toOffer.boxDocIds) {
      const ref = toBoxCol.doc(id);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpsError("failed-precondition", "Pokemon da sua BOX nao encontrado.");
      const data = snap.data() || {};
      if (Boolean(data.isStarter)) throw new HttpsError("failed-precondition", "Pokemon inicial nao pode ser trocado.");
      if (Math.trunc(Number(data.speciesId || 0)) <= 0) throw new HttpsError("failed-precondition", "Slot de BOX invalido.");
      toMons.push({ ref, data });
    }

    await decrementCharacterItems(tx, db, fromUid, fromCid, fromOffer.items);
    await decrementCharacterItems(tx, db, me, characterId, toOffer.items);

    for (const { ref } of fromMons) tx.delete(ref);
    for (const { ref } of toMons) tx.delete(ref);

    await incrementCharacterItems(tx, db, me, characterId, fromOffer.items);
    await incrementCharacterItems(tx, db, fromUid, fromCid, toOffer.items);

    for (const { data } of fromMons) {
      const { mon } = applyTradeEvolutionToMon(data, biomeTo, merged);
      const dest = toBoxCol.doc();
      tx.set(dest, {
        ...ensureStableInstanceId(mon),
        receivedFromUid: fromUid,
        receivedViaFriendTrade: true,
        tradeCompletedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    for (const { data } of toMons) {
      const { mon } = applyTradeEvolutionToMon(data, biomeFrom, merged);
      const dest = fromBoxCol.doc();
      tx.set(dest, {
        ...ensureStableInstanceId(mon),
        receivedFromUid: me,
        receivedViaFriendTrade: true,
        tradeCompletedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    tx.set(
      tRef,
      {
        status: "completed",
        toCharacterId: characterId,
        toOffer,
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    logger.error("completeFriendTrade_failed", { tradeId, err: e?.message || String(e), stack: e?.stack });
    throw new HttpsError("internal", e?.message ? String(e.message) : "Erro ao concluir troca.");
  }

  logger.info("completeFriendTrade", { tradeId, toUid: me });
  return { ok: true, message: "Troca concluida." };
});

exports.cancelFriendTrade = onCall(REGION, async (request) => {
  const me = await resolveCallableUid(request);
  const tradeId = String(request.data?.tradeId || "").trim();
  if (!tradeId) throw new HttpsError("invalid-argument", "tradeId obrigatorio.");

  const db = getFirestore();
  const ref = db.doc(`friendTrades/${tradeId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Troca nao encontrada.");
  const row = snap.data() || {};
  if (row.fromUid !== me && row.toUid !== me) throw new HttpsError("permission-denied", "Sem permissao.");
  if (String(row.status) !== "awaiting_peer") {
    throw new HttpsError("failed-precondition", "Esta troca nao pode ser cancelada.");
  }
  await ref.set(
    {
      status: "cancelled",
      cancelledByUid: me,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return { ok: true };
});

// ---------------------------------------------------------------------------
// Troca ao vivo (1 Pokémon / lado, confirmação dupla, UI modal)
// ---------------------------------------------------------------------------

function pickPublicFromMonData(data) {
  const speciesId = Math.max(1, Math.trunc(Number(data.speciesId || 0)));
  const speciesName = String(data.speciesName || "").trim() || `Espécie ${speciesId}`;
  const nickname = String(data.nickname || "").trim();
  return { speciesId, speciesName, nickname: nickname || null };
}

function receivedSummaryFromMon(mon) {
  const speciesId = Math.max(1, Math.trunc(Number(mon.speciesId || 0)));
  return {
    speciesId,
    speciesName: String(mon.speciesName || "").trim(),
    nickname: String(mon.nickname || "").trim() || null,
    friendship: Math.max(pe.FRIENDSHIP_MIN, Math.min(pe.FRIENDSHIP_MAX, Math.trunc(Number(mon.friendship ?? pe.FRIENDSHIP_DEFAULT)))),
  };
}

/** Pokémon recebido por troca entre jogadores: -10% felicidade (mínimo respeitado). */
function applyFriendTradeFriendshipPenalty(mon) {
  const cur = Math.max(
    pe.FRIENDSHIP_MIN,
    Math.min(pe.FRIENDSHIP_MAX, Math.trunc(Number(mon.friendship ?? pe.FRIENDSHIP_DEFAULT)))
  );
  const next = Math.max(pe.FRIENDSHIP_MIN, Math.floor(cur * 0.9));
  return { ...mon, friendship: next };
}

async function cancelLiveLobbyTradesForPair(db, a, b) {
  const col = db.collection("friendTrades");
  const [s1, s2] = await Promise.all([
    col.where("tradeMode", "==", "live").where("status", "==", "lobby").where("fromUid", "==", a).where("toUid", "==", b).get(),
    col.where("tradeMode", "==", "live").where("status", "==", "lobby").where("fromUid", "==", b).where("toUid", "==", a).get(),
  ]);
  const batch = db.batch();
  let n = 0;
  for (const d of [...s1.docs, ...s2.docs]) {
    batch.set(
      d.ref,
      { status: "cancelled", cancelledByUid: a, cancelReason: "replaced_by_new_live_trade", updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    n += 1;
    if (n >= 400) break;
  }
  if (n > 0) await batch.commit();
}

exports.createLiveFriendTrade = onCall(REGION, async (request) => {
  const me = await resolveCallableUid(request);
  const toUid = String(request.data?.toUid || "").trim();
  const characterId = String(request.data?.characterId || "").trim();
  if (!toUid || !characterId) {
    throw new HttpsError("invalid-argument", "toUid e characterId sao obrigatorios.");
  }
  const db = getFirestore();
  await assertFriends(db, me, toUid);
  const charSnap = await db.doc(`players/${me}/characters/${characterId}`).get();
  if (!charSnap.exists) throw new HttpsError("not-found", "Personagem nao encontrado.");
  await cancelLiveLobbyTradesForPair(db, me, toUid);
  const tradeRef = db.collection("friendTrades").doc();
  const expiresAt = new Date(Date.now() + TRADE_TTL_MS);
  await tradeRef.set({
    tradeMode: "live",
    fromUid: me,
    toUid,
    fromCharacterId: characterId,
    toCharacterId: "",
    fromBoxDocId: null,
    toBoxDocId: null,
    fromPickPublic: null,
    toPickPublic: null,
    fromConfirmed: false,
    toConfirmed: false,
    status: "lobby",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    expiresAt,
  });
  logger.info("createLiveFriendTrade", { tradeId: tradeRef.id, fromUid: me, toUid });
  return { ok: true, tradeId: tradeRef.id };
});

exports.joinLiveFriendTrade = onCall(REGION, async (request) => {
  const me = await resolveCallableUid(request);
  const tradeId = String(request.data?.tradeId || "").trim();
  const characterId = String(request.data?.characterId || "").trim();
  if (!tradeId || !characterId) {
    throw new HttpsError("invalid-argument", "tradeId e characterId sao obrigatorios.");
  }
  const db = getFirestore();
  await db.runTransaction(async (tx) => {
    const tRef = db.doc(`friendTrades/${tradeId}`);
    const tSnap = await tx.get(tRef);
    if (!tSnap.exists) throw new HttpsError("not-found", "Troca nao encontrada.");
    const tr = tSnap.data() || {};
    if (String(tr.tradeMode) !== "live") throw new HttpsError("failed-precondition", "Troca invalida.");
    if (String(tr.toUid) !== me) throw new HttpsError("permission-denied", "Somente o convidado pode entrar nesta troca.");
    if (String(tr.status) !== "lobby") throw new HttpsError("failed-precondition", "Esta troca nao esta aberta.");
    const exp = tr.expiresAt;
    const expMs = exp && typeof exp.toMillis === "function" ? exp.toMillis() : 0;
    if (expMs > 0 && expMs < Date.now()) {
      tx.set(tRef, { status: "expired", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      throw new HttpsError("failed-precondition", "Troca expirada.");
    }
    const charRef = db.doc(`players/${me}/characters/${characterId}`);
    const charSnap = await tx.get(charRef);
    if (!charSnap.exists) throw new HttpsError("not-found", "Personagem nao encontrado.");
    const existing = String(tr.toCharacterId || "").trim();
    if (existing && existing !== characterId) {
      throw new HttpsError("failed-precondition", "Outro personagem ja entrou nesta troca.");
    }
    if (!existing) {
      tx.set(tRef, { toCharacterId: characterId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
  });
  return { ok: true };
});

exports.setLiveFriendTradePick = onCall(REGION, async (request) => {
  const me = await resolveCallableUid(request);
  const tradeId = String(request.data?.tradeId || "").trim();
  const rawBox = request.data?.boxDocId;
  const boxDocId = rawBox == null || rawBox === "" ? "" : String(rawBox).trim();
  if (!tradeId) throw new HttpsError("invalid-argument", "tradeId obrigatorio.");

  const db = getFirestore();
  await db.runTransaction(async (tx) => {
    const tRef = db.doc(`friendTrades/${tradeId}`);
    const tSnap = await tx.get(tRef);
    if (!tSnap.exists) throw new HttpsError("not-found", "Troca nao encontrada.");
    const tr = tSnap.data() || {};
    if (String(tr.tradeMode) !== "live") throw new HttpsError("failed-precondition", "Troca invalida.");
    if (String(tr.status) !== "lobby") throw new HttpsError("failed-precondition", "Esta troca nao aceita novas escolhas.");
    const fromUid = String(tr.fromUid);
    const toUid = String(tr.toUid);
    if (fromUid !== me && toUid !== me) throw new HttpsError("permission-denied", "Sem permissao.");
    const exp = tr.expiresAt;
    const expMs = exp && typeof exp.toMillis === "function" ? exp.toMillis() : 0;
    if (expMs > 0 && expMs < Date.now()) {
      tx.set(tRef, { status: "expired", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      throw new HttpsError("failed-precondition", "Troca expirada.");
    }

    const isFrom = fromUid === me;
    const fromCid = String(tr.fromCharacterId || "");
    const toCid = String(tr.toCharacterId || "");
    const myCharId = isFrom ? fromCid : toCid;
    if (!myCharId) {
      throw new HttpsError("failed-precondition", "Defina o personagem na troca antes de escolher o Pokémon.");
    }

    if (!boxDocId) {
      tx.set(
        tRef,
        {
          ...(isFrom ? { fromBoxDocId: null, fromPickPublic: null } : { toBoxDocId: null, toPickPublic: null }),
          fromConfirmed: false,
          toConfirmed: false,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return;
    }

    const boxCol = db.collection(`players/${me}/characters/${myCharId}/box`);
    const boxRef = boxCol.doc(boxDocId);
    const boxSnap = await tx.get(boxRef);
    if (!boxSnap.exists) throw new HttpsError("failed-precondition", "Pokémon nao encontrado na sua BOX.");
    const data = boxSnap.data() || {};
    if (Boolean(data.isStarter)) throw new HttpsError("failed-precondition", "Pokemon inicial nao pode ser trocado.");
    if (Math.trunc(Number(data.speciesId || 0)) <= 0) throw new HttpsError("failed-precondition", "Slot de BOX invalido.");

    const preview = pickPublicFromMonData(data);
    tx.set(
      tRef,
      {
        ...(isFrom ? { fromBoxDocId: boxDocId, fromPickPublic: preview } : { toBoxDocId: boxDocId, toPickPublic: preview }),
        fromConfirmed: false,
        toConfirmed: false,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });
  return { ok: true };
});

exports.confirmLiveFriendTrade = onCall(REGION, async (request) => {
  const me = await resolveCallableUid(request);
  const tradeId = String(request.data?.tradeId || "").trim();
  if (!tradeId) throw new HttpsError("invalid-argument", "tradeId obrigatorio.");

  const db = getFirestore();
  let merged;
  try {
    merged = await loadMergedEvolutionRules(db);
  } catch (e) {
    logger.error("confirmLiveFriendTrade_loadRules", e);
    throw new HttpsError("internal", "Falha ao carregar regras de evolucao.");
  }

  let response = { ok: true };

  try {
    await db.runTransaction(async (tx) => {
      const tRef = db.doc(`friendTrades/${tradeId}`);
      const tSnap = await tx.get(tRef);
      if (!tSnap.exists) throw new HttpsError("not-found", "Troca nao encontrada.");
      const tr = tSnap.data() || {};
      if (String(tr.tradeMode) !== "live") throw new HttpsError("failed-precondition", "Troca invalida.");
      const fromUid = String(tr.fromUid);
      const toUid = String(tr.toUid);
      if (fromUid !== me && toUid !== me) throw new HttpsError("permission-denied", "Sem permissao.");

      if (String(tr.status) === "completed") {
        response = {
          ok: true,
          alreadyCompleted: true,
          fromReceivedSummary: tr.fromReceivedSummary || null,
          toReceivedSummary: tr.toReceivedSummary || null,
        };
        return;
      }
      if (String(tr.status) !== "lobby") {
        throw new HttpsError("failed-precondition", "Esta troca nao pode ser confirmada.");
      }

      const exp = tr.expiresAt;
      const expMs = exp && typeof exp.toMillis === "function" ? exp.toMillis() : 0;
      if (expMs > 0 && expMs < Date.now()) {
        tx.set(tRef, { status: "expired", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        throw new HttpsError("failed-precondition", "Troca expirada.");
      }

      const fromCid = String(tr.fromCharacterId || "");
      const toCid = String(tr.toCharacterId || "");
      const fromBoxDocId = String(tr.fromBoxDocId || "").trim();
      const toBoxDocId = String(tr.toBoxDocId || "").trim();
      if (!fromCid || !toCid || !fromBoxDocId || !toBoxDocId) {
        throw new HttpsError("failed-precondition", "Ambos precisam escolher um Pokémon e o convidado precisa ter entrado na troca.");
      }

      let fromConfirmed = !!tr.fromConfirmed;
      let toConfirmed = !!tr.toConfirmed;
      if (fromUid === me) fromConfirmed = true;
      else toConfirmed = true;

      if (!fromConfirmed || !toConfirmed) {
        tx.set(
          tRef,
          {
            fromConfirmed,
            toConfirmed,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        response = { ok: true, awaitingPeerConfirm: true, fromConfirmed, toConfirmed };
        return;
      }

      const friendEdge = await tx.get(db.doc(`players/${fromUid}/friends/${toUid}`));
      if (!friendEdge.exists) {
        throw new HttpsError("failed-precondition", "Amizade nao encontrada; troca cancelada.");
      }

      const charFromRef = db.doc(`players/${fromUid}/characters/${fromCid}`);
      const charToRef = db.doc(`players/${toUid}/characters/${toCid}`);
      const [charFromSnap, charToSnap] = await Promise.all([tx.get(charFromRef), tx.get(charToRef)]);
      if (!charFromSnap.exists || !charToSnap.exists) {
        throw new HttpsError("not-found", "Personagem de um dos lados nao encontrado.");
      }

      const biomeFrom = pe.normalizeBiomeId(charFromSnap.data()?.biomeAtualId);
      const biomeTo = pe.normalizeBiomeId(charToSnap.data()?.biomeAtualId);

      const fromBoxCol = db.collection(`players/${fromUid}/characters/${fromCid}/box`);
      const toBoxCol = db.collection(`players/${toUid}/characters/${toCid}/box`);

      const fromRef = fromBoxCol.doc(fromBoxDocId);
      const toRef = toBoxCol.doc(toBoxDocId);
      const [fromSnap, toSnap] = await Promise.all([tx.get(fromRef), tx.get(toRef)]);
      if (!fromSnap.exists || !toSnap.exists) {
        throw new HttpsError("failed-precondition", "Pokémon de um dos lados sumiu da BOX.");
      }
      const fromData = fromSnap.data() || {};
      const toData = toSnap.data() || {};
      if (Boolean(fromData.isStarter) || Boolean(toData.isStarter)) {
        throw new HttpsError("failed-precondition", "Pokemon inicial nao pode ser trocado.");
      }
      if (Math.trunc(Number(fromData.speciesId || 0)) <= 0 || Math.trunc(Number(toData.speciesId || 0)) <= 0) {
        throw new HttpsError("failed-precondition", "BOX invalida.");
      }

      tx.delete(fromRef);
      tx.delete(toRef);

      const { mon: monToFrom } = applyTradeEvolutionToMon(toData, biomeFrom, merged);
      const { mon: monFromTo } = applyTradeEvolutionToMon(fromData, biomeTo, merged);

      const monForReceiverFrom = applyFriendTradeFriendshipPenalty(monToFrom);
      const monForReceiverTo = applyFriendTradeFriendshipPenalty(monFromTo);

      const destFrom = fromBoxCol.doc();
      const destTo = toBoxCol.doc();
      tx.set(destFrom, {
        ...ensureStableInstanceId(monForReceiverFrom),
        receivedFromUid: toUid,
        receivedViaFriendTrade: true,
        tradeCompletedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.set(destTo, {
        ...ensureStableInstanceId(monForReceiverTo),
        receivedFromUid: fromUid,
        receivedViaFriendTrade: true,
        tradeCompletedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      const fromReceivedSummary = receivedSummaryFromMon(monForReceiverFrom);
      const toReceivedSummary = receivedSummaryFromMon(monForReceiverTo);

      tx.set(
        tRef,
        {
          status: "completed",
          fromConfirmed: true,
          toConfirmed: true,
          completedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          fromReceivedSummary,
          toReceivedSummary,
        },
        { merge: true }
      );

      response = {
        ok: true,
        completed: true,
        fromReceivedSummary,
        toReceivedSummary,
      };
    });
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    logger.error("confirmLiveFriendTrade_failed", { tradeId, err: e?.message || String(e), stack: e?.stack });
    throw new HttpsError("internal", e?.message ? String(e.message) : "Falha ao concluir a troca.");
  }

  logger.info("confirmLiveFriendTrade", { tradeId, me });
  return response;
});

exports.cancelLiveFriendTrade = onCall(REGION, async (request) => {
  const me = await resolveCallableUid(request);
  const tradeId = String(request.data?.tradeId || "").trim();
  if (!tradeId) throw new HttpsError("invalid-argument", "tradeId obrigatorio.");

  const db = getFirestore();
  const ref = db.doc(`friendTrades/${tradeId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Troca nao encontrada.");
  const row = snap.data() || {};
  if (String(row.tradeMode) !== "live") throw new HttpsError("failed-precondition", "Troca invalida.");
  if (row.fromUid !== me && row.toUid !== me) throw new HttpsError("permission-denied", "Sem permissao.");
  if (String(row.status) !== "lobby") {
    throw new HttpsError("failed-precondition", "Esta troca nao pode ser cancelada.");
  }
  await ref.set(
    {
      status: "cancelled",
      cancelledByUid: me,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return { ok: true };
});
