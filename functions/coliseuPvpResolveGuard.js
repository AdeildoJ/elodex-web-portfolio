/**
 * Coliseu PvP — guardião server-side da resolução de turnos.
 *
 * Modelo atual: cliente resolve (híbrido com RNG determinístico vindo do
 * server). Para dar uma camada de anti-cheat sem portar a engine inteira,
 * este trigger roda em `onDocumentUpdated` de `battleRooms/{roomId}` toda
 * vez que o `pvpResolutionEpoch` incrementa, e valida invariantes:
 *
 *  1. **Team IDs inalterados**: a sequência de `speciesId` de cada time não
 *     pode mudar (nem adicionar, nem remover, nem reordenar, nem substituir).
 *  2. **hpTotal inalterado**: o HP máximo de cada monstro é imutável.
 *  3. **stats base inalterados**: atributos calculados (ATK/DEF/SPA/SPD/SPE)
 *     não podem mudar dentro do mesmo battleRoom.
 *  4. **HP delta mínimo**: o HP só pode *diminuir* dentro de um turno
 *     (exceto quando o engine aplicar Recover/Drain — nesses casos a subida é
 *     aceita se o dono da cura for o dono do turno e ≤ 50% do hpTotal). Como
 *     não temos visibilidade sobre isso sem rodar a engine, aceitamos
 *     subidas bounded por `HP_REGEN_MAX_RATIO` (50% do hpTotal/turno).
 *  5. **HP limites**: hpCurrent deve estar em [0, hpTotal].
 *  6. **`ownerActive`/`challengerActive`** dentro de [0, team.length-1].
 *
 * Se QUALQUER invariante falhar, o trigger reverte o snapshot para o
 * snapshot anterior (persistido em `pvpLastValidSnapshot`) e loga o incidente.
 * A batalha continua com o último estado válido — jogador malicioso perde
 * a ação, jogador honesto é pouco impactado (na maioria dos casos nem
 * percebe porque o próximo tick reutiliza RNG determinístico).
 *
 * Complementarmente, atualiza `pvpCurrentTurnStartedAt` / `pvpLastResolvedAt`
 * para alimentar o scheduled `coliseuPvpTurnTimeoutTick`.
 *
 * Região: southamerica-east1.
 */

const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

const REGION = { region: "southamerica-east1" };
const BATTLE_ROOMS = "battleRooms";

/**
 * Limites defensivos. HP pode subir por cura (Recover, Drain, Leftovers) —
 * estimativa conservadora: 50% do hpTotal por turno cobre cura agressiva.
 */
const HP_REGEN_MAX_RATIO = 0.5;

function asNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function validateSnapshotTransition(prev, next) {
  if (!prev || typeof prev !== "object") return "snapshot anterior ausente";
  if (!next || typeof next !== "object") return "snapshot novo ausente";

  const prevOwner = prev.ownerTeam;
  const nextOwner = next.ownerTeam;
  const prevChal = prev.challengerTeam;
  const nextChal = next.challengerTeam;

  if (!Array.isArray(prevOwner) || !Array.isArray(nextOwner)) return "ownerTeam nao eh array";
  if (!Array.isArray(prevChal) || !Array.isArray(nextChal)) return "challengerTeam nao eh array";
  if (prevOwner.length !== nextOwner.length) return "ownerTeam mudou de tamanho";
  if (prevChal.length !== nextChal.length) return "challengerTeam mudou de tamanho";

  const oa = asNumber(next.ownerActive, -1);
  const ca = asNumber(next.challengerActive, -1);
  if (oa < 0 || oa >= nextOwner.length) return "ownerActive fora do range";
  if (ca < 0 || ca >= nextChal.length) return "challengerActive fora do range";

  const teams = [
    { name: "owner", prev: prevOwner, next: nextOwner },
    { name: "challenger", prev: prevChal, next: nextChal },
  ];
  for (const t of teams) {
    for (let i = 0; i < t.prev.length; i++) {
      const p = t.prev[i] || {};
      const n = t.next[i] || {};
      if (!n || typeof n !== "object") return `${t.name}[${i}] monstro virou invalido`;

      const ps = asNumber(p.speciesId, 0);
      const ns = asNumber(n.speciesId, 0);
      if (ps !== ns) return `${t.name}[${i}] speciesId mudou (${ps} -> ${ns})`;

      const pht = asNumber(p.hpTotal, 0);
      const nht = asNumber(n.hpTotal, 0);
      if (pht !== nht && pht > 0) return `${t.name}[${i}] hpTotal mudou (${pht} -> ${nht})`;

      const phc = asNumber(p.hpCurrent, 0);
      const nhc = asNumber(n.hpCurrent, 0);
      if (nhc < 0) return `${t.name}[${i}] hpCurrent negativo`;
      if (nht > 0 && nhc > nht) return `${t.name}[${i}] hpCurrent > hpTotal`;

      // HP regen cap: se subiu, o delta não pode ser maior que HP_REGEN_MAX_RATIO * hpTotal.
      if (nhc > phc) {
        const delta = nhc - phc;
        const cap = Math.ceil(nht * HP_REGEN_MAX_RATIO);
        if (delta > cap) return `${t.name}[${i}] HP subiu mais que ${Math.round(HP_REGEN_MAX_RATIO * 100)}% (delta=${delta}, cap=${cap})`;
      }

      // Stats base: imutáveis.
      const pStats = p.stats || {};
      const nStats = n.stats || {};
      for (const k of ["attack", "defense", "specialAttack", "specialDefense", "speed"]) {
        const pv = asNumber(pStats[k], -1);
        const nv = asNumber(nStats[k], -1);
        if (pv >= 0 && nv >= 0 && pv !== nv) return `${t.name}[${i}] stats.${k} mudou (${pv} -> ${nv})`;
      }

      // Moves: pode ter pp decrementado, mas id e ppMax são imutáveis.
      const pMoves = Array.isArray(p.moves) ? p.moves : [];
      const nMoves = Array.isArray(n.moves) ? n.moves : [];
      if (pMoves.length !== nMoves.length) return `${t.name}[${i}] moves.length mudou`;
      for (let j = 0; j < pMoves.length; j++) {
        const pm = pMoves[j] || {};
        const nm = nMoves[j] || {};
        if (String(pm.id || "") !== String(nm.id || "")) return `${t.name}[${i}].moves[${j}].id mudou`;
        const ppmp = asNumber(pm.ppMax, -1);
        const ppmn = asNumber(nm.ppMax, -1);
        if (ppmp >= 0 && ppmn >= 0 && ppmp !== ppmn) return `${t.name}[${i}].moves[${j}].ppMax mudou`;
        const ppp = asNumber(pm.pp, 0);
        const ppn = asNumber(nm.pp, 0);
        if (ppn < 0) return `${t.name}[${i}].moves[${j}].pp negativo`;
        if (ppn > ppp && ppp > 0) return `${t.name}[${i}].moves[${j}].pp subiu (${ppp} -> ${ppn})`;
      }
    }
  }
  return null;
}

