/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

function parseDotEnvFile(filePath) {
  const out = {};
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const idx = t.indexOf("=");
    out[t.slice(0, idx)] = t.slice(idx + 1);
  }
  return out;
}

function loadServiceAccount() {
  const p = path.join(__dirname, "..", "serviceAccountKey.json");
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  return {
    projectId: raw.project_id,
    clientEmail: raw.client_email,
    privateKey: String(raw.private_key || "").replace(/\\n/g, "\n"),
  };
}

function fsFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "number") fields[k] = Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    else if (typeof v === "boolean") fields[k] = { booleanValue: v };
    else if (v == null) fields[k] = { nullValue: null };
    else fields[k] = { stringValue: String(v) };
  }
  return { fields };
}

async function exchangeCustomToken(apiKey, customToken) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`signInWithCustomToken falhou: ${JSON.stringify(data)}`);
  return data.idToken;
}

async function patchDoc({ projectId, idToken, docPath, body }) {
  const encodedPath = docPath
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${encodedPath}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

async function expectPermissionDenied(fn, label) {
  const out = await fn();
  const denied = out.status === 403 || String(out?.data?.error?.status || "").includes("PERMISSION_DENIED");
  return { label, ok: denied, status: out.status, detail: out.data?.error?.status || out.data?.error?.message || "unknown" };
}

async function run() {
  const env = parseDotEnvFile(path.join(__dirname, "..", ".env.local"));
  const apiKey = env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const projectId = env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!apiKey || !projectId) throw new Error("NEXT_PUBLIC_FIREBASE_API_KEY / NEXT_PUBLIC_FIREBASE_PROJECT_ID ausentes.");

  const sa = loadServiceAccount();
  const app =
    getApps()[0] ||
    initializeApp({
      credential: cert(sa),
      projectId: sa.projectId,
    });
  const adminAuth = getAuth(app);

  const ts = Date.now();
  const playerUid = `perm-player-${ts}`;
  const adminUid = `perm-admin-${ts}`;
  const otherUid = `perm-other-${ts}`;

  await adminAuth.createUser({ uid: playerUid, email: `${playerUid}@elodex.test`, password: "Temp#123456" });
  await adminAuth.createUser({ uid: adminUid, email: `${adminUid}@elodex.test`, password: "Temp#123456" });
  await adminAuth.createUser({ uid: otherUid, email: `${otherUid}@elodex.test`, password: "Temp#123456" });
  await adminAuth.setCustomUserClaims(adminUid, { admin: true });

  const [playerCustom, adminCustom] = await Promise.all([
    adminAuth.createCustomToken(playerUid),
    adminAuth.createCustomToken(adminUid),
  ]);
  const [playerIdToken, adminIdToken] = await Promise.all([
    exchangeCustomToken(apiKey, playerCustom),
    exchangeCustomToken(apiKey, adminCustom),
  ]);

  const allowedSelfWrite = await patchDoc({
    projectId,
    idToken: playerIdToken,
    docPath: `players/${playerUid}/characters/char-probe`,
    body: fsFields({ name: "CharProbe", pokeCoins: 0, updatedAt: new Date().toISOString() }),
  });

  const deniedBiomeWrite = await expectPermissionDenied(
    () =>
      patchDoc({
        projectId,
        idToken: playerIdToken,
        docPath: `biomes/perm-biome-${ts}`,
        body: fsFields({ name: "nao pode", updatedAt: new Date().toISOString() }),
      }),
    "player-nao-pode-escrever-biome"
  );

  const deniedOtherWrite = await expectPermissionDenied(
    () =>
      patchDoc({
        projectId,
        idToken: playerIdToken,
        docPath: `players/${otherUid}/characters/char-x`,
        body: fsFields({ name: "nao pode", updatedAt: new Date().toISOString() }),
      }),
    "player-nao-pode-escrever-outro-player"
  );

  const adminBiomeWrite = await patchDoc({
    projectId,
    idToken: adminIdToken,
    docPath: `biomes/perm-biome-admin-${ts}`,
    body: fsFields({ name: "admin pode", updatedAt: new Date().toISOString() }),
  });

  const checks = [
    {
      label: "player-pode-escrever-self",
      ok: allowedSelfWrite.ok,
      status: allowedSelfWrite.status,
      detail: allowedSelfWrite.data?.error?.message || "ok",
    },
    deniedBiomeWrite,
    deniedOtherWrite,
    {
      label: "admin-pode-escrever-biome",
      ok: adminBiomeWrite.ok,
      status: adminBiomeWrite.status,
      detail: adminBiomeWrite.data?.error?.message || "ok",
    },
  ];

  const ok = checks.every((c) => c.ok);
  console.log(JSON.stringify({ ok, checks, playerUid, adminUid, otherUid }, null, 2));
  if (!ok) process.exit(1);
}

run().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: e?.message || String(e) }, null, 2));
  process.exit(1);
});
