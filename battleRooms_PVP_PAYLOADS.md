# battleRooms — exemplos de payload (PvP)

Campos principais em `in_battle`:

- `pvpCurrentTurn`: número do turno em coleta (igual a `pvpBattleSnapshot.collectingTurn`).
- `pvpPendingForcedSide`: `null` | `"owner"` | `"challenger"` — espelha `pvpBattleSnapshot.pendingForcedSide`.
- `pvpHostAction` / `pvpChallengerAction`: `{ turn: number, action: BattleAction }` ou `null`.
- `pvpBattleSnapshot`: JSON do snapshot v1 (times, field, `pendingForcedSide`, etc.).

## Válidos

### Challenger envia golpe (turno completo)

```json
{
  "pvpChallengerAction": {
    "turn": 3,
    "action": { "type": "fight", "moveIndex": 0 }
  },
  "updatedAt": "<serverTimestamp>"
}
```

Condição: `pvpPendingForcedSide == null`, `pvpCurrentTurn == 3`, usuário = `challengerUid`, demais campos PvP inalterados.

### Host envia troca obrigatória

```json
{
  "pvpHostAction": {
    "turn": 5,
    "action": { "type": "switch", "targetIndex": 2 }
  },
  "updatedAt": "<serverTimestamp>"
}
```

Condição: `pvpPendingForcedSide == "owner"`, `pvpChallengerAction == null`.

### Host resolve (apenas o owner)

Update único incluindo, entre outros:

- `pvpBattleSnapshot` (novo)
- `pvpPendingForcedSide`
- `pvpLastEventsCanonical`
- `pvpLastBattleResult`
- `pvpResolutionEpoch`: anterior + 1
- `pvpCurrentTurn`: alinhado ao snapshot
- `pvpHostAction`: null
- `pvpChallengerAction`: null
- `pvpTurnStatus`: `"waiting_actions"`
- `status`: `"finished"` somente se resultado final

## Inválidos (devem falhar nas regras ou na transação cliente)

### Challenger tenta alterar snapshot

Qualquer write em `pvpBattleSnapshot` por `challengerUid` → **deny**.

### Turno errado

```json
{ "pvpHostAction": { "turn": 999, "action": { "type": "fight", "moveIndex": 0 } } }
```

com `pvpCurrentTurn == 3` → deny / erro cliente.

### Host tenta enviar golpe durante forced do challenger

`pvpPendingForcedSide == "challenger"` e body contém `pvpHostAction` não nulo → deny / erro cliente.

### Challenger simula `pvpResolutionEpoch++`

Challenger não pode incluir `pvpResolutionEpoch` no diff (regra `battleRoomPvpOwnerResolvePatch` só para owner).

### Espectador altera sala

Usuário que não é `ownerUid` nem `challengerUid` → read/write negados em `in_battle` / `finished`.
