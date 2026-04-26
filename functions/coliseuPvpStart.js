/**
 * Coliseu PvP — arranque da batalha e liquidação automática.
 *
 * Expõe DOIS componentes:
 *
 * 1) `startColiseuPvpBattleHttp` (HTTP Bearer, v2 onRequest)
 *    Invocado pelo owner quando ambos os treinadores estão `pickReady`.
 *    Lê os dois `privatePicks/{uid}.battleTeam` (serializados pelo cliente
 *    via `teamAdapter.toBattleMonster`), valida invariantes básicos
 *    (mesmo maxPokemons, level máximo, HP > 0 em pelo menos um monstro por
 *    lado, moves presentes), e cria `battleRooms/{roomId}` com o snapshot
 *    inicial canônico. Atualiza `coliseu_rooms` com `linkedBattleRoomId` e
 *    `status: "in_battle"` na mesma transação.
 *
 *    A criação server-side dá ao backend controle do id do battleRoom,
 *    da `pvpResolutionEpoch` inicial e da versão do snapshot; o cliente
 *    só observa e aplica resoluções.
 *
 * 2) `coliseuAutoSettleOnFinish` (onDocumentUpdated em `battleRooms`)
 *    Dispara quando `status` transiciona para `"finished"`. Invoca
 *    internamente `executeSettleColiseuPvp` (da `phase2Mutations`) para
 *    transferir moedas/ecoin/itens do perdedor ao vencedor. A própria
 *    função é idempotente (`coliseuPvpCurrencySettled`), então múltiplos
 *    acionamentos são seguros.
 *
 * Região: southamerica-east1, alinhada ao resto do backend.
 */

const { onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const logger = require("firebase-functions/logger");
const phase2Mutations = require("./phase2Mutations");
const pvpLearnset = require("./pvpLearnset");

const REGION = { region: "southamerica-east1" };

const BATTLE_ROOMS_COLLECTION = "battleRooms";
const COLISEU_ROOMS_COLLECTION = "coliseu_rooms";

function asNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bodyWithoutIdToken(req) {
  let raw = req.body;
  if (Buffer.isBuffer(raw)) {
    try { raw = JSON.parse(raw.toString("utf8")); } catch { raw = {}; }
  } else if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) raw = {}; else { try { raw = JSON.parse(t); } catch { raw = {}; } }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) raw = {};
  const body = { ...raw };
  delete body.idToken;
  return body;
}

async function uidFromBearer(req) {
  const authHeader = req.get("authorization") || req.get("Authorization") || "";
  const match = typeof authHeader === "string" ? authHeader.match(/^Bearer (.*)$/i) : null;
  const idToken = match ? String(match[1] || "").trim() : "";
  if (!idToken) throw new HttpsError("unauthenticated", "Token ausente.");
  const decoded = await getAuth().verifyIdToken(idToken);
  const uid = String(decoded?.uid || "").trim();
  if (!uid) throw new HttpsError("unauthenticated", "Token invalido.");
  return uid;
}

/**
 * Valida que o array tem a forma esperada de `BattleMonster[]`:
 * - length `expectedCount`
 * - cada item tem speciesId, level 1..100, hpCurrent > 0 (todos), hpTotal > 0,
 *   stats completos, types array, moves array com id e ppMax.
 * Retorna a primeira mensagem de erro ou null se ok.
 */
