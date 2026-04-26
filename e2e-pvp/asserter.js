#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * E2E asserter do PVP Coliseu.
 *
 * Uso geral:
 *   node admin/e2e-pvp/asserter.js <comando> [args...]
 *
 * Requer `admin/serviceAccountKey.json` no caminho padrão do projeto
 * (mesmo padrão dos outros scripts em `admin/scripts/*`).
 *
 * Todos os comandos imprimem JSON em stdout e saem com:
 *   exit 0  -> assert passou / dump ok
 *   exit 1  -> assert falhou / inconsistência detectada
 *   exit 2  -> erro operacional (sem credencial, doc inexistente, etc.)
 *
 * --- LEITURA ---
 *   dump:room <roomId>
 *   dump:battle <battleRoomId>
 *   dump:history <uid> <charId> [limit=5]
 *   dump:escrow <roomId> <side>                 (side = creator | opponent)
 *
 *   assert:room-created <roomId>
 *   assert:password-set <roomId>                (confere hash + salt + hasPassword)
 *   assert:opponent-joined <roomId> <opponentUid>
 *   assert:picks-ready <roomId>                 (ambos privatePicks têm battleTeam)
 *   assert:battle-started <roomId>              (linkedBattleRoomId + snapshot inicial)
 *   assert:turn-resolved <battleRoomId> <expectedTurn> <expectedEpoch>
 *   assert:no-client-writes <battleRoomId>      (pvpLastResolvedBy === "server")
 *   assert:battle-finished <battleRoomId> <expectedResult>    (victory|defeat|ran)
 *   assert:settlement-done <battleRoomId>
 *   assert:history-saved <uid> <charId> <battleRoomId>
 *
 * --- INJEÇÃO (ESCREVE / PARA TESTE) ---
 *   inject:stale-heartbeat <battleRoomId> <side> <ageSec>
 *       side = owner | challenger. Escreve pvpHostLastSeenAt / pvpChallengerLastSeenAt
 *       como (now - ageSec*1000). Use ageSec=50 para disparar skip,
 *       ageSec=120 para disparar forfeit, na próxima execução do tick.
 *
 *   inject:bad-snapshot <battleRoomId>
 *       Escreve um pvpBattleSnapshot inválido via Admin SDK (bypassa rules) —
 *       serve para validar que o `coliseuPvpResolveGuard` reverte ou alerta.
 *
 *   inject:simulate-abandon <battleRoomId> <side>
 *       Atalho: zera pvpHostLastSeenAt/pvpChallengerLastSeenAt para 999s atrás.
 */

const path = require("path");
const fs = require("fs");

function die(code, payload) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(code);
}

function ok(payload) { die(0, { ok: true, ...payload }); }
function fail(payload) { die(1, { ok: false, ...payload }); }
function err(payload) { die(2, { ok: false, ...payload }); }

// --- credencial ---------------------------------------------------------
const ROOT = path.resolve(__dirname, "..");
const KEY_PATH = path.join(ROOT, "serviceAccountKey.json");
if (!fs.existsSync(KEY_PATH)) {
  err({ reason: "service_account_missing", expected: KEY_PATH });
}
// Resolve firebase-admin explicitamente a partir de admin/functions/node_modules
// para que o script rode de qualquer cwd.
const FUNCTIONS_NM = path.join(ROOT, "functions", "node_modules");
let admin;
try {
  admin = require(path.join(FUNCTIONS_NM, "firebase-admin"));
} catch (e) {
  try {
    admin = require("firebase-admin");
  } catch (e2) {
    err({
      reason: "firebase_admin_not_installed",
      hint: "rode `cd admin/functions && npm install` antes.",
      detail: String(e2 && e2.message || e2),
    });
  }
}
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(require(KEY_PATH)),
  });
}
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

// --- helpers ------------------------------------------------------------
function toPlain(v) {
  if (v == null) return v;
  if (v instanceof Timestamp) return { _ts: v.toDate().toISOString() };
  if (Array.isArray(v)) return v.map(toPlain);
  if (typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v)) out[k] = toPlain(v[k]);
    return out;
  }
  return v;
}

async function getDoc(refPath) {
  const snap = await db.doc(refPath).get();
  if (!snap.exists) return null;
  return snap.data();
}

function argsFrom(n) { return process.argv.slice(2 + n); }
function arg(i) { return process.argv[2 + i]; }

