# Coliseu PvP — Load tests (k6)

Script simulando criação/entrada/cancelamento de salas em paralelo via Cloud Functions HTTP.

## Instalação

- **Windows**: `choco install k6` (ou baixar binário em https://k6.io/docs/getting-started/installation/)
- **macOS**: `brew install k6`
- **Linux**: `sudo apt-get install k6`

## Preparação de tokens

O script consome tokens de ID Firebase de contas reais. Crie N contas de teste (ex: `load-test-1@elodex.app`, ..., `load-test-10@elodex.app`) e gere um token por conta.

Exemplo de geração programática (rode uma vez antes da carga):

```js
// admin/load-tests/generate-tokens.js
const admin = require("firebase-admin");
const fs = require("fs");
admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: "elodex-1c8a1" });

async function main() {
  const uids = process.argv.slice(2);
  if (!uids.length) throw new Error("pass uids as argv");
  const tokens = [];
  for (const uid of uids) {
    const customToken = await admin.auth().createCustomToken(uid);
    // Troca por ID token via endpoint público (REST API do Identity Toolkit).
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.FIREBASE_WEB_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    });
    const body = await res.json();
    tokens.push(body.idToken);
  }
  fs.writeFileSync("tokens.json", JSON.stringify({ tokens }, null, 2));
  console.log(`wrote ${tokens.length} tokens`);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

```
$ GOOGLE_APPLICATION_CREDENTIALS=... FIREBASE_WEB_API_KEY=... \
    node generate-tokens.js uid1 uid2 uid3 uid4
```

**IMPORTANTE**: os tokens de ID Firebase expiram em 1h. Rode o generate logo antes da carga.

## Execução

```
$ cd admin/load-tests
$ k6 run -e PROJECT_ID=elodex-1c8a1 \
         -e REGION=southamerica-east1 \
         -e TOKENS_FILE=./tokens.json \
         --vus 5 --duration 2m pvp-load.js
```

## Métricas e limiares

O script define thresholds:
- `http_req_failed`: taxa de erros < 5%
- `http_req_duration`: p95 < 2000ms
- `failures_total`: total de falhas < 20

Se qualquer um for violado, `k6` retorna exit 99 e imprime resumo.

## Escopo atual

O script exercita **apenas a camada administrativa** (create/join/cancel) que é a que mais escala e sofre com picos de lobby. Para estressar batalhas reais end-to-end, é necessário:

1. Pré-popular `privatePicks` com `battleTeam` serializado para cada par de tokens (executar uma vez antes da carga).
2. Remover o `cancelColiseuRoomHttp` do script e substituir por `startColiseuPvpBattleHttp` + loop de `pvpHostAction` / `pvpChallengerAction` writes.
3. Aguardar o trigger `coliseuPvpServerResolve` disparar (pode validar lendo o doc via Firestore REST API entre turnos).

Este próximo nível é trabalho adicional; foi deixado como segunda iteração.
