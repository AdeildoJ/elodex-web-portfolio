/**
 * Resolução **server-authoritative** de turnos PvP do Coliseu.
 *
 * Arquitetura:
 *  - Os clientes apenas escrevem `pvpHostAction` / `pvpChallengerAction` no
 *    `battleRooms/{roomId}` (permitido pelas regras, cada lado só escreve o
 *    próprio campo).
 *  - Este trigger dispara em toda atualização da sala; quando detecta que
 *    ambas as ações do turno atual estão presentes (ou apenas a ação do lado
 *    forçado em troca obrigatória), ele:
 *      1. Re-lê o estado dentro de uma transaction.
 *      2. Valida invariantes (turno correto, batalha em andamento, snapshot
 *         existe, epoch não avançou).
 *      3. Chama a engine empacotada (`pvpEngine/engine.bundle.cjs`) — a MESMA
 *         que o mobile usa, sem duplicação de lógica.
 *      4. Publica o snapshot autoritativo, incrementa `pvpResolutionEpoch`,
 *         zera as ações, registra eventos e, se a batalha acabou, seta
 *         `status = "finished"` + `pvpLastBattleResult`.
 *
 * Idempotência:
 *  - Duas invocações concorrentes competindo pela mesma resolução: a primeira
 *    a fechar a transaction vence (via `pvpResolutionEpoch` guard). A segunda
 *    detecta epoch avançado e aborta silenciosamente.
 *  - Retries do Firebase (o mesmo evento reenviado): o guard de epoch também
 *    protege.
 *
 * Concorrência:
 *  - O turno é "lockado" implicitamente pelo `pvpResolutionEpoch`. Nenhum
 *    write adicional dedicado é necessário — a transaction já serializa.
 *
 * Determinismo:
 *  - RNG derivada de `pvpRngSeed ^ turnNumber` (mesma fórmula do client).
 *    Garante reprodutibilidade e permite que o client compute preview local
 *    idêntico à autoridade, evitando glitches visuais.
 */
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

const engine = require("./pvpEngine/engine.bundle.cjs");

const BATTLE_REGION = "southamerica-east1";