// --- DUMPS --------------------------------------------------------------
async function cmdDumpRoom(roomId) {
  const data = await getDoc(`coliseu_rooms/${roomId}`);
  if (!data) err({ reason: "not_found", path: `coliseu_rooms/${roomId}` });
  ok({ path: `coliseu_rooms/${roomId}`, data: toPlain(data) });
}
async function cmdDumpBattle(battleRoomId) {
  const data = await getDoc(`battleRooms/${battleRoomId}`);
  if (!data) err({ reason: "not_found", path: `battleRooms/${battleRoomId}` });
  const snap = data.pvpBattleSnapshot || {};
  const summary = {
    status: data.status,
    pvpCurrentTurn: data.pvpCurrentTurn,
    pvpResolutionEpoch: data.pvpResolutionEpoch,
    pvpTurnStatus: data.pvpTurnStatus,
    pvpPendingForcedSide: data.pvpPendingForcedSide,
    pvpLastResolvedBy: data.pvpLastResolvedBy,
    pvpLastBattleResult: data.pvpLastBattleResult,
    coliseuPvpCurrencySettled: data.coliseuPvpCurrencySettled,
    ownerActive: snap.ownerActive,
    challengerActive: snap.challengerActive,
    result: snap.result,
    ownerHPs: Array.isArray(snap.ownerTeam) ? snap.ownerTeam.map(m => `${m?.name ?? "?"}:${m?.hpCurrent}/${m?.hpTotal}`) : null,
    challengerHPs: Array.isArray(snap.challengerTeam) ? snap.challengerTeam.map(m => `${m?.name ?? "?"}:${m?.hpCurrent}/${m?.hpTotal}`) : null,
    pvpHostAction: data.pvpHostAction,
    pvpChallengerAction: data.pvpChallengerAction,
    pvpHostLastSeenAt: toPlain(data.pvpHostLastSeenAt),
    pvpChallengerLastSeenAt: toPlain(data.pvpChallengerLastSeenAt),
  };
  ok({ path: `battleRooms/${battleRoomId}`, summary, raw: toPlain(data) });
}
async function cmdDumpHistory(uid, charId, limit = 5) {
  const lim = Math.max(1, Math.min(50, Number(limit) || 5));
  const snap = await db.collection(`players/${uid}/characters/${charId}/battleHistory`)
    .orderBy("createdAt", "desc").limit(lim).get();
  const entries = snap.docs.map(d => ({ id: d.id, data: toPlain(d.data()) }));
  ok({ count: entries.length, entries });
}
async function cmdDumpEscrow(roomId, side) {
  const data = await getDoc(`pvpEscrow/${roomId}__${side}`);
  if (!data) err({ reason: "not_found", path: `pvpEscrow/${roomId}__${side}` });
  ok({ path: `pvpEscrow/${roomId}__${side}`, data: toPlain(data) });
}

