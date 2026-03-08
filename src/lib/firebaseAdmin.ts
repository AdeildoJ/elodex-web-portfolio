import fs from "node:fs";
import path from "node:path";

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

function parseServiceAccountFromEnv(): ServiceAccount | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ServiceAccount;
    if (!parsed?.project_id || !parsed?.client_email || !parsed?.private_key) return null;
    return {
      ...parsed,
      private_key: parsed.private_key.replace(/\\n/g, "\n"),
    };
  } catch {
    return null;
  }
}

function parseServiceAccountFromFile(): ServiceAccount | null {
  try {
    const filePath = path.join(process.cwd(), "serviceAccountKey.json");
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as ServiceAccount;
    if (!parsed?.project_id || !parsed?.client_email || !parsed?.private_key) return null;
    return parsed;
  } catch {
    return null;
  }
}

function ensureAdminApp() {
  if (getApps().length) return getApps()[0];

  const account = parseServiceAccountFromEnv() ?? parseServiceAccountFromFile();
  if (!account) {
    throw new Error(
      "Firebase Admin nao configurado. Defina FIREBASE_SERVICE_ACCOUNT_JSON no ambiente."
    );
  }

  return initializeApp({
    credential: cert({
      projectId: account.project_id,
      clientEmail: account.client_email,
      privateKey: account.private_key,
    }),
  });
}

const adminApp = ensureAdminApp();

export const adminAuth = getAuth(adminApp);
export const adminDb = getFirestore(adminApp);