function validateBattleTeam(team, expectedCount, maxLevel) {
  if (!Array.isArray(team)) return "battleTeam ausente ou invalido.";
  if (team.length !== expectedCount) {
    return `O time deve ter exatamente ${expectedCount} Pokemon (recebido ${team.length}).`;
  }
  let anyAlive = false;
  for (let i = 0; i < team.length; i++) {
    const m = team[i];
    if (!m || typeof m !== "object") return `Pokemon ${i + 1} invalido (nao e objeto).`;
    const sid = asNumber(m.speciesId, 0);
    if (sid <= 0) return `Pokemon ${i + 1} sem speciesId.`;
    const lv = asNumber(m.level, 0);
    if (lv < 1 || lv > 100) return `Pokemon ${i + 1} com nivel invalido.`;
    if (lv > asNumber(maxLevel, 100)) {
      return `Pokemon ${i + 1} excede o nivel maximo da sala (${maxLevel}).`;
    }
    const hpTotal = asNumber(m.hpTotal, 0);
    if (hpTotal <= 0) return `Pokemon ${i + 1} sem hpTotal valido.`;
    const hpCurrent = asNumber(m.hpCurrent, 0);
    if (hpCurrent < 0) return `Pokemon ${i + 1} com hpCurrent invalido.`;
    if (hpCurrent > hpTotal) return `Pokemon ${i + 1} com hpCurrent > hpTotal.`;
    if (hpCurrent > 0) anyAlive = true;
    if (!m.stats || typeof m.stats !== "object") return `Pokemon ${i + 1} sem stats.`;
    if (!Array.isArray(m.types) || m.types.length === 0) return `Pokemon ${i + 1} sem types.`;
    if (!Array.isArray(m.moves) || m.moves.length === 0) return `Pokemon ${i + 1} sem moves.`;
    for (const mv of m.moves) {
      if (!mv || typeof mv !== "object") return `Pokemon ${i + 1} tem move invalido.`;
      const moveId = String(mv.id || "").trim();
      if (!moveId) return `Pokemon ${i + 1} tem move sem id.`;
      if (asNumber(mv.ppMax, 0) <= 0) return `Pokemon ${i + 1} tem move "${moveId}" com ppMax invalido.`;
    }
  }
  if (!anyAlive) return "Ao menos um Pokemon precisa estar vivo.";
  return null;
}

function initialFieldState() {
  return {
    weather: "none",
    weatherTurns: 0,
    trickRoomTurns: 0,
    playerReflectTurns: 0,
    enemyReflectTurns: 0,
    playerLightScreenTurns: 0,
    enemyLightScreenTurns: 0,
    playerSpikesLayers: 0,
    enemySpikesLayers: 0,
    playerStealthRock: false,
    enemyStealthRock: false,
  };
}

/**
 * Gera seed int32 positivo (1..2^31-1). Usado como base para o RNG
 * determinístico que ambos os lados PvP derivam (seed XOR turnNumber).
 * Não precisa ser criptográfico — basta ser o mesmo em ambos os dispositivos.
 */
function generatePvpRngSeed() {
  // Combina Date.now low bits + Math.random para espalhar valores.
  const t = Date.now() & 0x7fffffff;
  const r = Math.floor(Math.random() * 0x7fffffff);
  return (t ^ r) >>> 0 || 1;
}

function initialSnapshotFromTeams(ownerTeam, challengerTeam, rngSeed) {
  const firstAlive = (team) => team.findIndex((m) => asNumber(m?.hpCurrent, 0) > 0);
  const oa = firstAlive(ownerTeam);
  const ca = firstAlive(challengerTeam);
  return {
    version: 1,
    ownerTeam,
    challengerTeam,
    ownerActive: oa < 0 ? 0 : oa,
    challengerActive: ca < 0 ? 0 : ca,
    fieldState: initialFieldState(),
    result: "ongoing",
    pvpRngSeed: rngSeed,
  };
}

/**
 * Cria `battleRooms/{newId}` com snapshot inicial e marca o Coliseu como
 * `in_battle` + `linkedBattleRoomId`. Em transação com leituras dos dois picks.
 */
