/**
 * Gera um único arquivo .zip com as imagens de todos os biomas do Firestore,
 * ordenadas pelo campo `order` (e desempate por nome / id).
 *
 * Uso (na pasta admin):
 *   node scripts/export-biome-images-zip.mjs
 *   node scripts/export-biome-images-zip.mjs --out ./biome-imagens.zip
 *
 * Credenciais: `admin/serviceAccountKey.json`
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import JSZip from "jszip";

const __dirname = dirname(fileURLToPath(import.meta.url));
const adminRoot = join(__dirname, "..");
const keyPath = join(adminRoot, "serviceAccountKey.json");

const require = createRequire(import.meta.url);

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "bioma";
}

function extFromMime(mime) {
  const m = String(mime || "").split(";")[0].trim().toLowerCase();
  if (m === "image/jpeg" || m === "image/jpg") return "jpg";
  if (m === "image/png") return "png";
  if (m === "image/webp") return "webp";
  if (m === "image/gif") return "gif";
  return "img";
}

/** @returns {{ buffer: Buffer, ext: string } | null} */
function bufferFromDataUrl(dataUrl) {
  const s = String(dataUrl || "").trim();
  const m = /^data:([^;,]+);base64,(.+)$/is.exec(s);
  if (!m) return null;
  const mime = m[1];
  const b64 = m[2].replace(/\s/g, "");
  try {
    return { buffer: Buffer.from(b64, "base64"), ext: extFromMime(mime) };
  } catch {
    return null;
  }
}

/** @returns {Promise<{ buffer: Buffer, ext: string } | null>} */
async function bufferFromRemoteUrl(url) {
  const u = String(url || "").trim();
  if (!u.startsWith("http://") && !u.startsWith("https://")) return null;
  const res = await fetch(u, { redirect: "follow" });
  if (!res.ok) {
    console.warn(`[export] HTTP ${res.status} ao baixar: ${u.slice(0, 120)}…`);
    return null;
  }
  const ct = res.headers.get("content-type") || "image/png";
  const ab = await res.arrayBuffer();
  return { buffer: Buffer.from(ab), ext: extFromMime(ct) };
}

/** @returns {Promise<{ buffer: Buffer, ext: string } | null>} */
async function imageToBuffer(imageUrl) {
  const raw = String(imageUrl || "").trim();
  if (!raw) return null;
  if (raw.startsWith("data:")) return bufferFromDataUrl(raw);
  return bufferFromRemoteUrl(raw);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--out" && argv[i + 1]) {
      out.path = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

async function main() {
  const { path: outArg } = parseArgs(process.argv.slice(2));

  if (!existsSync(keyPath)) {
    console.error(`Erro: não encontrei credenciais em ${keyPath}`);
    process.exit(2);
  }

  const admin = require("firebase-admin");
  if (!admin.apps.length) {
    const sa = JSON.parse(readFileSync(keyPath, "utf8"));
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  }
  const db = admin.firestore();

  const snap = await db.collection("biomes").get();
  const rows = [];
  snap.forEach((d) => {
    const data = d.data() || {};
    const id = String(data.id || d.id || "")
      .trim()
      .toLowerCase();
    if (!id) return;
    rows.push({
      id,
      name: String(data.name || id),
      order: Math.max(0, Math.trunc(Number(data.order ?? 0))),
      imageUrl: String(data.imageUrl || "").trim(),
    });
  });

  rows.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    const n = a.name.localeCompare(b.name, "pt-BR");
    if (n !== 0) return n;
    return a.id.localeCompare(b.id);
  });

  const zip = new JSZip();
  const folder = zip.folder("biomas");
  const lines = [
    "Imagens exportadas em ordem (campo order do Firestore).",
    `Total de documentos: ${rows.length}`,
    "",
  ];

  let saved = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const b = rows[i];
    const seq = String(i + 1).padStart(3, "0");
    const line = `${seq}\torder=${b.order}\tid=${b.id}\t${b.name}`;
    lines.push(line);

    if (!b.imageUrl) {
      skipped += 1;
      lines.push(`  (sem imageUrl)`);
      continue;
    }

    const img = await imageToBuffer(b.imageUrl);
    if (!img) {
      skipped += 1;
      lines.push(`  (falha ao ler imagem)`);
      continue;
    }

    const base = `${seq}_ordem${b.order}_${slugify(b.name)}_${slugify(b.id)}`;
    const fname = `${base}.${img.ext}`;
    folder.file(fname, img.buffer);
    saved += 1;
  }

  zip.file("manifest.txt", lines.join("\n"));

  const buf = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  const defaultName = `biome-imagens-${new Date().toISOString().slice(0, 10)}.zip`;
  const outPath = outArg
    ? isAbsolute(outArg)
      ? outArg
      : join(process.cwd(), outArg)
    : join(adminRoot, "out", defaultName);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, buf);

  console.log(`OK: ${saved} imagens no ZIP, ${skipped} sem imagem ou com erro.`);
  console.log(`Arquivo: ${outPath}`);
  console.log(`Tamanho: ${(buf.length / 1024 / 1024).toFixed(2)} MB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
