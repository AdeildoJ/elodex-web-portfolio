/**
 * Lista entitlements monetizados com deliveryScope character_backpack mas sem consumedByCharacterId
 * (legado / risco de entrega implicita ao personagem "errado").
 *
 * Uso (na raiz do repo):
 *   node admin/scripts/list-orphan-entitlements.mjs
 *   node admin/scripts/list-orphan-entitlements.mjs --uid <UID_OPCIONAL>
 *
 * Credenciais: `admin/serviceAccountKey.json`
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const adminRoot = join(__dirname, "..");
const keyPath = join(adminRoot, "serviceAccountKey.json");
const require = createRequire(import.meta.url);

function parseArgs() {
  const out = { uid: "" };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--uid" && argv[i + 1]) {
      out.uid = String(argv[i + 1]).trim();
      i++;
    }
  }
  return out;
}

async function main() {
  const { uid: filterUid } = parseArgs();
  if (!existsSync(keyPath)) {
    console.error("Arquivo de credencial ausente:", keyPath);
    process.exit(1);
  }
  const admin = require("firebase-admin");
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(readFileSync(keyPath, "utf8"))),
    });
  }
  const db = admin.firestore();

  const playersSnap = filterUid
    ? { docs: [{ id: filterUid, ref: db.doc(`players/${filterUid}`) }] }
    : await db.collection("players").limit(5000).get();

  let total = 0;
  for (const p of playersSnap.docs) {
    const uid = p.id;
    const col = db.collection(`players/${uid}/productEntitlements`);
    const snap = await col.where("deliveryScope", "==", "character_backpack").limit(200).get();
    for (const d of snap.docs) {
      const data = d.data() || {};
      const consumedBy = String(data.consumedByCharacterId || "").trim();
      const claimed = !!data.claimedAt;
      const status = String(data.status || "").toLowerCase();
      if (consumedBy) continue;
      if (claimed) continue;
      if (status && status !== "active") continue;
      total++;
      console.log(
        JSON.stringify({
          uid,
          entitlementId: d.id,
          productId: data.productId || null,
          productCode: data.productCode || null,
          productType: data.productType || null,
          deliveryScope: data.deliveryScope || null,
          consumedByCharacterId: consumedBy || null,
          claimedAt: data.claimedAt ? "yes" : null,
        })
      );
    }
  }
  console.error(`Total listados (character_backpack sem consumedByCharacterId, nao claimed): ${total}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