function asStr(v, def = "") {
  return typeof v === "string" ? v.trim() : def;
}
function asNum(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function asArr(v) {
  return Array.isArray(v) ? v : [];
}

/**
 * Determina qual lado precisa trocar após o turno (quando o ativo foi ao KO
 * mas há substituto vivo). Usado para setar `pvpPendingForcedSide` no snapshot.
 */
function computeForcedSide(nextSnapshot) {
  if (!nextSnapshot || nextSnapshot.result !== "ongoing") return null;
  const ownerTeam = asArr(nextSnapshot.ownerTeam);
  const challengerTeam = asArr(nextSnapshot.challengerTeam);
  const ownerActive = ownerTeam[nextSnapshot.ownerActive] || null;
  const challengerActive = challengerTeam[nextSnapshot.challengerActive] || null;
  const ownerKO = !ownerActive || asNum(ownerActive.hpCurrent) <= 0;
  const challengerKO = !challengerActive || asNum(challengerActive.hpCurrent) <= 0;
  const ownerHasSub = ownerTeam.some(
    (m, idx) => idx !== nextSnapshot.ownerActive && asNum(m?.hpCurrent) > 0
  );
  const challengerHasSub = challengerTeam.some(
    (m, idx) => idx !== nextSnapshot.challengerActive && asNum(m?.hpCurrent) > 0
  );
  if (ownerKO && ownerHasSub) return "owner";
  if (challengerKO && challengerHasSub) return "challenger";
  return null;
}

/**
 * Checa se o update atual traz condições suficientes para resolver o turno.
 * Retorna `null` se não houver nada a resolver (early exit silencioso).
 */
function canResolve(afterData) {
  if (!afterData) return null;
  const status = asStr(afterData.status);
  if (status !== "in_battle") return null;
  const snapshot = afterData.pvpBattleSnapshot || null;
  if (!snapshot) return null;
  if (asStr(snapshot.result, "ongoing") !== "ongoing") return null;
  const turn = asNum(afterData.pvpCurrentTurn);
  if (turn < 1) return null;

  const hostAction = afterData.pvpHostAction || null;
  const challengerAction = afterData.pvpChallengerAction || null;
  const pendingForced = asStr(afterData.pvpPendingForcedSide || "");

  const hostReady = hostAction && asNum(hostAction.turn) === turn && hostAction.action;
  const challengerReady =
    challengerAction && asNum(challengerAction.turn) === turn && challengerAction.action;

  if (pendingForced === "owner") {
    if (!hostReady) return null;
    if (asStr(hostAction.action?.type) !== "switch") return null;
    return { mode: "forced_owner", hostAction, challengerAction: null };
  }
  if (pendingForced === "challenger") {
    if (!challengerReady) return null;
    if (asStr(challengerAction.action?.type) !== "switch") return null;
    return { mode: "forced_challenger", hostAction: null, challengerAction };
  }
  if (hostReady && challengerReady) {
    return { mode: "normal", hostAction, challengerAction };
  }
  return null;
}

/**
 * `typeMultiplier` invocado pela engine. Delegamos ao helper do bundle
 * (`getBattleTypeMultiplier`) que já cobre imunidade por habilidade
 * (Levitate, Mold Breaker).
 */
function typeMultiplier(moveType, defender, attacker) {
  return engine.getBattleTypeMultiplier(moveType, defender, attacker || null);
}

/**
 * Converte o resultado da engine em um snapshot canônico (v1).
 */
function buildNextSnapshot(prev, resolution) {
  return {
    version: 1,
    ownerTeam: resolution.playerTeam,
    challengerTeam: resolution.enemyTeam,
    ownerActive: resolution.playerActive,
    challengerActive: resolution.enemyActive,
    fieldState: resolution.fieldState,
    result: resolution.result,
    pvpRngSeed: asNum(prev?.pvpRngSeed) || undefined,
  };
}

async function resolveTurnOnDoc(db, roomId, expectedEpoch, decision) {
  const ref = db.collection("battleRooms").doc(roomId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, reason: "room_not_found" };
    const data = snap.data();
    const currentEpoch = asNum(data.pvpResolutionEpoch);
    if (currentEpoch !== expectedEpoch) {
      return { ok: false, reason: "epoch_advanced", currentEpoch };
    }
    const d = canResolve(data);
    if (!d) return { ok: false, reason: "no_longer_resolvable" };
    // Garantir que o modo detectado não mudou (ex: cliente adicionou ação depois).
    if (d.mode !== decision.mode) {
      return { ok: false, reason: "mode_changed" };
    }

    const snapshot = data.pvpBattleSnapshot;
    const turn = asNum(data.pvpCurrentTurn);
    // Bug 11 (fix): a RNG de PvP DEVE ser determinística. Validamos que
    // `pvpRngSeed` é inteiro positivo. Se ausente ou 0, logamos warning
    // e abortamos a resolução — melhor parar do que fallback silencioso
    // para Math.random (gera divergência host/challenger).
    const rawSeed = Number(snapshot?.pvpRngSeed);
    const seed = Number.isFinite(rawSeed) && rawSeed > 0 ? (rawSeed >>> 0) : 0;
    if (seed <= 0) {
      logger.error("[coliseuPvpServerResolve] pvpRngSeed inválido ou ausente, abortando", {
        roomId,
        rawSeed,
      });
      return;
    }
    const derived = ((seed ^ turn) >>> 0) || 1;
    const seededRng = engine.createSeededRng(derived);

    const hostAction =
      d.mode === "forced_challenger" ? { type: "fight", moveIndex: 0 } : d.hostAction.action;
    const challengerAction =
      d.mode === "forced_owner"
        ? { type: "fight", moveIndex: 0 }
        : d.challengerAction.action;

    let resolution;
    try {
      resolution = engine.resolveTurn({
        playerTeam: snapshot.ownerTeam,
        enemyTeam: snapshot.challengerTeam,
        playerActive: asNum(snapshot.ownerActive),
        enemyActive: asNum(snapshot.challengerActive),
        playerAction: hostAction,
        enemyAction: challengerAction,
        canRun: false,
        isForcedPlayerSwitch: d.mode === "forced_owner",
        isForcedEnemySwitch: d.mode === "forced_challenger",
        typeMultiplier,
        fieldState: snapshot.fieldState,
        gymType: null,
        rng: seededRng,
        lockEnemyAction: true,
      });
    } catch (e) {
      logger.error("[pvp:serverResolve] engine threw", {
        roomId,
        turn,
        epoch: currentEpoch,
        mode: d.mode,
        message: e?.message || String(e),
      });
      return { ok: false, reason: "engine_threw" };
    }

    const nextSnapshot = buildNextSnapshot(snapshot, resolution);
    const pendingForcedSide = computeForcedSide(nextSnapshot);
    const finished =
      nextSnapshot.result === "victory" || nextSnapshot.result === "defeat";

    const patch = {
      pvpBattleSnapshot: nextSnapshot,
      pvpPendingForcedSide: pendingForcedSide,
      pvpLastEventsCanonical: resolution.events,
      pvpResolutionEpoch: currentEpoch + 1,
      pvpCurrentTurn: turn + 1,
      pvpHostAction: null,
      pvpChallengerAction: null,
      pvpTurnStatus: "waiting_actions",
      pvpLastResolvedAt: FieldValue.serverTimestamp(),
      pvpLastResolvedBy: "server",
      pvpCurrentTurnStartedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (finished) {
      patch.status = "finished";
      patch.pvpLastBattleResult =
        nextSnapshot.result === "victory" ? "victory" : "defeat";
    } else {
      patch.pvpLastBattleResult = "ongoing";
    }

    tx.update(ref, patch);
    return {
      ok: true,
      finished,
      turn,
      nextTurn: turn + 1,
      result: nextSnapshot.result,
      eventsCount: Array.isArray(resolution.events) ? resolution.events.length : 0,
    };
  });
}

