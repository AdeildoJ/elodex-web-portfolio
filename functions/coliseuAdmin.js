/**
 * Coliseu PvP — administração de salas via HTTP callables autenticados.
 *
 * Este módulo centraliza TODAS as operações críticas do ciclo de vida de uma
 * sala Coliseu que envolvem integridade financeira, autorização ou privacidade:
 *
 *  - Criação de sala (aberta ou fechada com senha hasheada).
 *  - Entrada em sala (aberta direta, fechada via senha).
 *  - Cancelamento/kick com refund automático.
 *  - Heartbeat do criador para detecção de sala órfã.
 *
 * Convenções arquiteturais:
 *
 *  - Todos os endpoints são `onRequest` HTTP com Bearer token (getIdToken do
 *    client → `Authorization: Bearer ...`). Evita `functions/unauthenticated`
 *    recorrente em RN/Expo que vemos com `onCall` callable.
 *  - Todas as operações que movimentam saldo usam transação Firestore com
 *    leitura-antes-de-escrita para garantir atomicidade.
 *  - **Escrow**: ECoin e itens apostados são DEBITADOS dos jogadores no
 *    momento da criação/entrada na sala e armazenados em
 *    `players/{uid}/pvpEscrow/{roomId}` como comprovante. No cancel/kick,
 *    a função lê os docs de escrow e devolve tudo. No settle, `executeSettleColiseuPvp`
 *    consome o escrow e credita o vencedor (sem re-debitar o perdedor).
 *  - **PokeCoins NÃO entram em escrow** — decisão de produto: ambos os lados
 *    ganham PokeCoins ao fim da luta (vencedor `coinsWin`, perdedor `coinsLose`
 *    como consolação). Só ECoin e itens viram aposta real.
 *  - Senha: hash via `crypto.scryptSync` com salt aleatório de 16 bytes.
 *    `passwordHash` nunca é exposto ao cliente (rules negam leitura do campo).
 *
 * Região: southamerica-east1.
 */

const { onRequest, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const logger = require("firebase-functions/logger");
const crypto = require("crypto");

const REGION = { region: "southamerica-east1" };
const COLISEU_ROOMS = "coliseu_rooms";
const MIN_NAME = 3;
const MAX_NAME = 24;
const NAME_RE = /^[\p{L}\p{N} _\-.!?']+$/u;
const MIN_PASSWORD = 4;
const MAX_PASSWORD = 32;
const ROOM_OPEN_MS = 1000 * 60 * 30;
const ROOM_CLOSED_MS = 1000 * 60 * 60;

// ---------- HTTP helpers ----------

function bodyJson(req) {
  let raw = req.body;
  if (Buffer.isBuffer(raw)) {
    try { raw = JSON.parse(raw.toString("utf8")); } catch { raw = {}; }
  } else if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) raw = {}; else { try { raw = JSON.parse(t); } catch { raw = {}; } }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) raw = {};
  return raw;
}

async function uidFromBearer(req) {
  const h = req.get("authorization") || req.get("Authorization") || "";
  const m = typeof h === "string" ? h.match(/^Bearer (.*)$/i) : null;
  const idToken = m ? String(m[1] || "").trim() : "";
  if (!idToken) throw new HttpsError("unauthenticated", "Token ausente.");
  const decoded = await getAuth().verifyIdToken(idToken);
  const uid = String(decoded?.uid || "").trim();
  if (!uid) throw new HttpsError("unauthenticated", "Token invalido.");
  return uid;
}

function sendHttpsError(res, err) {
  const status = err?.httpErrorCode?.status || 500;
  const code = err?.code || "internal";
  const message = err?.message || "Erro interno.";
  res.status(status).json({ error: { code, message } });
}

function httpBearerHandler(fn) {
  // v2 onRequest — força Bearer auth + JSON body + unwraps HttpsError.
  return onRequest({ ...REGION, cors: true }, async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: { code: "method-not-allowed", message: "Use POST." } });
      return;
    }
    try {
      const uid = await uidFromBearer(req);
      const body = bodyJson(req);
      const out = await fn({ uid, body, req });
      res.status(200).json(out || { ok: true });
    } catch (err) {
      if (!(err instanceof HttpsError)) logger.error("coliseuAdmin_unhandled", { err: String(err?.stack || err) });
      sendHttpsError(res, err);
    }
  });
}

// ---------- sanitização / validação ----------

function sanitizeName(raw) {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim();
  return s.length > MAX_NAME ? s.slice(0, MAX_NAME) : s;
}

