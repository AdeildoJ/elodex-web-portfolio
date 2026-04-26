/**
 * Cloud Function: grava entradas em `battleHistory` dos dois participantes
 * quando um `battleRooms/{roomId}` muda para `finished`.
 *
 * Estrutura criada em cada participante:
 *   players/{uid}/characters/{characterId}/battleHistory/{entryId}
 *
 * Fontes:
 *   - `battleRooms/{roomId}`: owner/challenger uids + characterIds, status,
 *     `pvpLastBattleResult`, `coliseuRoomId`, `startedAt`/`finishedAt`.
 *   - `coliseu_rooms/{coliseuRoomId}` (opcional): `name`, `bet`, `maxPokemons`,
 *     `maxLevel`, `creatorTrainerName`, `opponent.trainerName`.
 *
 * Idempotência: se a entrada já existe para o mesmo roomId no histórico do
 * participante, não é reescrita. Usamos `roomId` como documentId estável.
 */

const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeString(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return String(value);
}

function computeDuration(afterData) {
  const startedAt = afterData?.startedAt;
  const finishedAt = afterData?.finishedAt;
  if (!startedAt || !finishedAt) return null;
  const startMs = typeof startedAt.toMillis === "function" ? startedAt.toMillis() : num(startedAt);
  const finMs = typeof finishedAt.toMillis === "function" ? finishedAt.toMillis() : num(finishedAt);
  if (!startMs || !finMs || finMs < startMs) return null;
  return finMs - startMs;
}

function toResultForSide(battleResult, side) {
  const result = safeString(battleResult?.result || battleResult?.outcome).toLowerCase();
  const winnerSide = safeString(battleResult?.winnerSide || battleResult?.winner).toLowerCase();

  if (result === "draw" || result === "tie") return "draw";
  if (result === "abandoned") {
    const abandonedBy = safeString(battleResult?.abandonedBy).toLowerCase();
    if (abandonedBy && abandonedBy !== side) return "victory";
    if (abandonedBy === side) return "defeat";
    return "abandoned";
  }
  if (winnerSide === side) return "victory";
  if (winnerSide && winnerSide !== side) return "defeat";
  return "defeat";
}

function normalizeBetForWinnerLoser(coliseuBet, winnerSide, side) {
  if (!coliseuBet || typeof coliseuBet !== "object") {
    return {
      coinsWon: 0,
      coinsLost: 0,
      ecoinWon: 0,
      ecoinLost: 0,
      itemsWon: [],
      itemsLost: [],
    };
  }
  const coinsWin = Math.max(0, Math.trunc(num(coliseuBet.coinsWin, 0)));
  const coinsLose = Math.max(0, Math.trunc(num(coliseuBet.coinsLose, 0)));
  const ecoinStake = Math.max(0, Math.trunc(num(coliseuBet.ecoin, 0)));
  const items = Array.isArray(coliseuBet.items) ? coliseuBet.items : [];
  const itemsNorm = items
    .map((it) => ({
      itemId: safeString(it?.itemId).trim(),
      qty: Math.max(0, Math.trunc(num(it?.qty, 0))),
    }))
    .filter((it) => it.itemId && it.qty > 0);

  const isWinner = winnerSide && side === winnerSide;
  const isLoser = winnerSide && side !== winnerSide;

  // Regra atual: ambos os lados recebem PokeCoins (vencedor `coinsWin`,
  // perdedor `coinsLose` como consolação). Então `coinsWon` passa a ser
  // preenchido também para o perdedor, e `coinsLost` fica sempre 0 para
  // PokeCoins. ECoin/itens continuam podendo ser apostados/perdidos.
  return {
    coinsWon: isWinner ? coinsWin : isLoser ? coinsLose : 0,
    coinsLost: 0,
    ecoinWon: isWinner ? ecoinStake : 0,
    ecoinLost: isLoser ? ecoinStake : 0,
    itemsWon: isWinner ? itemsNorm : [],
    itemsLost: isLoser ? itemsNorm : [],
  };
}

async function fetchColiseuRoomData(db, coliseuRoomId) {
  if (!coliseuRoomId) return null;
  try {
    const snap = await db.doc(`coliseu_rooms/${coliseuRoomId}`).get();
    if (!snap.exists) return null;
    return snap.data() || null;
  } catch (err) {
    logger.warn("coliseuBattleHistory_fetchColiseuRoomFailed", { coliseuRoomId, err: String(err) });
    return null;
  }
}

