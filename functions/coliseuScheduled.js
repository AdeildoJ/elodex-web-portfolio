/**
 * Coliseu PvP — jobs periódicos de integridade.
 *
 * - `cleanupColiseuOrphans` (a cada 2 minutos)
 *    1) Cancela salas cujo criador deixou de enviar heartbeat há > 120s
 *       (isso sinaliza desconexão). Escrow é devolvido a ambos os lados.
 *    2) Expira salas com `expiresAtMs` no passado que ainda estão ativas.
 *
 * - `coliseuPvpTurnTimeoutTick` (a cada 1 minuto)
 *    Encerra batalhas em `status="in_battle"` cujo turno atual não evoluiu
 *    há mais que `HARD_TURN_TIMEOUT_MS` (5 minutos). A semântica é:
 *      - Se um lado não enviou ação, ele sofre forfeit (resultado do outro).
 *      - Se nenhum dos lados enviou, cancela a batalha (resultado vira "ran").
 *    Isso é um **safety net server-side** complementar ao soft-skip de 90s
 *    que o client-side aplica no `PvpBattleSceneBridge`. Aqui só pegamos os
 *    casos em que o app foi fechado/crashou e o próprio soft-skip não rodou.
 *
 * Região: southamerica-east1 (mesma das demais).
 */

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const { refundEscrowInTx } = require("./coliseuAdmin");

const REGION = { region: "southamerica-east1" };
const COLISEU_ROOMS = "coliseu_rooms";
const BATTLE_ROOMS = "battleRooms";

/** Tempo sem heartbeat que consideramos o criador desconectado (no lobby). */
const HEARTBEAT_DEAD_MS = 120_000; // 2 minutos
/** Limite "soft" de ausência durante batalha → força skip da ação do turno. */
const PVP_SKIP_AFTER_MS = 45_000;
/** Limite "hard" de ausência durante batalha → forfeit automático. */
const PVP_FORFEIT_AFTER_MS = 90_000;
/** Fallback último recurso — turno parado sem resolução há 5min. */
const HARD_TURN_TIMEOUT_MS = 300_000;

// ---------- Orphan cleanup ----------