async function runStartColiseuPvpBattle(db, ownerUid, coliseuRoomId) {
  if (!coliseuRoomId || typeof coliseuRoomId !== "string") {
    throw new HttpsError("invalid-argument", "coliseuRoomId obrigatorio.");
  }

  const battleRoomId = `coliseu-${coliseuRoomId}`;
  const brRef = db.doc(`${BATTLE_ROOMS_COLLECTION}/${battleRoomId}`);
  const colRef = db.doc(`${COLISEU_ROOMS_COLLECTION}/${coliseuRoomId}`);

  return await db.runTransaction(async (tx) => {
    const existingBr = await tx.get(brRef);
    if (existingBr.exists) {
      const d = existingBr.data() || {};
      const status = String(d.status || "").trim().toLowerCase();
      if (status === "in_battle" || status === "finished" || status === "ready") {
        // Idempotência: se já existe uma batalha em andamento para essa sala, devolve-a.
        return { battleRoomId, reused: true };
      }
    }

    const colSnap = await tx.get(colRef);
    if (!colSnap.exists) throw new HttpsError("not-found", "Sala do Coliseu nao encontrada.");
    const col = colSnap.data() || {};

    if (String(col.creatorUid || "").trim() !== ownerUid) {
      throw new HttpsError("permission-denied", "Apenas o criador da sala pode iniciar a batalha.");
    }
    const currentStatus = String(col.status || "").trim().toLowerCase();
    if (currentStatus !== "ready") {
      throw new HttpsError("failed-precondition", "A sala nao esta pronta para iniciar (status != ready).");
    }
    if (!col.opponent || !col.opponent.uid) {
      throw new HttpsError("failed-precondition", "Sala sem adversario.");
    }
    if (col.creatorPickReady !== true || col.opponentPickReady !== true) {
      throw new HttpsError("failed-precondition", "Os dois treinadores precisam confirmar o time.");
    }

    const challengerUid = String(col.opponent.uid || "").trim();
    const challengerCharId = String(col.opponent.characterId || "").trim();
    const ownerCharId = String(col.creatorCharacterId || "").trim();
    if (!challengerUid || !challengerCharId || !ownerCharId) {
      throw new HttpsError("failed-precondition", "Dados de participantes incompletos.");
    }

    const ownerPickRef = db.doc(`${COLISEU_ROOMS_COLLECTION}/${coliseuRoomId}/privatePicks/${ownerUid}`);
    const challengerPickRef = db.doc(`${COLISEU_ROOMS_COLLECTION}/${coliseuRoomId}/privatePicks/${challengerUid}`);
    const [ownerPick, challengerPick] = await Promise.all([tx.get(ownerPickRef), tx.get(challengerPickRef)]);
    if (!ownerPick.exists || !challengerPick.exists) {
      throw new HttpsError("failed-precondition", "Picks privados ausentes para algum dos treinadores.");
    }

    const expectedCount = Math.max(1, Math.min(6, asNumber(col.maxPokemons, 1)));
    const maxLevel = Math.max(1, Math.min(100, asNumber(col.maxLevel, 100)));

    const ownerBattleTeam = ownerPick.data()?.battleTeam;
    const challengerBattleTeam = challengerPick.data()?.battleTeam;

    const ownerErr = validateBattleTeam(ownerBattleTeam, expectedCount, maxLevel);
    if (ownerErr) throw new HttpsError("failed-precondition", `Time do criador invalido: ${ownerErr}`);
    const challengerErr = validateBattleTeam(challengerBattleTeam, expectedCount, maxLevel);
    if (challengerErr) throw new HttpsError("failed-precondition", `Time do adversario invalido: ${challengerErr}`);

    // Wave 5A: validação de learnset server-side (anti-cheat). Best-effort:
    // se o dataset não estiver disponível no container, essa validação é
    // silenciada (hasLearnsetData==false) para não bloquear PvP.
    const ownerLearnErr = pvpLearnset.validateTeamLearnset(ownerBattleTeam);
    if (ownerLearnErr) throw new HttpsError("failed-precondition", `Time do criador: ${ownerLearnErr}`);
    const challengerLearnErr = pvpLearnset.validateTeamLearnset(challengerBattleTeam);
    if (challengerLearnErr) throw new HttpsError("failed-precondition", `Time do adversario: ${challengerLearnErr}`);

    const pvpRngSeed = generatePvpRngSeed();
    const snapshot = initialSnapshotFromTeams(ownerBattleTeam, challengerBattleTeam, pvpRngSeed);
    const nowMs = Date.now();

    tx.set(brRef, {
      ownerUid,
      ownerCharacterId: ownerCharId,
      ownerTrainerName: String(col.creatorTrainerName || ""),
      challengerUid,
      challengerCharacterId: challengerCharId,
      challengerTrainerName: String(col.opponent.trainerName || ""),
      coliseuRoomId,
      status: "in_battle",
      pvpCurrentTurn: 1,
      pvpTurnStatus: "waiting_actions",
      pvpResolutionEpoch: 0,
      pvpBattleSnapshot: snapshot,
      pvpHostAction: null,
      pvpChallengerAction: null,
      pvpPendingForcedSide: null,
      pvpLastEventsCanonical: [],
      pvpLastBattleResult: "ongoing",
      pvpLastResolvedBy: null,
      coliseuPvpCurrencySettled: false,
      // `pvpCurrentTurnStartedAt` é usado pelo scheduled `coliseuPvpTurnTimeoutTick`
      // para detectar batalhas travadas (>5min sem evolução de turno) e aplicar
      // forfeit server-side. Atualizado a cada resolução bem-sucedida pelo
      // `coliseuPvpResolveGuard` (trigger onDocumentUpdated).
      pvpCurrentTurnStartedAt: FieldValue.serverTimestamp(),
      pvpLastResolvedAt: null,
      expiresAtMs: nowMs + 1000 * 60 * 30,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    tx.set(colRef, {
      status: "in_battle",
      linkedBattleRoomId: battleRoomId,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return { battleRoomId, reused: false };
  });
}

exports.startColiseuPvpBattleHttp = onRequest({ ...REGION, cors: true }, async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    const uid = await uidFromBearer(req);
    const body = bodyWithoutIdToken(req);
    const coliseuRoomId = String(body?.coliseuRoomId || "").trim();
    const db = getFirestore();
    const out = await runStartColiseuPvpBattle(db, uid, coliseuRoomId);
    res.status(200).json({ ok: true, ...out });
  } catch (e) {
    if (e instanceof HttpsError) {
      const status = e.httpErrorCode?.status ?? 500;
      res.status(status).json({ error: e.message, code: e.code });
      return;
    }
    logger.error("startColiseuPvpBattleHttp", e);
    res.status(500).json({ error: e?.message || "Erro ao iniciar batalha." });
  }
});

/**
 * Trigger idempotente: quando `battleRooms/{id}.status` transita para `finished`,
 * executa liquidação da aposta do Coliseu via `executeSettleColiseuPvp`.
 * O próprio settle é idempotente via `coliseuPvpCurrencySettled`.
 */
exports.coliseuAutoSettleOnFinish = onDocumentUpdated(
  { ...REGION, document: `${BATTLE_ROOMS_COLLECTION}/{roomId}` },
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    const beforeStatus = String(before.status || "").trim().toLowerCase();
    const afterStatus = String(after.status || "").trim().toLowerCase();
    if (afterStatus !== "finished") return;
    if (beforeStatus === "finished") return;
    if (!after.coliseuRoomId) return;
    if (after.coliseuPvpCurrencySettled === true) return;

    const battleRoomId = event.params?.roomId;
    if (!battleRoomId) return;

    const ownerUid = String(after.ownerUid || "").trim();
    if (!ownerUid) return;

    const db = getFirestore();
    try {
      await phase2Mutations.executeSettleColiseuPvp(db, ownerUid, { battleRoomId });
    } catch (err) {
      logger.warn("coliseuAutoSettleOnFinish falhou", {
        battleRoomId,
        message: String(err?.message || err),
      });
    }
  },
);
