const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { ensureStableInstanceId } = require("./pokemonDocIdentity");
const { resolveCallableUid } = require("./callableUid");
const { expToNextForSpeciesAtLevel, normalizeExpBarCurrentForSpeciesLevel } = require("./experienceExp");
const { updatePokemonExpForAdmin } = require("./expWriteCanonical");

let pe;
try {
  pe = require("./lib/pokemonEvolution.cjs");
} catch (e) {
  console.error(
    "[evolvePokemon] Falha ao carregar lib/pokemonEvolution.cjs. Rode: node admin/scripts/bundle-evolution.mjs",
    e?.message || e
  );
  throw e;
}

/** Regras estáticas + `evolutionConfigRules` (admin). Cache por instância fria. */
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

/**
 * Evolução validada no servidor: regras do catálogo + extras Firestore + consumo de item quando necessário.
 * Bioma vem do Firestore do personagem (biomeAtualId), nunca do client.
 * @param {{ characterId: string, slotIndex: number, evolutionItemId?: string|null, chosenToSpeciesId?: number|null }} data
 */
exports.evolvePokemon = onCall({ region: "southamerica-east1" }, async (request) => {
  const uid = await resolveCallableUid(request);
  const data = request.data && typeof request.data === "object" ? request.data : {};
  const characterId = String(data.characterId || "").trim();
  const slotIndex = Math.max(1, Math.min(6, Math.floor(Number(data.slotIndex || 0))));
  const evolutionItemIdRaw =
    data.evolutionItemId != null && String(data.evolutionItemId).trim() !== ""
      ? String(data.evolutionItemId).trim().toLowerCase()
      : "";
  const evolutionItemId = evolutionItemIdRaw || null;
  const chosenToSpeciesId =
    data.chosenToSpeciesId != null && Number.isFinite(Number(data.chosenToSpeciesId))
      ? Math.max(1, Math.trunc(Number(data.chosenToSpeciesId)))
      : null;
  const hookedSpeciesIdFromClient =
    data.hookedSpeciesId != null && Number.isFinite(Number(data.hookedSpeciesId))
      ? Math.max(0, Math.trunc(Number(data.hookedSpeciesId)))
      : null;

  if (!characterId || slotIndex < 1) {
    throw new HttpsError("invalid-argument", "characterId e slotIndex (1-6) sao obrigatorios.");
  }

  const db = getFirestore();
  const merged = await loadMergedEvolutionRules(db);
  const slotRef = db.doc(`players/${uid}/characters/${characterId}/time/slot_${slotIndex}`);
  const charRef = db.doc(`players/${uid}/characters/${characterId}`);

  let logFromSpecies = 0;
  let logToSpecies = 0;

  await db.runTransaction(async (tx) => {
    const [snap, charSnap] = await Promise.all([tx.get(slotRef), tx.get(charRef)]);
    if (!charSnap.exists) {
      throw new HttpsError("not-found", "Personagem nao encontrado.");
    }
    const charData = charSnap.data() || {};
    const biomeId = pe.normalizeBiomeId(charData.biomeAtualId);

    if (!snap.exists) {
      throw new HttpsError("not-found", "Pokemon nao encontrado.");
    }
    const mon = snap.data();
    const currentSpeciesId = Math.max(1, Math.trunc(Number(mon.speciesId || 0)));
    const level = Math.max(1, Math.trunc(Number(mon.level || 1)));
    const st = mon.stats || {};
    logFromSpecies = currentSpeciesId;
    const heldRaw = mon.heldItemId != null && String(mon.heldItemId).trim() !== "" ? String(mon.heldItemId) : mon.itemId;
    const heldItemId =
      heldRaw != null && String(heldRaw).trim() !== "" ? String(heldRaw).trim().toLowerCase().replace(/_/g, "-") : null;
    const hookedForCtx =
      currentSpeciesId === 79 && hookedSpeciesIdFromClient != null && hookedSpeciesIdFromClient > 0
        ? hookedSpeciesIdFromClient
        : null;

    const ctx = pe.buildEvolutionContext({
      speciesId: currentSpeciesId,
      level,
      friendship: Number(mon.friendship ?? pe.FRIENDSHIP_DEFAULT),
      knownMoves: Array.isArray(mon.moves) ? mon.moves : [],
      moveHistory: Array.isArray(mon.moveHistory) ? mon.moveHistory : [],
      relearnableMoves: Array.isArray(mon.relearnableMoves) ? mon.relearnableMoves : [],
      biomeId,
      itemId: evolutionItemId,
      heldItemId,
      hookedSpeciesId: hookedForCtx,
      chosenToSpeciesId,
      utcTimestampMs: Date.now(),
      statsAtk: st.atk != null ? Math.trunc(Number(st.atk)) : undefined,
      statsDefense: st.def != null ? Math.trunc(Number(st.def)) : undefined,
      gender: mon.gender != null && String(mon.gender).trim() !== "" ? String(mon.gender) : undefined,
      abilityId: mon.abilityId != null && String(mon.abilityId).trim() !== "" ? String(mon.abilityId) : null,
    });

    const matches = pe.listMatchingEvolutionTargets(ctx, merged);
    if (matches.length === 0) {
      throw new HttpsError("failed-precondition", pe.describeEvolutionBlockReason(ctx, merged));
    }

    let toSpeciesId = pe.resolveEvolutionTarget(ctx, merged);
    if (!toSpeciesId && currentSpeciesId === 265) {
      const wurmpleTargets = matches.filter((sid) => sid === 266 || sid === 268);
      if (wurmpleTargets.length) {
        toSpeciesId = wurmpleTargets[Math.floor(Math.random() * wurmpleTargets.length)];
      }
    }
    if (!toSpeciesId) {
      throw new HttpsError(
        "failed-precondition",
        "Varias evolucoes sao possiveis. Escolha o destino (chosenToSpeciesId) ou use o item correto."
      );
    }
    logToSpecies = toSpeciesId;

    const ruleList = merged[currentSpeciesId] || [];
    const usedRule = ruleList.find((r) => r.toSpeciesId === toSpeciesId && pe.ruleMatches(ctx, r));
    if (!usedRule) {
      throw new HttpsError("internal", "Regra de evolucao inconsistente.");
    }

    if (usedRule.itemId) {
      const need = String(usedRule.itemId).trim().toLowerCase();
      if (!evolutionItemId || evolutionItemId !== need) {
        throw new HttpsError("failed-precondition", `Use o item correto na Mochila: ${need}.`);
      }
      const itemRef = db.doc(`players/${uid}/characters/${characterId}/itens/${need}`);
      const itemSnap = await tx.get(itemRef);
      const qty = Math.max(0, Math.trunc(Number(itemSnap.data()?.quantity || 0)));
      if (qty < 1) {
        throw new HttpsError("failed-precondition", "Voce nao possui esse item.");
      }
      const metaRef = db.doc(`players/${uid}/characters/${characterId}/itens/_meta`);
      const metaSnap = await tx.get(metaRef);
      const nextQty = qty - 1;
      if (nextQty <= 0) {
        tx.delete(itemRef);
      } else {
        tx.update(itemRef, { quantity: nextQty, updatedAt: FieldValue.serverTimestamp() });
      }
      const total = Math.max(0, Math.trunc(Number(metaSnap.data()?.totalQuantity || 0)));
      tx.set(
        metaRef,
        {
          totalQuantity: Math.max(0, total - 1),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
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

    const idPatch = ensureStableInstanceId(mon);
    const ex = mon.exp && typeof mon.exp === "object" ? mon.exp : {};
    const expCurrentRaw = Math.max(0, Math.trunc(Number(ex.current) || 0));
    const expCurrent = normalizeExpBarCurrentForSpeciesLevel(toSpeciesId, level, expCurrentRaw);
    const expToNext = expToNextForSpeciesAtLevel(toSpeciesId, level);
    tx.update(slotRef, {
      ...(String(mon.stableInstanceId || "").trim().length >= 16
        ? {}
        : { stableInstanceId: idPatch.stableInstanceId }),
      speciesId: toSpeciesId,
      speciesName: newSpeciesName,
      nickname: nextNickname,
      nicknameEdited,
      abilityId: nextAbilityId ?? mon.abilityId ?? "",
      pendingEvolution: FieldValue.delete(),
      ...updatePokemonExpForAdmin(expCurrent, expToNext),
      ...(real
        ? {
            stats: {
              atk: real.atk,
              def: real.def,
              spa: real.spa,
              spd: real.spd,
              spe: real.spe,
            },
            hp: { current: newHpCurrent, total: newHpTotal },
          }
        : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  logger.info("evolvePokemon:success", {
    uid,
    characterId,
    slotIndex,
    fromSpeciesId: logFromSpecies,
    toSpeciesId: logToSpecies,
    usedItem: Boolean(evolutionItemId),
  });

  return { ok: true, message: "Evolucao concluida." };
});