const cleanupColiseuOrphans = onSchedule(
  { ...REGION, schedule: "every 2 minutes" },
  async () => {
    const db = getFirestore();
    const nowMs = Date.now();
    const heartbeatCutoff = Timestamp.fromMillis(nowMs - HEARTBEAT_DEAD_MS);

    // Selecionamos salas ativas (status aberto) — limite defensivo para não
    // varrer coleção inteira; 50 é suficiente dada a escala atual.
    const q = await db.collection(COLISEU_ROOMS)
      .where("status", "in", ["waiting", "picking", "ready"])
      .limit(100)
      .get();

    let orphanCount = 0;
    let expiredCount = 0;

    for (const docSnap of q.docs) {
      const r = docSnap.data() || {};
      const roomId = docSnap.id;
      const creatorUid = String(r.creatorUid || "");
      if (!creatorUid) continue;

      const lastSeen = r.creatorLastSeenAt;
      const expiresAt = Number(r.expiresAtMs || 0);
      const isExpired = expiresAt > 0 && nowMs >= expiresAt;
      const isOrphan =
        lastSeen instanceof Timestamp
          ? lastSeen.toMillis() < heartbeatCutoff.toMillis()
          : false;

      if (!isExpired && !isOrphan) continue;

      try {
        await db.runTransaction(async (tx) => {
          const ref = db.doc(`${COLISEU_ROOMS}/${roomId}`);
          const snap = await tx.get(ref);
          if (!snap.exists) return;
          const cur = snap.data() || {};
          const status = String(cur.status || "");
          if (status === "in_battle" || status === "finished" || status === "cancelled" || status === "expired") {
            return; // já evoluiu; não tocamos.
          }

          // Refund de escrow de ambos os lados (idempotente).
          if (cur.escrowActive === true) {
            await refundEscrowInTx(tx, db, { uid: creatorUid, roomId });
            if (cur.opponent && cur.opponent.uid) {
              await refundEscrowInTx(tx, db, { uid: cur.opponent.uid, roomId });
            }
          }

          tx.set(ref, {
            status: isExpired ? "expired" : "cancelled",
            escrowActive: false,
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        });

        if (isExpired) expiredCount++; else orphanCount++;
      } catch (err) {
        logger.warn("coliseu_orphan_cleanup_failed", { roomId, err: String(err?.message || err) });
      }
    }

    if (orphanCount || expiredCount) {
      logger.info("coliseu_orphan_cleanup_done", { orphanCount, expiredCount, scanned: q.size });
    }
  }
);

// ---------- PvP turn timeout ----------

/**
 * Verifica presença de ambos jogadores via `pvpHostLastSeenAt` /
 * `pvpChallengerLastSeenAt` (heartbeat de 15s do client) e resolve:
 *
 *  - forfeit se algum lado está ausente > `PVP_FORFEIT_AFTER_MS` (90s)
 *  - skip (injeta ação default) se ausente > `PVP_SKIP_AFTER_MS` (45s)
 *    mas dentro da janela de forfeit — dá chance de reconexão.
 *
 * Retorna `null` se nada a fazer. Retorna um objeto `{ kind }` descrevendo
 * a ação a aplicar na transaction.
 */
function decideHeartbeatAction(br, nowMs) {
  const host = br.pvpHostAction;
  const challenger = br.pvpChallengerAction;
  const turn = Number(br.pvpCurrentTurn) || 1;
  const forced = String(br.pvpPendingForcedSide || "");

  // Baseline de presença: heartbeat mais recente OU (fallback) last resolved.
  const hostSeen = br.pvpHostLastSeenAt instanceof Timestamp ? br.pvpHostLastSeenAt.toMillis() : null;
  const challengerSeen =
    br.pvpChallengerLastSeenAt instanceof Timestamp ? br.pvpChallengerLastSeenAt.toMillis() : null;

  const hostMissing = hostSeen == null ? null : nowMs - hostSeen;
  const challengerMissing = challengerSeen == null ? null : nowMs - challengerSeen;

  const hostGone = hostMissing != null && hostMissing > PVP_FORFEIT_AFTER_MS;
  const challengerGone = challengerMissing != null && challengerMissing > PVP_FORFEIT_AFTER_MS;

  // Forfeit tem precedência.
  if (hostGone && challengerGone) {
    return { kind: "forfeit_both", result: "ran", reason: "both_abandoned" };
  }
  if (hostGone) {
    return { kind: "forfeit", result: "defeat", reason: "host_disconnected" };
  }
  if (challengerGone) {
    return { kind: "forfeit", result: "victory", reason: "challenger_disconnected" };
  }

  // Skip: força ação default se o lado ativo demorou > 45s e não mandou ação.
  // Em forced switch, só o lado forçado precisa agir.
  const hostActed = host && Number(host.turn) === turn && host.action;
  const challengerActed = challenger && Number(challenger.turn) === turn && challenger.action;

  if (forced === "owner") {
    if (!hostActed && hostMissing != null && hostMissing > PVP_SKIP_AFTER_MS) {
      // targetIndex é resolvido em runtime na transação (precisa ler o snapshot
      // atual para escolher o primeiro vivo). Sentinel `null` força a transação
      // a calcular ou cair em forfeit preventivo se não houver substituto.
      return { kind: "skip", side: "owner", action: { type: "switch", targetIndex: null } };
    }
  } else if (forced === "challenger") {
    if (!challengerActed && challengerMissing != null && challengerMissing > PVP_SKIP_AFTER_MS) {
      return { kind: "skip", side: "challenger", action: { type: "switch", targetIndex: null } };
    }
  } else {
    if (!hostActed && hostMissing != null && hostMissing > PVP_SKIP_AFTER_MS) {
      return { kind: "skip", side: "owner", action: { type: "fight", moveIndex: 0 } };
    }
    if (!challengerActed && challengerMissing != null && challengerMissing > PVP_SKIP_AFTER_MS) {
      return { kind: "skip", side: "challenger", action: { type: "fight", moveIndex: 0 } };
    }
  }

  // Fallback ultra conservador: turno parado há > 5min (nem heartbeat, nem ação).
  // Só dispara se NENHUMA das condições acima já resolveu.
  const baseline =
    (br.pvpCurrentTurnStartedAt instanceof Timestamp && br.pvpCurrentTurnStartedAt.toMillis()) ||
    (br.pvpLastResolvedAt instanceof Timestamp && br.pvpLastResolvedAt.toMillis()) ||
    (br.updatedAt instanceof Timestamp && br.updatedAt.toMillis()) ||
    nowMs;
  if (nowMs - baseline > HARD_TURN_TIMEOUT_MS) {
    return { kind: "forfeit", result: "ran", reason: "hard_turn_timeout" };
  }
  return null;
}

/**
 * Encontra o primeiro índice vivo diferente do ativo para usar como switch
 * default. Fallback `-1` se não houver substituto.
 */
function pickFirstAliveAlternative(team, activeIndex) {
  if (!Array.isArray(team)) return -1;
  for (let i = 0; i < team.length; i++) {
    if (i === activeIndex) continue;
    const hp = Number(team[i]?.hpCurrent);
    if (Number.isFinite(hp) && hp > 0) return i;
  }
  return -1;
}

const coliseuPvpTurnTimeoutTick = onSchedule(
  { ...REGION, schedule: "every 1 minutes" },
  async () => {
    const db = getFirestore();
    const nowMs = Date.now();

    const q = await db.collection(BATTLE_ROOMS)
      .where("status", "==", "in_battle")
      .limit(100)
      .get();

    let forfeitCount = 0;
    let skipCount = 0;

    for (const docSnap of q.docs) {
      const br = docSnap.data() || {};
      const roomId = docSnap.id;
      const decision = decideHeartbeatAction(br, nowMs);
      if (!decision) continue;

      try {
        await db.runTransaction(async (tx) => {
          const ref = db.doc(`${BATTLE_ROOMS}/${roomId}`);
          const snap = await tx.get(ref);
          if (!snap.exists) return;
          const cur = snap.data() || {};
          if (String(cur.status || "") !== "in_battle") return;

          if (decision.kind === "forfeit" || decision.kind === "forfeit_both") {
            tx.set(ref, {
              status: "finished",
              pvpLastBattleResult: decision.result,
              pvpForfeitReason: decision.reason,
              pvpForfeitedAt: FieldValue.serverTimestamp(),
              pvpHostAction: null,
              pvpChallengerAction: null,
              pvpTurnStatus: "finished",
              updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
            return;
          }

          if (decision.kind === "skip") {
            // Injeta ação default do lado ausente. A trigger
            // `coliseuPvpServerResolve` pega quando ambas as ações estão
            // presentes para o turno corrente.
            const turn = Number(cur.pvpCurrentTurn) || 1;
            const snapshot = cur.pvpBattleSnapshot || {};
            let action = decision.action;
            // Se a default é switch mas não há substituto vivo, muda para fight.
            if (action?.type === "switch") {
              const team = decision.side === "owner" ? snapshot.ownerTeam : snapshot.challengerTeam;
              const activeIdx = decision.side === "owner" ? snapshot.ownerActive : snapshot.challengerActive;
              const alt = pickFirstAliveAlternative(team, activeIdx);
              if (alt < 0) {
                // Sem substituto → forfeit preventivo.
                tx.set(ref, {
                  status: "finished",
                  pvpLastBattleResult: decision.side === "owner" ? "defeat" : "victory",
                  pvpForfeitReason: `${decision.side}_no_substitute`,
                  pvpForfeitedAt: FieldValue.serverTimestamp(),
                  pvpHostAction: null,
                  pvpChallengerAction: null,
                  pvpTurnStatus: "finished",
                  updatedAt: FieldValue.serverTimestamp(),
                }, { merge: true });
                return;
              }
              action = { type: "switch", targetIndex: alt };
            }
            const field = decision.side === "owner" ? "pvpHostAction" : "pvpChallengerAction";
            tx.set(ref, {
              [field]: { turn, action },
              [decision.side === "owner" ? "pvpHostSkipped" : "pvpChallengerSkipped"]:
                FieldValue.arrayUnion(turn),
              updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
          }
        });

        if (decision.kind === "skip") skipCount++;
        else forfeitCount++;
        logger.info("coliseu_pvp_timeout_action", {
          roomId,
          kind: decision.kind,
          reason: decision.reason,
          result: decision.result,
          side: decision.side,
        });
      } catch (err) {
        logger.warn("coliseu_pvp_timeout_action_failed", {
          roomId,
          err: String(err?.message || err),
        });
      }
    }

    if (forfeitCount > 0 || skipCount > 0) {
      logger.info("coliseu_pvp_timeout_tick_done", {
        forfeitCount,
        skipCount,
        scanned: q.size,
      });
    }
  }
);

module.exports = {
  cleanupColiseuOrphans,
  coliseuPvpTurnTimeoutTick,
};
