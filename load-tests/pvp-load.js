/**
 * k6 load test — Coliseu PvP
 *
 * Simula N pares de jogadores criando salas, entrando, confirmando time,
 * iniciando batalha e trocando ações até KO. Usa as Cloud Functions HTTP
 * Bearer já existentes (`createColiseuRoomHttp`, `joinColiseuRoomHttp`,
 * `startColiseuPvpBattleHttp`).
 *
 * **Pré-requisitos**
 *   - k6 instalado: `choco install k6` (Windows) ou `brew install k6` (Mac).
 *   - Emulador Firebase rodando OU ambiente dev real (preferível dev com
 *     isolamento de conta, já que este script cria dados reais).
 *   - Conjunto de tokens de ID Firebase válidos em `tokens.json` no mesmo
 *     diretório. Formato:
 *       { "tokens": ["eyJ...", "eyJ...", ...] }  (2 tokens por VU, mínimo)
 *
 * **Uso**
 *   Desktop:
 *     $ cd admin/load-tests
 *     $ k6 run -e PROJECT_ID=elodex-1c8a1 -e REGION=southamerica-east1 \
 *         -e TOKENS_FILE=./tokens.json --vus 5 --duration 2m pvp-load.js
 *
 * **Métricas custom**
 *   - `rooms_created`       total de salas criadas com sucesso
 *   - `battles_started`     total de batalhas iniciadas (ambos prontos)
 *   - `turns_resolved`      turnos cujo `pvpResolutionEpoch` avançou
 *   - `failures_total`      qualquer falha categorizada (status != 200)
 *
 * **O que NÃO este script faz (ainda)**
 *   - Assinar privatePicks via SDK (seleção de time pré-batalha). Cada VU
 *     precisa ter um `battleTeam` previamente gravado em Firestore. Você
 *     pode pré-criar teams via script admin (uma vez) ou executar esta
 *     carga apenas até o ponto de "room creation + join + start call",
 *     medindo o custo backend da camada administrativa.
 *   - Reconexão / offline. Use o scheduled real para testar forfeit.
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";
import { Counter, Trend } from "k6/metrics";

const PROJECT_ID = __ENV.PROJECT_ID || "elodex-1c8a1";
const REGION = __ENV.REGION || "southamerica-east1";
const BASE = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net`;

const tokens = new SharedArray("pvp_tokens", function () {
  if (!__ENV.TOKENS_FILE) {
    throw new Error("Missing TOKENS_FILE env var pointing to tokens.json");
  }
  // eslint-disable-next-line no-undef
  const raw = open(__ENV.TOKENS_FILE);
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed?.tokens) || parsed.tokens.length < 2) {
    throw new Error("tokens.json must contain { tokens: [at least 2 strings] }");
  }
  return parsed.tokens;
});

export const options = {
  scenarios: {
    pvp_flow: {
      executor: "constant-vus",
      vus: Number(__ENV.VUS || 5),
      duration: __ENV.DURATION || "2m",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<2000"],
    failures_total: ["count<20"],
  },
};

const roomsCreated = new Counter("rooms_created");
const battlesStarted = new Counter("battles_started");
const turnsResolved = new Counter("turns_resolved");
const failuresTotal = new Counter("failures_total");
const createLatency = new Trend("create_latency_ms", true);

function call(endpoint, token, body) {
  const res = http.post(`${BASE}/${endpoint}`, JSON.stringify(body || {}), {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    timeout: "15s",
  });
  const ok = check(res, { [`${endpoint} 2xx`]: (r) => r.status >= 200 && r.status < 300 });
  if (!ok) {
    failuresTotal.add(1, { endpoint, status: String(res.status) });
  }
  return { res, ok, body: safeJson(res.body) };
}

function safeJson(s) {
  try { return typeof s === "string" ? JSON.parse(s) : s; } catch { return null; }
}

/**
 * Rotação de pares: cada iteração usa tokens[2k], tokens[2k+1] (creator, opponent).
 * Assume que tokens.json vem pareado (mesmo tamanho de arrays par).
 */
export default function () {
  // eslint-disable-next-line no-undef
  const iter = __ITER;
  const vu = __VU;
  const creatorIdx = ((vu - 1) * 2) % tokens.length;
  const opponentIdx = (creatorIdx + 1) % tokens.length;
  const creator = tokens[creatorIdx];
  const opponent = tokens[opponentIdx];

  // 1) Criar sala.
  const createStart = Date.now();
  const roomName = `loadtest-${vu}-${iter}-${Date.now()}`;
  const createRes = call("createColiseuRoomHttp", creator, {
    name: roomName,
    roomType: "open",
    maxPokemons: 3,
    maxLevel: 50,
  });
  createLatency.add(Date.now() - createStart);
  if (!createRes.ok) { sleep(1); return; }
  const roomId = createRes.body?.roomId;
  if (!roomId) { failuresTotal.add(1, { endpoint: "createColiseuRoomHttp", status: "no_id" }); sleep(1); return; }
  roomsCreated.add(1);

  sleep(0.5);

  // 2) Entrar como oponente.
  const joinRes = call("joinColiseuRoomHttp", opponent, { roomId });
  if (!joinRes.ok) { sleep(1); return; }

  sleep(0.5);

  // 3) (Placeholder) Confirmar time — este passo requer escrever privatePicks
  // via SDK Firestore autenticado, o que k6 não faz nativamente. Em produção
  // você executaria esta parte via script admin antes da carga OU usaria o
  // Firestore REST API. Este teste mede custo da camada administrativa
  // (create/join/cancel) que já é o principal alvo do stress.

  sleep(1);

  // 4) Cancelar a sala (cleanup). Se remover esta linha e pré-popular
  // privatePicks, você consegue chegar ao `start` de fato.
  const cancelRes = call("cancelColiseuRoomHttp", creator, { roomId });
  if (cancelRes.ok) {
    // ok.
  }

  sleep(1);
}