function validateName(raw) {
  const s = sanitizeName(raw);
  if (s.length < MIN_NAME) return `O nome deve ter pelo menos ${MIN_NAME} caracteres.`;
  if (!NAME_RE.test(s)) return "O nome contem caracteres invalidos.";
  return null;
}

function asInt(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function normItems(rawItems) {
  if (!Array.isArray(rawItems)) return [];
  const out = [];
  for (const x of rawItems) {
    const id = String(x?.itemId || "").trim();
    const qty = Math.max(0, asInt(x?.qty, 0));
    if (id && qty > 0) out.push({ itemId: id, qty });
  }
  return out;
}

// ---------- senha (scrypt) ----------

function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(plain), salt, 64);
  return { passwordHash: hash.toString("base64"), passwordSalt: salt.toString("base64") };
}

function verifyPassword(plain, passwordHash, passwordSalt) {
  try {
    const salt = Buffer.from(String(passwordSalt || ""), "base64");
    const expected = Buffer.from(String(passwordHash || ""), "base64");
    if (!salt.length || !expected.length) return false;
    const derived = crypto.scryptSync(String(plain), salt, expected.length);
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

// ---------- regras econômicas ----------

function baseBet(maxPokemons) {
  const n = clamp(Math.floor(maxPokemons), 1, 6);
  return { coinsWin: 300 * n, coinsLose: 150 * n, items: [], ecoin: 0 };
}

// ---------- ESCROW: reserva ECoin + itens ----------

/**
 * Reserva ECoin e itens de um jogador num doc de escrow dentro da sua conta.
 *
 * Estrutura: `players/{uid}/pvpEscrow/{roomId}` =
 *   { roomId, side: "creator"|"opponent", characterId, ecoin, items: [{itemId,qty}], createdAt }
 *
 * - Lê saldos/quantidades antes de escrever.
 * - Atomico: OU tudo é reservado, OU a transação inteira é abortada.
 * - Idempotente: se já existir escrow desta sala para este uid, retorna erro
 *   explicando que há reserva duplicada (evita double-spend).
 *
 * Usa uma transação externa caller-provided para compor com outros writes.
 */
async function reserveEscrowInTx(tx, db, { uid, characterId, roomId, side, ecoin, items }) {
  const escRef = db.doc(`players/${uid}/pvpEscrow/${roomId}`);
  const charRef = db.doc(`players/${uid}/characters/${characterId}`);
  const playerRef = db.doc(`players/${uid}`);

  const reads = [tx.get(escRef), tx.get(charRef)];
  if (ecoin > 0) reads.push(tx.get(playerRef));
  const itemPairs = [];
  for (const it of items) {
    const iRef = db.doc(`players/${uid}/characters/${characterId}/itens/${it.itemId}`);
    itemPairs.push({ def: it, ref: iRef, idx: reads.length });
    reads.push(tx.get(iRef));
  }
  const snaps = await Promise.all(reads);

  const escSnap = snaps[0];
  if (escSnap.exists) {
    throw new HttpsError("already-exists", "Escrow ja existente para esta sala — conclua ou cancele a anterior.");
  }

  if (!snaps[1].exists) {
    throw new HttpsError("failed-precondition", "Personagem nao encontrado.");
  }

  if (ecoin > 0) {
    const psnap = snaps[2];
    const bal = Math.max(0, Number(psnap.data()?.ecoinBalance || 0));
    if (bal < ecoin) throw new HttpsError("failed-precondition", "ECoin insuficiente para a aposta.");
    tx.set(playerRef, { ecoinBalance: bal - ecoin, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }

  for (const pair of itemPairs) {
    const snap = snaps[pair.idx];
    const have = Math.max(0, asInt(snap.data()?.quantity, 0));
    if (have < pair.def.qty) {
      throw new HttpsError("failed-precondition", `Item insuficiente para a aposta (${pair.def.itemId}).`);
    }
    tx.set(pair.ref, { quantity: have - pair.def.qty, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }

  tx.set(escRef, {
    roomId,
    side,
    characterId,
    ecoin: Math.max(0, ecoin),
    items: items.map((it) => ({ itemId: it.itemId, qty: it.qty })),
    createdAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Devolve todo o escrow de um jogador (ecoin + itens) somando novamente nos
 * saldos. Opera idempotente: se o doc não existe, retorna silenciosamente.
 */
async function refundEscrowInTx(tx, db, { uid, roomId }) {
  const escRef = db.doc(`players/${uid}/pvpEscrow/${roomId}`);
  const escSnap = await tx.get(escRef);
  if (!escSnap.exists) return false;
  const data = escSnap.data() || {};
  const characterId = String(data.characterId || "").trim();
  if (!characterId) {
    // escrow inválido; apaga para não ficar preso.
    tx.delete(escRef);
    return false;
  }
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

  let snapIdx = 0;
  if (ecoin > 0) {
    const bal = Math.max(0, Number(snaps[snapIdx++].data()?.ecoinBalance || 0));
    tx.set(playerRef, { ecoinBalance: bal + ecoin, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  for (const pair of itemPairs) {
    const have = Math.max(0, asInt(snaps[pair.idx].data()?.quantity, 0));
    tx.set(pair.ref, {
      id: pair.itemId,
      kind: "ITEM",
      quantity: have + pair.qty,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  tx.delete(escRef);
  return true;
}

// ---------- callables HTTP ----------

/**
 * Cria uma sala Coliseu (aberta ou fechada com senha).
 *
 * Body: {
 *   characterId: string,
 *   trainerName: string,
 *   creatorRegion?: string | null,
 *   creatorAvatarUrl?: string | null,
 *   name: string,                    // 3..24 chars
 *   type: "open" | "closed",
 *   maxPokemons: 1..6,
 *   maxLevel: 1..100,
 *   scenarioId?: string | null,
 *   scenarioName?: string | null,
 *   isRandomScenario?: boolean,
 *   extraBetItems?: [{itemId,qty}],  // em escrow
 *   extraEcoin?: number,              // em escrow
 *   password?: string,                // obrigatório para type=closed
 * }
 *
 * Retorno: { ok: true, roomId } | HttpsError.
 */
const createColiseuRoomHttp = httpBearerHandler(async ({ uid, body }) => {
  const characterId = String(body.characterId || "").trim();
  if (!characterId) throw new HttpsError("invalid-argument", "characterId ausente.");

  const trainerName = String(body.trainerName || "Treinador").slice(0, 40);
  const creatorRegion = body.creatorRegion ? String(body.creatorRegion) : null;
  const creatorAvatarUrl = body.creatorAvatarUrl ? String(body.creatorAvatarUrl) : null;

  const name = sanitizeName(body.name);
  const nameErr = validateName(body.name);
  if (nameErr) throw new HttpsError("invalid-argument", nameErr);

  const type = body.type === "closed" ? "closed" : "open";
  const maxPokemons = clamp(asInt(body.maxPokemons, 3), 1, 6);
  const maxLevel = clamp(asInt(body.maxLevel, 50), 1, 100);
  const scenarioId = body.isRandomScenario ? null : (body.scenarioId ? String(body.scenarioId) : null);
  const scenarioName = body.scenarioName ? String(body.scenarioName).slice(0, 60) : null;
  const isRandomScenario = Boolean(body.isRandomScenario);
  const extraItems = normItems(body.extraBetItems);
  const extraEcoin = Math.max(0, asInt(body.extraEcoin, 0));

  let passwordHash = null;
  let passwordSalt = null;
  if (type === "closed") {
    const raw = String(body.password || "");
    if (raw.length < MIN_PASSWORD || raw.length > MAX_PASSWORD) {
      throw new HttpsError("invalid-argument", `A senha deve ter entre ${MIN_PASSWORD} e ${MAX_PASSWORD} caracteres.`);
    }
    const h = hashPassword(raw);
    passwordHash = h.passwordHash;
    passwordSalt = h.passwordSalt;
  }

  const bet = { ...baseBet(maxPokemons), items: extraItems, ecoin: extraEcoin };
  const expiresAtMs = Date.now() + (type === "closed" ? ROOM_CLOSED_MS : ROOM_OPEN_MS);

  const db = getFirestore();
  const newRoomRef = db.collection(COLISEU_ROOMS).doc();
  const roomId = newRoomRef.id;

  await db.runTransaction(async (tx) => {
    // Reserva escrow (ECoin + itens) se houver aposta extra.
    if (extraEcoin > 0 || extraItems.length > 0) {
      await reserveEscrowInTx(tx, db, {
        uid,
        characterId,
        roomId,
        side: "creator",
        ecoin: extraEcoin,
        items: extraItems,
      });
    }
    tx.set(newRoomRef, {
      name,
      creatorUid: uid,
      creatorCharacterId: characterId,
      creatorTrainerName: trainerName,
      creatorRegion,
      creatorAvatarUrl,
      type,
      maxPokemons,
      maxLevel,
      scenarioId,
      scenarioName,
      isRandomScenario,
      bet,
      status: "waiting",
      opponent: null,
      requests: [],
      creatorPickReady: false,
      opponentPickReady: false,
      linkedBattleRoomId: null,
      expiresAtMs,
      // Heartbeat/presença:
      creatorLastSeenAt: FieldValue.serverTimestamp(),
      // Senha (hasheada; rules não expõem estes campos em read público):
      passwordHash,
      passwordSalt,
      // Indicador público de que existe senha (para UI):
      hasPassword: !!passwordHash,
      // Escrow flag: sinaliza para o settle não re-debitar (ECoin+itens já foram reservados).
      escrowActive: (extraEcoin > 0 || extraItems.length > 0),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  logger.info("coliseu_room_created", {
    roomId, uid, type, maxPokemons, maxLevel, hasPassword: type === "closed",
    extraEcoin, extraItemsCount: extraItems.length,
  });

  return { ok: true, roomId };
});

/**
 * Entrada em sala aberta OU fechada com senha.
 *
 * Body: {
 *   roomId, characterId, trainerName, region?, avatarUrl?,
 *   password?  // obrigatória para type="closed"
 * }
 */
const joinColiseuRoomHttp = httpBearerHandler(async ({ uid, body }) => {
  const roomId = String(body.roomId || "").trim();
  const characterId = String(body.characterId || "").trim();
  if (!roomId) throw new HttpsError("invalid-argument", "roomId ausente.");
  if (!characterId) throw new HttpsError("invalid-argument", "characterId ausente.");
  const trainerName = String(body.trainerName || "Treinador").slice(0, 40);
  const region = body.region ? String(body.region) : null;
  const avatarUrl = body.avatarUrl ? String(body.avatarUrl) : null;
  const passwordInput = typeof body.password === "string" ? body.password : null;

  const db = getFirestore();
  const roomRef = db.doc(`${COLISEU_ROOMS}/${roomId}`);

  await db.runTransaction(async (tx) => {
    const roomSnap = await tx.get(roomRef);
    if (!roomSnap.exists) throw new HttpsError("not-found", "Sala nao encontrada.");
    const r = roomSnap.data() || {};

    if (r.creatorUid === uid) {
      throw new HttpsError("failed-precondition", "Voce e o criador desta sala.");
    }
    if (r.opponent && r.opponent.uid) {
      throw new HttpsError("failed-precondition", "Sala cheia.");
    }
    const status = String(r.status || "").trim();
    if (status !== "waiting") {
      throw new HttpsError("failed-precondition", "Sala nao aceita entradas.");
    }
    if (r.type === "closed") {
      if (!passwordInput) throw new HttpsError("permission-denied", "Senha obrigatoria.");
      const ok = verifyPassword(passwordInput, r.passwordHash, r.passwordSalt);
      if (!ok) throw new HttpsError("permission-denied", "Senha incorreta.");
    }

    // Reserva escrow do oponente se a sala tem aposta extra (ECoin/itens).
    const bet = r.bet && typeof r.bet === "object" ? r.bet : {};
    const extraEcoin = Math.max(0, asInt(bet.ecoin, 0));
    const extraItems = Array.isArray(bet.items) ? bet.items.map((it) => ({
      itemId: String(it?.itemId || "").trim(),
      qty: Math.max(0, asInt(it?.qty, 0)),
    })).filter((it) => it.itemId && it.qty > 0) : [];

    if (extraEcoin > 0 || extraItems.length > 0) {
      await reserveEscrowInTx(tx, db, {
        uid,
        characterId,
        roomId,
        side: "opponent",
        ecoin: extraEcoin,
        items: extraItems,
      });
    }

    tx.set(roomRef, {
      opponent: { uid, characterId, trainerName, region, avatarUrl },
      status: "picking",
      creatorPickReady: false,
      opponentPickReady: false,
      requests: [],
      // Se já havia escrow do criador, mantém escrowActive=true. Caso contrário,
      // ativa agora se o oponente pagou aposta (improvável, mas consistente).
      escrowActive: r.escrowActive === true || (extraEcoin > 0 || extraItems.length > 0),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  logger.info("coliseu_room_joined", { roomId, uid, type: "join" });

  return { ok: true };
});

/**
 * Cancelamento da sala pelo criador (antes ou durante picking).
 * - Devolve escrow do criador (se houver).
 * - Devolve escrow do oponente (se houver).
 * - Marca sala como "cancelled" (o lobby filtra por status e some).
 */
const cancelColiseuRoomHttp = httpBearerHandler(async ({ uid, body }) => {
  const roomId = String(body.roomId || "").trim();
  if (!roomId) throw new HttpsError("invalid-argument", "roomId ausente.");

  const db = getFirestore();
  const roomRef = db.doc(`${COLISEU_ROOMS}/${roomId}`);

  const out = await db.runTransaction(async (tx) => {
    const rs = await tx.get(roomRef);
    if (!rs.exists) throw new HttpsError("not-found", "Sala nao encontrada.");
    const r = rs.data() || {};
    if (r.creatorUid !== uid) throw new HttpsError("permission-denied", "Apenas o criador pode cancelar.");
    const status = String(r.status || "").trim();
    if (status === "in_battle" || status === "finished") {
      throw new HttpsError("failed-precondition", "A batalha ja comecou.");
    }

    const refunded = { creator: false, opponent: false };
    if (r.escrowActive === true) {
      refunded.creator = await refundEscrowInTx(tx, db, { uid: r.creatorUid, roomId });
      if (r.opponent && r.opponent.uid) {
        refunded.opponent = await refundEscrowInTx(tx, db, { uid: r.opponent.uid, roomId });
      }
    }

    tx.set(roomRef, {
      status: "cancelled",
      escrowActive: false,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return refunded;
  });

  logger.info("coliseu_room_cancelled", { roomId, uid, refunded: out });
  return { ok: true, refunded: out };
});

/**
 * Criador remove o adversário antes da batalha.
 * - Devolve escrow do oponente.
 * - Sala volta a "waiting".
 */
const kickColiseuOpponentHttp = httpBearerHandler(async ({ uid, body }) => {
  const roomId = String(body.roomId || "").trim();
  if (!roomId) throw new HttpsError("invalid-argument", "roomId ausente.");

  const db = getFirestore();
  const roomRef = db.doc(`${COLISEU_ROOMS}/${roomId}`);

  const out = await db.runTransaction(async (tx) => {
    const rs = await tx.get(roomRef);
    if (!rs.exists) throw new HttpsError("not-found", "Sala nao encontrada.");
    const r = rs.data() || {};
    if (r.creatorUid !== uid) throw new HttpsError("permission-denied", "Apenas o criador pode remover.");
    if (!r.opponent || !r.opponent.uid) throw new HttpsError("failed-precondition", "Sem adversario.");
    const status = String(r.status || "").trim();
    if (status === "in_battle" || status === "finished") {
      throw new HttpsError("failed-precondition", "A batalha ja comecou.");
    }

    let refunded = false;
    if (r.escrowActive === true) {
      refunded = await refundEscrowInTx(tx, db, { uid: r.opponent.uid, roomId });
    }

    tx.set(roomRef, {
      opponent: null,
      status: "waiting",
      creatorPickReady: false,
      opponentPickReady: false,
      requests: [],
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return refunded;
  });

  logger.info("coliseu_opponent_kicked", { roomId, uid, refunded: out });
  return { ok: true, refunded: out };
});

/**
 * Heartbeat do criador — toca a cada ~30s enquanto ele estiver com a sala
 * aberta. `cleanupColiseuOrphans` (scheduled) observa este campo e cancela
 * salas sem heartbeat recente (>120s).
 *
 * É uma callable (e não write direto) para contar como "atividade real"
 * autenticada e para gravar `serverTimestamp`.
 */
const touchColiseuRoomHttp = httpBearerHandler(async ({ uid, body }) => {
  const roomId = String(body.roomId || "").trim();
  if (!roomId) throw new HttpsError("invalid-argument", "roomId ausente.");

  const db = getFirestore();
  const ref = db.doc(`${COLISEU_ROOMS}/${roomId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Sala nao encontrada.");
  const r = snap.data() || {};
  if (r.creatorUid !== uid) throw new HttpsError("permission-denied", "Apenas o criador pode tocar.");
  const status = String(r.status || "").trim();
  if (status === "cancelled" || status === "expired" || status === "finished") {
    throw new HttpsError("failed-precondition", "Sala ja encerrada.");
  }
  await ref.set({
    creatorLastSeenAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { ok: true };
});

module.exports = {
  createColiseuRoomHttp,
  joinColiseuRoomHttp,
  cancelColiseuRoomHttp,
  kickColiseuOpponentHttp,
  touchColiseuRoomHttp,
  // Helpers exportados para reuso pelo scheduled cleanup e pelo settle:
  refundEscrowInTx,
  reserveEscrowInTx,
};
