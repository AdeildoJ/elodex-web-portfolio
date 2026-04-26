# Coliseu PVP — E2E Runbook

Validação **runtime ponta-a-ponta** do PVP server-authoritative.

Este runbook cobre 12 cenários com asserts objetivos. Use em par com dois dispositivos (ou Expo + emulador Android) logados em contas distintas (`A` = host/criador, `B` = challenger).

---

## 0. Pré-requisitos

### 0.1 Credenciais locais

- `admin/serviceAccountKey.json` (já usado por `admin/scripts/*`). Sem isso o asserter falha com `service_account_missing`.

### 0.2 Dependências

```powershell
cd C:\Projetos\EloDex-app\admin\functions
npm install                    # garante firebase-admin instalado (asserter usa a mesma cópia)
```

### 0.3 Deploy (apenas uma vez, ou após mudanças)

```powershell
cd C:\Projetos\EloDex-app\admin\functions
npm run build:engine           # gera pvpEngine/engine.bundle.cjs
firebase deploy --only functions:startColiseuPvpBattleHttp,`
                         functions:coliseuPvpServerResolve,`
                         functions:coliseuAutoSettleOnFinish,`
                         functions:coliseuBattleHistoryOnFinish,`
                         functions:coliseuPvpTurnTimeoutTick,`
                         functions:coliseuPvpResolveGuard,`
                         functions:cleanupColiseuOrphans,`
                         functions:createColiseuRoomHttp,`
                         functions:joinColiseuRoomHttp,`
                         functions:cancelColiseuRoomHttp,`
                         functions:kickColiseuOpponentHttp,`
                         functions:touchColiseuRoomHttp
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
```

### 0.4 Streaming de logs (terminal separado)

```powershell
firebase functions:log --only coliseuPvpServerResolve,coliseuPvpTurnTimeoutTick,coliseuPvpResolveGuard,coliseuAutoSettleOnFinish,startColiseuPvpBattleHttp,joinColiseuRoomHttp
```

Alternativa moderna:

```powershell
gcloud functions logs read coliseuPvpServerResolve --region=southamerica-east1 --limit=50
```

### 0.5 Helper do asserter

Todos os comandos abaixo têm a forma:

```powershell
cd C:\Projetos\EloDex-app
node admin/e2e-pvp/asserter.js <comando> <args>
```

Exit code 0 = passou. Exit 1 = falhou (veja o JSON retornado). Exit 2 = erro operacional.

> Anote o `roomId` (ID do doc em `coliseu_rooms`) assim que a sala for criada — ele é a chave de tudo. O `battleRoomId` é derivado: `coliseu-<roomId>`.

---

## Cenário 1 — Criar sala aberta

**Executante**: A.

**Passos**:
1. No app A: `Batalhas → Coliseu → Criar sala`.
2. Nome: `E2E-Open-01` (3–24 chars). Tipo: `Aberta`. `maxPokemons=3`, `maxLevel=50`. Sem aposta extra.
3. Confirmar.

**Asserts**:
```powershell
node admin/e2e-pvp/asserter.js assert:room-created <roomId>
```

**Esperado** (`ok: true`):
```json
{ "ok": true, "type": "open", "hasPassword": false, "name": "E2E-Open-01", "creatorUid": "<A>" }
```

**Logs esperados**: `createColiseuRoomHttp` retornando 200; `coliseu_room_created` no Cloud Logging com `type:"open"`, `hasPassword:false`.

**Edge**: se retornar `shape_invalid`, copie o JSON inteiro para o template de resultado.

---

## Cenário 2 — Criar sala fechada com senha

**Executante**: A.

**Passos**:
1. No app A: `Criar sala`. Nome: `E2E-Closed-01`. Tipo: `Fechada`. Senha: `teste123` (use algo ≥ 4 e ≤ 32 chars — validate via UI, não olhe o range no código).
2. Confirmar.

**Asserts**:
```powershell
node admin/e2e-pvp/asserter.js assert:room-created <roomId>
node admin/e2e-pvp/asserter.js assert:password-set <roomId>
```

**Esperado**:
- `assert:room-created` → `type:"closed"`, `hasPassword:true`.
- `assert:password-set` → `passwordHashLen` entre ~80 e ~90 (scrypt 64 bytes em base64), `passwordSaltLen` ~24.

**Anti-assert (segurança)**: confirme que `passwordHash` **não é legível pelo cliente** — abra o documento no Firestore Console como user não-admin (ou use o client, ele não deve exibir).

---

## Cenário 3 — Entrar com senha correta

**Executante**: B.

**Passos**:
1. B abre a aba Coliseu e vê `E2E-Closed-01` com cadeado.
2. Toca → prompt de senha → digita `teste123` → entra.

**Asserts**:
```powershell
node admin/e2e-pvp/asserter.js assert:opponent-joined <roomId> <uidB>
```

**Esperado**: `status: "picking"` ou `"ready"`, `opponentUid == <uidB>`.

---

## Cenário 4 — Bloquear entrada com senha errada

**Executante**: B (após SAIR da sala para re-tentar — ou use outra conta C).

**Passos**:
1. Conta C (ou B saindo): tenta entrar em `E2E-Closed-01` com senha `errada123`.
2. Deve aparecer erro (`Senha incorreta.`).

**Asserts** (a sala **não pode** ter sido alterada):
```powershell
node admin/e2e-pvp/asserter.js dump:room <roomId>
```

**Esperado**: se era a primeira tentativa (sem B já dentro), `opponent: null`. Se B já estava dentro do cenário 3, continua sendo B.

**Logs esperados**: `joinColiseuRoomHttp` com status HTTP 4xx e `Senha incorreta.`.

---

## Cenário 5 — Confirmar time válido

**Executante**: A e B (use `E2E-Open-01` do cenário 1, ou outra sala aberta limpa).

**Passos**:
1. A e B montam o time (3 pokémon, nível ≤ 50), pressionam `Pronto`.

**Asserts**:
```powershell
node admin/e2e-pvp/asserter.js assert:picks-ready <roomId>
```

**Esperado**: `teamSize: 3`, sem `problems`.

---

## Cenário 6 — Bloquear time inválido

Este cenário valida o backend. **Cada sub-teste é independente** (pode ser feito em 1 sala descartável).

### 6a — Team com menos pokémon que `maxPokemons`
**Passos**: no app, montar apenas 2 de 3 e tentar `Pronto`.
**Esperado na UI**: botão Pronto bloqueado ou mensagem de erro client-side.
**Asserts** (estado não avança):
```powershell
node admin/e2e-pvp/asserter.js dump:room <roomId>
```
→ `creatorPickReady` deve permanecer `false`.

### 6b — Team com nível excedente (via cliente adulterado)
Se você tiver como manipular o app (ex: devtool), tente salvar um pokémon nível 100 em sala `maxLevel=50` e iniciar batalha.
**Asserts**:
```powershell
node admin/e2e-pvp/asserter.js assert:picks-ready <roomId>
```
→ deve retornar `ok: false` com problema `acima do nível máximo`. **E**, ao chamar Iniciar, o `startColiseuPvpBattleHttp` deve responder 4xx. Ver log.

---

## Cenário 7 — Iniciar batalha

**Executante**: A (owner) em sala aberta com A e B prontos.

**Passos**:
1. A toca `Iniciar Batalha`.

**Asserts**:
```powershell
node admin/e2e-pvp/asserter.js assert:battle-started <roomId>
# capture o battleRoomId retornado; alternativa: $bid = "coliseu-$roomId"
```

**Esperado**:
- `coliseu_rooms/<roomId>`: `status:"in_battle"`, `linkedBattleRoomId:"coliseu-<roomId>"`.
- `battleRooms/coliseu-<roomId>`: `status:"in_battle"`, `pvpCurrentTurn:1`, `pvpResolutionEpoch:0`, snapshot com ambos os times, ações nulas, `pvpRngSeed` preenchido.

**Logs esperados**: `startColiseuPvpBattleHttp` status 200, `coliseu_pvp_started`.

---

## Cenário 8 — Turnos completos

### 8a — Ataque normal (turno 1 → 2)

**Passos**:
1. A escolhe um movimento.
2. B escolhe um movimento.

**Asserts** (dentro de ~5s após ambos escolherem):
```powershell
node admin/e2e-pvp/asserter.js assert:turn-resolved <battleRoomId> 2 1
node admin/e2e-pvp/asserter.js assert:no-client-writes <battleRoomId>
```

**Esperado**: turno=2, epoch=1, ações nulas, `pvpLastResolvedBy:"server"`, eventos > 0, HPs alterados coerentemente.

**Logs esperados**: `coliseu_pvp_server_resolve_ok` com `epoch: 1`, `events: N`.

### 8b — Troca de pokémon (turno 2 → 3)

**Passos**:
1. A escolhe `Trocar` → seleciona outro pokémon.
2. B escolhe um ataque.

**Asserts**:
```powershell
node admin/e2e-pvp/asserter.js assert:turn-resolved <battleRoomId> 3 2
node admin/e2e-pvp/asserter.js dump:battle <battleRoomId>
```

**Esperado**: `ownerActive` mudou. HP do novo ativo de A sofre dano (B bateu depois da troca, salvo se o movimento tivesse prioridade alta).

### 8c — Timeout com skip (ação automática)

**Objetivo**: forçar o tick a injetar ação default para o lado ausente.

**Passos** (sem precisar esperar 45s reais — usamos o injetor):
1. Ambos A e B devem estar numa batalha `in_battle`. Não escolha ação ainda.
2. Rodar:
```powershell
node admin/e2e-pvp/asserter.js inject:stale-heartbeat <battleRoomId> challenger 50
```
3. Escolha uma ação apenas em A.
4. Aguarde ≤ 1 min (próxima execução do `coliseuPvpTurnTimeoutTick`).

**Asserts**:
```powershell
node admin/e2e-pvp/asserter.js dump:battle <battleRoomId>
```

**Esperado**:
- O documento terá `pvpChallengerAction` injetado pelo tick (tipo `fight` com `moveIndex: 0`, ou `switch` se forced).
- O `coliseuPvpServerResolve` irá resolver logo em seguida → `pvpChallengerSkipped` contém o número do turno.
- Turno avança e ações zeram.

**Logs esperados**: `coliseu_pvp_timeout_action` com `kind:"skip"`, `side:"challenger"`.

### 8d — Timeout com forfeit (derrota automática)

**Passos**:
1. Batalha ativa; escolha qual lado "abandona" (ex.: challenger).
2. Rodar:
```powershell
node admin/e2e-pvp/asserter.js inject:simulate-abandon <battleRoomId> challenger
```
3. Aguarde ≤ 1 min.

**Asserts**:
```powershell
node admin/e2e-pvp/asserter.js assert:battle-finished <battleRoomId> victory
node admin/e2e-pvp/asserter.js dump:battle <battleRoomId>
```

**Esperado**: `status:"finished"`, `pvpLastBattleResult:"victory"` (perspectiva owner), `pvpForfeitReason:"challenger_disconnected"`.

**Logs esperados**: `coliseu_pvp_timeout_action` com `kind:"forfeit"`, `result:"defeat"`.

---

## Cenário 9 — Vitória/derrota natural

**Passos**:
1. Em uma sala fresca, jogue normalmente até zerar o HP do time de um dos lados.

**Asserts** (após o último KO):
```powershell
node admin/e2e-pvp/asserter.js assert:battle-finished <battleRoomId> victory   # ou defeat
node admin/e2e-pvp/asserter.js assert:settlement-done <battleRoomId>
```

**Esperado**: `status:"finished"`, `coliseuPvpCurrencySettled:true`.

**Logs esperados**:
- `coliseu_pvp_server_resolve_ok` com `status:"finished"` no último turno.
- `coliseuAutoSettleOnFinish` disparou → log `coliseu_pvp_currency_settled` (ou similar) com créditos aplicados.

---

## Cenário 10 — Encerramento da sala

Após cenário 9 (ou 8d):

**Asserts**:
```powershell
node admin/e2e-pvp/asserter.js dump:room <roomId>
```

**Esperado**:
- `coliseu_rooms/<roomId>.status:"finished"`.
- Se houve aposta em ECoin/itens, escrow transferido para o vencedor; `pvpEscrow/<roomId>__creator` e `pvpEscrow/<roomId>__opponent` **não existem mais** (foram consumidos):
```powershell
node admin/e2e-pvp/asserter.js dump:escrow <roomId> creator
# deve retornar reason:"not_found"
```

**Se havia aposta**: confirmar no painel do personagem A (vencedor) que as ECoin/itens foram creditados.

---

## Cenário 11 — Histórico salvo

```powershell
node admin/e2e-pvp/asserter.js assert:history-saved <uidA> <charIdA> <battleRoomId>
node admin/e2e-pvp/asserter.js assert:history-saved <uidB> <charIdB> <battleRoomId>
```

**Esperado**: em cada lado, uma entrada com `battleRoomId` coincidente, `result` consistente (`victory`/`defeat`), data em `createdAt`.

---

## Cenário 12 — Cliente só renderiza estado oficial

Duas provas complementares:

### 12a — Regra rejeita writes sensíveis do cliente
No Firestore Console, como **usuário A logado (não admin)**, tentar editar `battleRooms/<battleRoomId>.pvpBattleSnapshot`, `pvpResolutionEpoch`, `pvpCurrentTurn`, `pvpLastEventsCanonical` ou `status`.

**Esperado**: `PERMISSION_DENIED`.

Regra que bloqueia: todas em `admin/firestore.rules` bloco `battleRooms/{roomId}` (linhas 599–810) — `battleRoomPvpParticipantResolve` e `battleRoomParticipantFinish` foram **removidos**; só `pvpHostAction`/`pvpChallengerAction`/heartbeat são aceitos.

### 12b — Admin injection é revertida/marcada pelo guard
Simular "admin comprometido" escrevendo um snapshot inválido via SDK (bypassa rules):
```powershell
node admin/e2e-pvp/asserter.js inject:bad-snapshot <battleRoomId>
```
Aguardar ≤ 10s e inspecionar:
```powershell
node admin/e2e-pvp/asserter.js dump:battle <battleRoomId>
firebase functions:log --only coliseuPvpResolveGuard
```

**Esperado**:
- Log do `coliseuPvpResolveGuard` com alerta/rollback (`coliseu_pvp_resolve_guard_reverted` ou similar).
- `pvpLastResolvedBy` reverteu para `"server"` ou o snapshot foi restaurado para o último estado válido.

### 12c — Bônus: divergência cliente-servidor é silenciosa
Durante a batalha, observe o terminal do Expo (`npx expo start`): nenhuma ação do cliente deve logar `[pvp] drift detected` **enquanto ambos os lados tiverem o bundle de engine alinhado**. Em dev, se houver drift, aparece warning — a batalha prossegue porque o servidor é autoritativo.

---

## Observabilidade — métricas chave

Durante toda a sessão, mantenha aberto em um terminal:
```powershell
firebase functions:log --only coliseuPvpServerResolve,coliseuPvpTurnTimeoutTick,coliseuPvpResolveGuard,coliseuAutoSettleOnFinish
```

Eventos-chave e o que querem dizer:

| Log label | Significado |
|---|---|
| `coliseu_pvp_started` | Batalha criada com sucesso |
| `coliseu_pvp_server_resolve_ok` | Turno resolvido (contém turn, epoch, events) |
| `coliseu_pvp_server_resolve_skipped` | Epoch avançou entre detecção e tx (race benigno) |
| `coliseu_pvp_timeout_action` | Tick injetou skip ou forfeit |
| `coliseu_pvp_resolve_guard_*` | Guarda detectou anomalia no snapshot |
| `coliseu_pvp_currency_settled` | Escrow/ECoin/itens transferidos |
| `coliseu_pvp_currency_settle_error` | Falha no settle — investigar |

---

## Como relatar resultado

Preencha o arquivo `admin/e2e-pvp/results-template.md` marcando cada cenário como ✅ / ❌ e anexando o JSON do asserter para os que falharem. Rode novamente qualquer passo antes de concluir falha — flakes de rede são comuns.

Se precisar que eu ajuste algo, me devolva o template preenchido e os logs relevantes.