async function writeSideEntry(db, { uid, characterId, entryId, payload }) {
  if (!uid || !characterId) return;
  const ref = db
    .doc(`players/${uid}/characters/${characterId}/battleHistory/${entryId}`);
  const existing = await ref.get();
  if (existing.exists) return; // Idempotência
  await ref.set(payload, { merge: false });
}

async function handleBattleRoomUpdate(event) {
  const change = event.data;
  if (!change) return;
  const before = change.before?.data?.() || {};
  const after = change.after?.data?.() || {};
  if (!after || typeof after !== "object") return;

  const wasFinished = safeString(before?.status) === "finished";
  const isFinished = safeString(after?.status) === "finished";
  if (!isFinished || wasFinished) return;

  const roomId = String(event.params?.roomId || change.after?.id || "");
  if (!roomId) return;

  const ownerUid = safeString(after.ownerUid);
  const ownerCharacterId = safeString(after.ownerCharacterId);
  const challengerUid = safeString(after.challengerUid);
  const challengerCharacterId = safeString(after.challengerCharacterId);
  if (!ownerUid || !challengerUid) {
    logger.warn("coliseuBattleHistory_missingParticipants", { roomId });
    return;
  }

  const db = getFirestore();
  const coliseuRoomId = safeString(after.coliseuRoomId) || safeString(after.coliseu_room_id);
  const coliseuRoom = await fetchColiseuRoomData(db, coliseuRoomId);

  const battleResult = after.pvpLastBattleResult || after.battleResult || null;
  const winnerSide = safeString(battleResult?.winnerSide || battleResult?.winner).toLowerCase();
  const bet = coliseuRoom?.bet || null;

  const durationMs = computeDuration(after);
  const pokemonLimit = Math.max(1, Math.min(6, num(coliseuRoom?.maxPokemons, num(after?.maxPokemons, 1))));
  const maxLevel = Math.max(1, Math.min(100, num(coliseuRoom?.maxLevel, num(after?.maxLevel, 100))));
  const roomName = safeString(coliseuRoom?.name) || null;

  const ownerTrainerName =
    safeString(coliseuRoom?.creatorTrainerName) ||
    safeString(after?.ownerTrainerName) ||
    "Treinador";
  const challengerTrainerName =
    safeString(coliseuRoom?.opponent?.trainerName) ||
    safeString(after?.challengerTrainerName) ||
    "Treinador";

  const now = FieldValue.serverTimestamp();
  const hadBet =
    !!bet &&
    (num(bet.ecoin, 0) > 0 || (Array.isArray(bet.items) && bet.items.length > 0));

  const entryId = `coliseu-${roomId}`;

  const ownerPayload = {
    source: "coliseu",
    roomId,
    roomName,
    opponentUid: challengerUid,
    opponentTrainerName: challengerTrainerName,
    opponentRegion: safeString(coliseuRoom?.opponent?.region) || null,
    pokemonLimit,
    maxLevel,
    result: toResultForSide(battleResult, "owner"),
    durationMs,
    hadBet,
    bet: hadBet ? normalizeBetForWinnerLoser(bet, winnerSide, "owner") : null,
    createdAt: now,
    finishedAt: now,
  };

  const challengerPayload = {
    ...ownerPayload,
    opponentUid: ownerUid,
    opponentTrainerName: ownerTrainerName,
    opponentRegion: safeString(coliseuRoom?.creatorRegion) || null,
    result: toResultForSide(battleResult, "challenger"),
    bet: hadBet ? normalizeBetForWinnerLoser(bet, winnerSide, "challenger") : null,
  };

  try {
    await Promise.all([
      writeSideEntry(db, {
        uid: ownerUid,
        characterId: ownerCharacterId,
        entryId,
        payload: ownerPayload,
      }),
      writeSideEntry(db, {
        uid: challengerUid,
        characterId: challengerCharacterId,
        entryId,
        payload: challengerPayload,
      }),
    ]);
  } catch (err) {
    logger.error("coliseuBattleHistory_writeFailed", { roomId, err: String(err) });
  }
}

exports.coliseuBattleHistoryOnFinish = onDocumentUpdated(
  {
    document: "battleRooms/{roomId}",
    region: "southamerica-east1",
  },
  handleBattleRoomUpdate
);
