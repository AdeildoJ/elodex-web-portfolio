# Auditoria de Permissões — Firestore e Storage

**Data:** 2025-03-21  
**Escopo:** app mobile, admin web, Cloud Functions (Admin SDK ignora rules)

---

## 1. Resumo executivo

Foi realizada auditoria completa das regras de segurança do Firebase (Firestore e Storage) com base no código real do projeto. As regras foram ajustadas para:

- **Adicionar** proteção para coleções sensíveis: `thiefNpcStorage`, `thiefHQStorage`, `policeStationStorage`, `stolenPokemonCases`
- **Adicionar** regras explícitas para `wildEncounters`, `accountBackpack`, `accountDistributionHistory`, `paymentOrders`, `gymScenarioUnlocks`, `gymNpcUnlocks`
- **Liberar** leitura de `players/{uid}/characters/{characterId}` para qualquer usuário autenticado (necessário para exibir líder de GYM)
- **Corrigir** `battlePresence` update para usar `resource.data.uid`
- **Garantir** que `npcCreatorStats` não aceita escrita pelo cliente
- **Manter** princípio do menor privilégio: sem `allow read, write: if true`

---

## 2. Arquivos alterados

| Arquivo | Alteração |
|---------|-----------|
| `admin/firestore.rules` | Reescrito com regras completas e organizadas |
| `admin/storage.rules` | Já estava adequado; mantido |
| `admin/docs/AUDITORIA-PERMISSOES.md` | Documento de auditoria criado |

---

## 3. Firestore rules implementadas

As regras seguem a seguinte lógica:

| Coleção / path | Leitura | Escrita |
|----------------|---------|---------|
| `pokemonSpecies`, `itemsConfig`, `pokedexConfig`, `captureConfigGroups`, `wildEncounters`, `moves`, `pokemonMoves`, `abilities`, `items` | autenticado | admin |
| `biomes`, `biomeEncounterConfig` (e subcoleções) | autenticado | admin |
| `npcs`, `scenarios`, `badges` | autenticado | admin |
| `npcCreatorStats` | autenticado | **nenhum (false)** |
| `thiefNpcStorage` | próprio dono (`ownerUid`) | **nenhum** |
| `thiefHQStorage`, `policeStationStorage`, `stolenPokemonCases` | **nenhum** | **nenhum** |
| `releasedPokemonPool` | autenticado | create próprio, update limitado, delete admin |
| `vipPlans`, `monetizationProducts`, `ecoinPackages` | autenticado | admin |
| `gyms` (e subcoleções) | autenticado | dono ou admin |
| `gymNames` | autenticado | dono ou admin |
| `players/{uid}` | próprio ou admin | próprio ou admin |
| `players/{uid}/characters/{cid}` | **autenticado** (GYM display) | próprio ou admin |
| Subcoleções de character (time, box, itens, eggs, etc.) | próprio ou admin | próprio ou admin |
| `paymentOrders`, `accountBackpack`, etc. | próprio ou admin | próprio ou admin |
| `battlePresence`, `battleInvites`, `battleRooms` | conforme regras específicas | conforme regras específicas |
| `missionsEvents` | admin | admin |
| `missions`, `events` | autenticado | admin |
| `collectionGroup(transactions)` | admin | — |

---

## 4. Storage rules implementadas

| Path | Leitura | Escrita |
|------|---------|---------|
| `npcs/**` | autenticado | admin |
| `missionsEvents/**` | autenticado | admin |
| `scenarios/**` | autenticado | admin |
| `badges/**` | autenticado | admin |
| `players/{userId}/characters/{characterId}/*` | autenticado | próprio (`userId == auth.uid`) |

**Nota:** Biomas usam imagens em base64 no Firestore (não em Storage).

---

## 5. Mapa de permissões por coleção

### Firestore (principais)

| Coleção | Mobile | Admin | Functions |
|---------|--------|-------|-----------|
| `biomes` | R | R,W | R,W (Admin SDK) |
| `biomeEncounterConfig` | R | R,W | R,W |
| `npcs` | R | R,W | R,W |
| `npcCreatorStats` | R | R | W |
| `gyms` | R,W (próprio) | R,W | R,W |
| `players/*` | R,W (próprio) | R,W | R,W |
| `thiefNpcStorage` | R (ownerUid) | — | R,W |
| `thiefHQStorage` | — | — | R,W |
| `policeStationStorage` | — | — | R,W |
| `stolenPokemonCases` | — | — | R,W |
| `releasedPokemonPool` | R,C,U (limitado) | R,W | R,W |
| `paymentOrders` | R (próprio) | R | R,W |
| `battlePresence`, `battleInvites`, `battleRooms` | R,W (conforme regras) | R,W | — |

R=Read, W=Write, C=Create, U=Update

---

## 6. Pontos sensíveis protegidos

- **`npcCreatorStats`**: sem escrita pelo cliente; apenas Cloud Functions
- **`thiefNpcStorage`**: leitura apenas para `ownerUid == auth.uid`; escrita bloqueada
- **`thiefHQStorage`, `policeStationStorage`, `stolenPokemonCases`**: leitura e escrita bloqueadas para cliente
- **`players/{uid}/characters/{cid}/*`**: subcoleções (box, time, itens, eggs) só dono ou admin
- **`gymNames`**: create exige `ownerUid == auth.uid`
- **`releasedPokemonPool`**: update restrito a transição `active` → `captured` pelo sourceUid

---

## 7. Riscos residuais

1. **Leitura de `players/{uid}/characters/{cid}` por qualquer autenticado**: necessária para exibir nome do líder de GYM; o documento expõe nome, região e metadados básicos. Dados sensíveis (box, time, itens) continuam protegidos nas subcoleções.
2. **`collectionGroup(paymentOrders)`**: se usado no checkout, o cliente pode consultar por `documentId`; as regras em `players/{uid}/paymentOrders` garantem que só documentos do próprio usuário sejam retornados (o engine do Firestore filtra por regras).
3. **`encounters_log`**: escrita permitida para qualquer autenticado; risco de log indevido, mitigado pelo uso esperado em analytics.

---

## 8. Checklist de testes

- [ ] **Mobile — Criação de personagem**: upload de avatar em `players/{uid}/characters/{cid}/avatar.jpg`
- [ ] **Mobile — Explorar**: leitura de biomas, explore_biomes, biome_access, missions_progress
- [ ] **Mobile — Batalhas**: battlePresence, battleInvites, battleRooms, battleHistory
- [ ] **Mobile — GYM**: criação de gym, leitura de gyms de outros, exibição de personagem do líder
- [ ] **Mobile — Thief**: exibição de retenções em thiefNpcStorage (ownerUid)
- [ ] **Mobile — Loja**: leitura de itemsConfig, monetizationProducts, paymentOrders
- [ ] **Mobile — Released pool**: create e update para `captured`
- [ ] **Admin — Biomas**: CRUD biomes, biomeEncounterConfig, captureConfigGroups, wildEncounters
- [ ] **Admin — NPCs**: CRUD npcs, upload de imagem em Storage
- [ ] **Admin — Cenários**: CRUD scenarios, upload em scenarios/original e scenarios/processed
- [ ] **Admin — Insignias**: CRUD badges, upload em badges/
- [ ] **Admin — Monetização**: CRUD vipPlans, monetizationProducts, ecoinPackages
- [ ] **Admin — Painéis**: collectionGroup(transactions), collectionGroup(time), collectionGroup(box)
- [ ] **Functions**: todas as operações continuam via Admin SDK (ignoram rules)

---

## Deploy

```bash
cd admin
firebase deploy --only firestore:rules
firebase deploy --only storage
```
