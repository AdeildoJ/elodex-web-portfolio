/**
 * Soma KM ao saldo global de cada jogador: `players/{uid}.kmsDisponiveis`
 * (mesmo campo usado em `changePlayerKmBalance` / app).
 *
 *   node admin/scripts/grant-km-all-players.mjs --dry-run
 *   node admin/scripts/grant-km-all-players.mjs --execute
 *   node admin/scripts/grant-km-all-players.mjs --execute --km=100
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const adminRoot = join(__dirname, "..");
const keyPath = join(adminRoot, "serviceAccountKey.json");
const require = createRequire(import.meta.url);

function asInt(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run") || !argv.includes("--execute");
  const execute = argv.includes("--execute");
  const kmArg = argv.find((a) => a.startsWith("--km="))?.split("=")[1];
  const delta = Math.max(0, asInt(kmArg, 100));

  if (!existsSync(keyPath)) {
    console.error(JSON.stringify({ ok: false, error: "missing_service_account", path: keyPath }));
    process.exit(2);
  }

  const admin = require("firebase-admin");
  const { FieldValue } = require("firebase-admin/firestore");
  if (!admin.apps.length) {
    const sa = JSON.parse(readFileSync(keyPath, "utf8"));
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  }
  const db = admin.firestore();

  const snap = await db.collection("players").get();
  const players = snap.docs;

  const planned = players.map((d) => {
    const data = d.data() || {};
    const cur = Math.max(0, Number(data.kmsDisponiveis || 0));
    return {
      ref: d.ref,
      uid: d.id,
      nomeJogador: String(data.nomeJogador || "").trim() || d.id,
      currentKm: cur,
      nextKm: cur + delta,
    };
  });

  const summary = {
    ok: true,
    dryRun,
    kmDelta: delta,
    playerCount: planned.length,
  };
  console.log(JSON.stringify({ ...summary, sample: planned.slice(0, 20) }, null, 2));
  if (planned.length > 20) {
    console.error(`... e mais ${planned.length - 20} jogadores.`);
  }

  if (execute && planned.length) {
    let batch = db.batch();
    let n = 0;
    let batches = 0;
    for (const p of planned) {
      batch.set(
        p.ref,
        {
          kmsDisponiveis: FieldValue.increment(delta),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      n += 1;
      if (n >= 400) {
        await batch.commit();
        batches += 1;
        batch = db.batch();
        n = 0;
      }
    }
    if (n > 0) {
      await batch.commit();
      batches += 1;
    }
    console.error(JSON.stringify({ ok: true, batchesCommitted: batches, playersUpdated: planned.length, kmEach: delta }, null, 2));
  } else if (!execute) {
    console.error(JSON.stringify({ hint: "Nenhum write. Use --execute para creditar." }, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
