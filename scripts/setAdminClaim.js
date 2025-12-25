// scripts/setAdminClaim.js
const admin = require("firebase-admin");
const serviceAccount = require("../secrets/serviceAccountKey.json"); // ajuste o caminho se o arquivo estiver em outra pasta

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

async function setAdmin() {
  const uid = "sHBIaa2HkGSk8Dpp0NvswDBqRR22"; // SUBSTITUA pelo UID copiado do Authentication

  try {
    await admin.auth().setCustomUserClaims(uid, { admin: true });
    console.log(`✅ Usuário ${uid} agora é ADMIN.`);
    const user = await admin.auth().getUser(uid);
    console.log("Email do admin:", user.email);
  } catch (error) {
    console.error("Erro ao setar claim admin:", error);
  }
}

setAdmin();