exports.coliseuPvpServerResolve = onDocumentUpdated(
  {
    document: "battleRooms/{roomId}",
    region: BATTLE_REGION,
    // Preview pequeno — a engine é determinística e leve.
    memory: "512MiB",
    timeoutSeconds: 30,
    // Concorrência forçada a 1 por instância para evitar race no mesmo doc.
    concurrency: 1,
  },
  async (event) => {
    const roomId = event.params?.roomId;
    if (!roomId) return;
    const afterSnap = event.data?.after;
    const beforeSnap = event.data?.before;
    if (!afterSnap || !afterSnap.exists) return;
    const after = afterSnap.data();
    const before = beforeSnap?.data?.() || null;

    const decision = canResolve(after);
    if (!decision) return;

    // Optimization: só dispara quando ESTE write trouxe a última ação que
    // faltava. Se o estado anterior já era resolvível e ninguém pegou, o
    // scheduled `coliseuPvpTurnTimeoutTick` acaba assumindo — mas tentamos
    // resolver aqui mesmo assim (defensivo).
    const beforeDecision = canResolve(before);
    // Se o before já era resolvível e o epoch não mudou, provavelmente outro
    // invocation já está processando — ainda tentamos via transaction (guard
    // de epoch fecha a race).

    const expectedEpoch = asNum(after.pvpResolutionEpoch);

    try {
      const db = getFirestore();
      const res = await resolveTurnOnDoc(db, roomId, expectedEpoch, decision);
      if (res.ok) {
        logger.info("[pvp:serverResolve] turn resolved", {
          roomId,
          turn: res.turn,
          nextTurn: res.nextTurn,
          mode: decision.mode,
          finished: res.finished,
          result: res.result,
          events: res.eventsCount,
        });
      } else if (res.reason !== "epoch_advanced" && res.reason !== "no_longer_resolvable") {
        logger.warn("[pvp:serverResolve] skipped", {
          roomId,
          reason: res.reason,
          epoch: expectedEpoch,
        });
      }
    } catch (e) {
      logger.error("[pvp:serverResolve] transaction failed", {
        roomId,
        message: e?.message || String(e),
      });
    }
  }
);
