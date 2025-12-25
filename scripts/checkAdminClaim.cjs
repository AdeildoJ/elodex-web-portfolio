/* eslint-disable no-console */
const path = require("path");
const admin = require("firebase-admin");

const serviceAccount = require(path.join(
  __dirname,
  "..",
  "secrets",
  "serviceAccountKey.json"
));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

async function run() {
  const uid = process.argv[2];
  if (!uid) {
    console.log("Uso: node scripts/checkAdminClaim.cjs <UID>");
    process.exit(1);
  }

  const user = await admin.auth().getUser(uid);
  console.log("UID:", user.uid);
  console.log("EMAIL:", user.email);
  console.log("CUSTOM CLAIMS:", user.customClaims || {});
  process.exit(0);
}

run().catch((e) => {
  console.error("Erro:", e);
  process.exit(1);
});