// --- ASSERTS ------------------------------------------------------------
async function cmdAssertRoomCreated(roomId) {
  const r = await getDoc(`coliseu_rooms/${roomId}`);
  if (!r) fail({ reason: "room_missing", roomId });
  const problems = [];
  if (!r.creatorUid) problems.push("creatorUid ausente");
  if (!r.name || r.name.length < 3 || r.name.length > 24) problems.push(`name inválido: ${r.name}`);
  if (!["open", "closed"].includes(r.type)) problems.push(`type inválido: ${r.type}`);
  if (r.status !== "waiting") problems.push(`status esperado "waiting", got "${r.status}"`);
  if (typeof r.hasPassword !== "boolean") problems.push("hasPassword não é boolean");
  if (r.type === "closed" && !r.hasPassword) problems.push("closed sem hasPassword=true");
  if (r.type === "open" && r.hasPassword) problems.push("open com hasPassword=true");
  if (problems.length) fail({ reason: "shape_invalid", problems, room: toPlain(r) });
  ok({ roomId, type: r.type, name: r.name, hasPassword: r.hasPassword, creatorUid: r.creatorUid });
}
async function cmdAssertPasswordSet(roomId) {
  const r = await getDoc(`coliseu_rooms/${roomId}`);
  if (!r) fail({ reason: "room_missing", roomId });
  const problems = [];
  if (r.type !== "closed") problems.push(`type esperado "closed", got "${r.type}"`);
  if (!r.passwordHash) problems.push("passwordHash ausente");
  if (!r.passwordSalt) problems.push("passwordSalt ausente");
  if (r.hasPassword !== true) problems.push("hasPassword != true");
  if (r.passwordHash && r.passwordHash.length < 40) problems.push("passwordHash muito curto (suspeito)");
  if (problems.length) fail({ reason: "password_shape_invalid", problems });
  ok({
    roomId,
    type: r.type,
    hasPassword: r.hasPassword,
    passwordHashLen: String(r.passwordHash).length,
    passwordSaltLen: String(r.passwordSalt).length,
  });
}
async function cmdAssertOpponentJoined(roomId, expectedUid) {
  const r = await getDoc(`coliseu_rooms/${roomId}`);
  if (!r) fail({ reason: "room_missing", roomId });
  const op = r.opponent || null;
  if (!op || op.uid !== expectedUid) {
    fail({ reason: "opponent_not_joined", expected: expectedUid, got: op });
  }
  if (!["picking", "ready"].includes(r.status)) {
    fail({ reason: "status_unexpected", status: r.status, expected: ["picking", "ready"] });
  }
  ok({ roomId, opponentUid: op.uid, status: r.status });
}
async function cmdAssertPicksReady(roomId) {
  const r = await getDoc(`coliseu_rooms/${roomId}`);
  if (!r) fail({ reason: "room_missing", roomId });
  if (!r.opponent) fail({ reason: "no_opponent", roomId });
  const expected = Number(r.maxPokemons) || 3;
  const uids = [r.creatorUid, r.opponent.uid];
  const problems = [];
  for (const uid of uids) {
    const p = await getDoc(`coliseu_rooms/${roomId}/privatePicks/${uid}`);
    if (!p) { problems.push(`privatePick ausente p/ ${uid}`); continue; }
    const team = Array.isArray(p.battleTeam) ? p.battleTeam : null;
    if (!team) problems.push(`${uid}: battleTeam ausente`);
    else if (team.length !== expected) problems.push(`${uid}: battleTeam tem ${team.length}, esperado ${expected}`);
    else {
      const badHp = team.findIndex(m => !(m && Number(m.hpCurrent) > 0 && Number(m.hpTotal) > 0));
      if (badHp >= 0) problems.push(`${uid}: pokémon #${badHp} com HP inválido`);
      const badLevel = team.findIndex(m => m && Number(m.level) > Number(r.maxLevel));
      if (badLevel >= 0) problems.push(`${uid}: pokémon #${badLevel} acima do nível máximo`);
    }
  }
  if (!r.creatorPickReady) problems.push("creatorPickReady != true");
  if (!r.opponentPickReady) problems.push("opponentPickReady != true");
  if (problems.length) fail({ reason: "picks_invalid", problems });
  ok({ roomId, teamSize: expected, creatorUid: uids[0], opponentUid: uids[1] });
}
async function cmdAssertBattleStarted(roomId) {
  const r = await getDoc(`coliseu_rooms/${roomId}`);
  if (!r) fail({ reason: "room_missing", roomId });
  const linked = r.linkedBattleRoomId;
  if (!linked) fail({ reason: "linkedBattleRoomId_missing", room: toPlain(r) });
  if (r.status !== "in_battle") fail({ reason: "room_status_unexpected", status: r.status });
  const b = await getDoc(`battleRooms/${linked}`);
  if (!b) fail({ reason: "battle_missing", linked });
  const problems = [];
  if (b.status !== "in_battle") problems.push(`battle.status "${b.status}" != "in_battle"`);
  if (b.pvpCurrentTurn !== 1) problems.push(`pvpCurrentTurn esperado 1, got ${b.pvpCurrentTurn}`);
  if (b.pvpResolutionEpoch !== 0) problems.push(`pvpResolutionEpoch esperado 0, got ${b.pvpResolutionEpoch}`);
  if (!b.pvpBattleSnapshot) problems.push("pvpBattleSnapshot ausente");
  else {
    const s = b.pvpBattleSnapshot;
    if (!Array.isArray(s.ownerTeam) || !s.ownerTeam.length) problems.push("ownerTeam vazio");
    if (!Array.isArray(s.challengerTeam) || !s.challengerTeam.length) problems.push("challengerTeam vazio");
    if (typeof s.ownerActive !== "number") problems.push("ownerActive não é número");
    if (typeof s.challengerActive !== "number") problems.push("challengerActive não é número");
  }
  if (b.pvpHostAction != null) problems.push("pvpHostAction deveria ser null");
  if (b.pvpChallengerAction != null) problems.push("pvpChallengerAction deveria ser null");
  if (!b.pvpRngSeed) problems.push("pvpRngSeed ausente");
  if (problems.length) fail({ reason: "battle_shape_invalid", problems, battleRoomId: linked });
  ok({ roomId, battleRoomId: linked, turn: b.pvpCurrentTurn, epoch: b.pvpResolutionEpoch });
}
async function cmdAssertTurnResolved(battleRoomId, expectedTurn, expectedEpoch) {
  const b = await getDoc(`battleRooms/${battleRoomId}`);
  if (!b) fail({ reason: "battle_missing", battleRoomId });
  const problems = [];
  const t = Number(expectedTurn);
  const e = Number(expectedEpoch);
  if (b.pvpCurrentTurn !== t) problems.push(`pvpCurrentTurn esperado ${t}, got ${b.pvpCurrentTurn}`);
  if (b.pvpResolutionEpoch !== e) problems.push(`pvpResolutionEpoch esperado ${e}, got ${b.pvpResolutionEpoch}`);
  if (b.pvpHostAction != null) problems.push("pvpHostAction não foi limpo");
  if (b.pvpChallengerAction != null) problems.push("pvpChallengerAction não foi limpo");
  if (b.pvpLastResolvedBy !== "server") problems.push(`pvpLastResolvedBy esperado "server", got "${b.pvpLastResolvedBy}"`);
  if (!Array.isArray(b.pvpLastEventsCanonical)) problems.push("pvpLastEventsCanonical ausente");
  if (problems.length) fail({ reason: "turn_state_invalid", problems, battleRoomId });
  const snap = b.pvpBattleSnapshot || {};
  ok({
    battleRoomId,
    turn: b.pvpCurrentTurn,
    epoch: b.pvpResolutionEpoch,
    events: (b.pvpLastEventsCanonical || []).length,
    result: snap.result,
    ownerHPs: (snap.ownerTeam || []).map(m => `${m.name ?? "?"}:${m.hpCurrent}/${m.hpTotal}`),
    challengerHPs: (snap.challengerTeam || []).map(m => `${m.name ?? "?"}:${m.hpCurrent}/${m.hpTotal}`),
  });
}
async function cmdAssertNoClientWrites(battleRoomId) {
  const b = await getDoc(`battleRooms/${battleRoomId}`);
  if (!b) fail({ reason: "battle_missing", battleRoomId });
  if (b.pvpLastResolvedBy && b.pvpLastResolvedBy !== "server") {
    fail({ reason: "client_wrote_snapshot", pvpLastResolvedBy: b.pvpLastResolvedBy });
  }
  ok({ battleRoomId, pvpLastResolvedBy: b.pvpLastResolvedBy || "(none yet)" });
}
async function cmdAssertBattleFinished(battleRoomId, expectedResult) {
  const b = await getDoc(`battleRooms/${battleRoomId}`);
  if (!b) fail({ reason: "battle_missing", battleRoomId });
  const problems = [];
  if (b.status !== "finished") problems.push(`status esperado "finished", got "${b.status}"`);
  const allowed = ["victory", "defeat", "ran"];
  if (!allowed.includes(b.pvpLastBattleResult)) {
    problems.push(`pvpLastBattleResult inválido: ${b.pvpLastBattleResult}`);
  }
  if (expectedResult && b.pvpLastBattleResult !== expectedResult) {
    problems.push(`resultado esperado ${expectedResult}, got ${b.pvpLastBattleResult}`);
  }
  if (problems.length) fail({ reason: "finish_invalid", problems });
  ok({
    battleRoomId,
    result: b.pvpLastBattleResult,
    forfeitReason: b.pvpForfeitReason || null,
    settled: !!b.coliseuPvpCurrencySettled,
  });
}
async function cmdAssertSettlementDone(battleRoomId) {
  const b = await getDoc(`battleRooms/${battleRoomId}`);
  if (!b) fail({ reason: "battle_missing", battleRoomId });
  if (b.status !== "finished") fail({ reason: "battle_not_finished", status: b.status });
  if (!b.coliseuPvpCurrencySettled) fail({ reason: "settlement_pending", battleRoomId });
  ok({ battleRoomId, settled: true, result: b.pvpLastBattleResult });
}
async function cmdAssertHistorySaved(uid, charId, battleRoomId) {
  // o coliseuBattleHistoryOnFinish grava com entryId derivado do battleRoomId
  const snap = await db.collection(`players/${uid}/characters/${charId}/battleHistory`)
    .where("battleRoomId", "==", battleRoomId).limit(5).get();
  if (snap.empty) fail({ reason: "history_not_found", battleRoomId, uid });
  const docs = snap.docs.map(d => ({ id: d.id, data: toPlain(d.data()) }));
  ok({ uid, charId, battleRoomId, entries: docs });
}

