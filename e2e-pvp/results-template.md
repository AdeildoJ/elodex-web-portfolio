# Coliseu PVP — Resultado da sessão E2E

**Data**: _____________
**Executante**: _____________
**Build mobile**: Expo Go / Dev Client / Prod (rodeie)
**Commit do projeto**: `____________________`

**Contas de teste**:
- A (host): `uid=_______________ charId=_______________`
- B (challenger): `uid=_______________ charId=_______________`

**Logs capturados em arquivo**: ex. `e2e-2026-04-21.log` (sim/não)

---

## Marque o resultado de cada cenário

Legenda: ✅ passou · ❌ falhou · ⏭ pulado · 🟡 passou com ressalva

| # | Cenário | Resultado | roomId / battleRoomId | Observação |
|---|---|---|---|---|
| 1 | Criar sala aberta                          |   |   |   |
| 2 | Criar sala fechada com senha               |   |   |   |
| 3 | Entrar com senha correta                   |   |   |   |
| 4 | Bloquear entrada com senha errada          |   |   |   |
| 5 | Confirmar time válido                      |   |   |   |
| 6a | Team com quantidade errada                |   |   |   |
| 6b | Team com nível excedente                  |   |   |   |
| 7 | Iniciar batalha                            |   |   |   |
| 8a | Turno de ataque normal                    |   |   |   |
| 8b | Turno com troca                           |   |   |   |
| 8c | Timeout com skip                          |   |   |   |
| 8d | Timeout com forfeit                       |   |   |   |
| 9 | Vitória/derrota natural                    |   |   |   |
| 10 | Encerramento da sala + escrow consumido   |   |   |   |
| 11 | Histórico salvo nos dois lados            |   |   |   |
| 12a | Rules negam write sensível do cliente    |   |   |   |
| 12b | Guard reverte injeção admin inválida     |   |   |   |
| 12c | Cliente sem drift                        |   |   |   |

---

## Para cada ❌ / 🟡, preencha abaixo

### Cenário X

**Comando executado**:
```
node admin/e2e-pvp/asserter.js <...>
```

**Saída do asserter** (JSON):
```json

```

**Logs relevantes** (cole últimos ~20 linhas da Cloud Functions correspondente):
```

```

**Observação**: (o que você viu acontecer no app; se o doc ficou em estado inconsistente; timestamps, etc.)

---

## Dumps úteis de referência

```
$ node admin/e2e-pvp/asserter.js dump:battle <battleRoomId>
```
```json

```

```
$ node admin/e2e-pvp/asserter.js dump:room <roomId>
```
```json

```

---

## Saldos antes e depois (cenário 10)

Personagem A (vencedor):

| Métrica | Antes | Depois | Delta esperado |
|---|---|---|---|
| PokeCoins | | | +300 × N |
| ECoin (se em aposta) | | | + stake total |
| Item (se em aposta) | | | + qtd stakada |

Personagem B (perdedor):

| Métrica | Antes | Depois | Delta esperado |
|---|---|---|---|
| PokeCoins | | | +150 × N |
| ECoin (se em aposta) | | | - stake |
| Item (se em aposta) | | | - qtd stakada |

---

## Conclusão

- Todos os 12 cenários passaram? (sim/não)
- Há cenários parcialmente OK que precisam de follow-up? (lista)
- Bloqueios / crashes observados fora do runbook? (descreva)

---

Enviar este arquivo de volta para a equipe de engine junto com o log de functions (`e2e-*.log`).
