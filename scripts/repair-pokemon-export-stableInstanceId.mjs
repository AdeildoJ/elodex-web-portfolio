/**
 * Saneamento seguro: adiciona stableInstanceId em documentos Pokémon de um export JSON.
 * Não altera speciesId, moves ou stats — só preenche identidade estável ausente.
 *
 * Uso:
 *   node repair-pokemon-export-stableInstanceId.mjs export.json > export.repaired.json
 *   (faça backup do arquivo original antes)
 *
 * Formato entrada: array JSON [{ path, data }, ...] ou [{ ...doc }, ...]
 */
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";

const arg = process.argv[2];
let text = "";
if (arg && existsSync(arg)) text = readFileSync(arg, "utf8");
else text = readFileSync(0, "utf8");

const docs = JSON.parse(text || "[]");
if (!Array.isArray(docs)) {
  console.error("Expected JSON array");
  process.exit(1);
}

const out = [];
let filled = 0;
for (const entry of docs) {
  const wrap = entry && typeof entry.data === "object";
  const d = wrap ? { ...entry.data } : { ...entry };
  const sid = String(d.stableInstanceId || "").trim();
  if (sid.length < 16) {
    d.stableInstanceId = randomUUID();
    filled += 1;
  }
  if (wrap) out.push({ ...entry, data: d });
  else out.push(d);
}

console.error(JSON.stringify({ inputDocs: docs.length, stableInstanceIdAdded: filled }, null, 2));
console.log(JSON.stringify(out, null, 2));