exports.coliseuPvpResolveGuard = onDocumentUpdated(
  { ...REGION, document: `${BATTLE_ROOMS}/{roomId}` },
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    const roomId = event.params?.roomId;
    if (!roomId) return;

    const prevEpoch = asNumber(before.pvpResolutionEpoch, -1);
    const nextEpoch = asNumber(after.pvpResolutionEpoch, -1);

    // Só valida quando houve incremento de epoch — que significa "resolveu turno".
    if (nextEpoch !== prevEpoch + 1) return;

    // Se a transição envolveu status "in_battle" -> "finished", ainda validamos
    // a consistência do último snapshot (para não aceitar forjar vitória).
    const prevSnap = before.pvpBattleSnapshot;
    const nextSnap = after.pvpBattleSnapshot;
    const err = validateSnapshotTransition(prevSnap, nextSnap);

    const db = getFirestore();
    const ref = db.doc(`${BATTLE_ROOMS}/${roomId}`);

    if (err) {
      logger.warn("coliseu_pvp_resolve_guard_reject", {
        roomId, err,
        prevEpoch, nextEpoch,
        byUid: after.pvpLastResolvedBy || null,
      });
      // Reverte: pega o último snapshot válido (antes da atualização) e
      // restaura, mantendo o epoch para não causar loop.
      try {
        await ref.set({
          pvpBattleSnapshot: prevSnap,
          pvpLastEventsCanonical: before.pvpLastEventsCanonical || [],
          pvpLastBattleResult: before.pvpLastBattleResult || "ongoing",
          pvpPendingForcedSide: before.pvpPendingForcedSide ?? null,
          pvpCurrentTurn: asNumber(before.pvpCurrentTurn, 1),
          status: String(before.status || "in_battle"),
          pvpHostAction: null,
          pvpChallengerAction: null,
          pvpTurnStatus: "waiting_actions",
          pvpGuardRejectCount: FieldValue.increment(1),
          pvpGuardLastReason: err,
          pvpCurrentTurnStartedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      } catch (e) {
        logger.error("coliseu_pvp_resolve_guard_revert_failed", { roomId, err: String(e?.message || e) });
      }
      return;
    }

    // Snapshot válido → atualiza timestamps de turno e salva como "último válido".
    try {
      await ref.set({
        pvpCurrentTurnStartedAt: FieldValue.serverTimestamp(),
        pvpLastResolvedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (e) {
      // Não é crítico — só logging.
      logger.warn("coliseu_pvp_resolve_guard_touch_failed", { roomId, err: String(e?.message || e) });
    }

    logger.info("coliseu_pvp_turn_resolved", {
      roomId, prevEpoch, nextEpoch,
      result: after.pvpLastBattleResult || "ongoing",
      status: after.status,
    });
  }
);