// --- INJECTIONS (escrevem) ---------------------------------------------
async function cmdInjectStaleHeartbeat(battleRoomId, side, ageSec) {
  const field = side === "owner" ? "pvpHostLastSeenAt" : side === "challenger" ? "pvpChallengerLastSeenAt" : null;
  if (!field) err({ reason: "bad_side", side });
  const staleMs = Date.now() - (Number(ageSec) || 0) * 1000;
  await db.doc(`battleRooms/${battleRoomId}`).set({
    [field]: Timestamp.fromMillis(staleMs),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  ok({ battleRoomId, side, field, staleTs: new Date(staleMs).toISOString(), note: "Next coliseuPvpTurnTimeoutTick (<=1 min) irá agir." });
}
async function cmdInjectSimulateAbandon(battleRoomId, side) {
  await cmdInjectStaleHeartbeat(battleRoomId, side, 999);
}
async function cmdInjectBadSnapshot(battleRoomId) {
  const b = await getDoc(`battleRooms/${battleRoomId}`);
  if (!b) err({ reason: "battle_missing" });
  const snap = b.pvpBattleSnapshot;
  if (!snap) err({ reason: "no_snapshot" });
  const bad = JSON.parse(JSON.stringify(snap));
  if (Array.isArray(bad.ownerTeam) && bad.ownerTeam[0]) bad.ownerTeam[0].hpCurrent = -9999;
  // Admin SDK bypassa rules de cliente — isto representa um write via uma via
  // anômala (ex: ferramenta admin comprometida). O guard deve revertê-lo OU
  // registrar via log estruturado.
  await db.doc(`battleRooms/${battleRoomId}`).set({
    pvpBattleSnapshot: bad,
    pvpResolutionEpoch: (Number(b.pvpResolutionEpoch) || 0) + 1,
    pvpLastResolvedBy: "client",
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  ok({ battleRoomId, note: "Snapshot inválido injetado. Observe logs do coliseuPvpResolveGuard." });
}

// --- dispatcher ---------------------------------------------------------
async function main() {
  const cmd = arg(0);
  if (!cmd) err({ reason: "no_command", usage: "see header of asserter.js" });
  try {
    switch (cmd) {
      case "dump:room":        return cmdDumpRoom(arg(1));
      case "dump:battle":      return cmdDumpBattle(arg(1));
      case "dump:history":     return cmdDumpHistory(arg(1), arg(2), arg(3));
      case "dump:escrow":      return cmdDumpEscrow(arg(1), arg(2));
      case "assert:room-created":     return cmdAssertRoomCreated(arg(1));
      case "assert:password-set":     return cmdAssertPasswordSet(arg(1));
      case "assert:opponent-joined":  return cmdAssertOpponentJoined(arg(1), arg(2));
      case "assert:picks-ready":      return cmdAssertPicksReady(arg(1));
      case "assert:battle-started":   return cmdAssertBattleStarted(arg(1));
      case "assert:turn-resolved":    return cmdAssertTurnResolved(arg(1), arg(2), arg(3));
      case "assert:no-client-writes": return cmdAssertNoClientWrites(arg(1));
      case "assert:battle-finished":  return cmdAssertBattleFinished(arg(1), arg(2));
      case "assert:settlement-done":  return cmdAssertSettlementDone(arg(1));
      case "assert:history-saved":    return cmdAssertHistorySaved(arg(1), arg(2), arg(3));
      case "inject:stale-heartbeat":  return cmdInjectStaleHeartbeat(arg(1), arg(2), arg(3));
      case "inject:simulate-abandon": return cmdInjectSimulateAbandon(arg(1), arg(2));
      case "inject:bad-snapshot":     return cmdInjectBadSnapshot(arg(1));
      default: err({ reason: "unknown_command", cmd });
    }
  } catch (e) {
    err({ reason: "exception", message: String(e && e.message || e), stack: String(e && e.stack || "") });
  }
}

main();
