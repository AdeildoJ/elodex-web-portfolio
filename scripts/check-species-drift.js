/**
 * Wave 5B — Detecta drift entre as cópias de pokemonSpecies.json.
 *
 * Hoje, 4 cópias byte-identical coexistem no monorepo (decisão prévia para
 * evitar cross-imports entre admin/ e elodex-mobile/). Esta checagem serve
 * como guarda: se alguém alterar uma cópia sem as outras, o script falha
 * (exit 1) e força a sincronização manual.
 *
 * Uso:
 *   node admin/scripts/check-species-drift.js
 *
 * Para consolidar manualmente em caso de drift, escolha a cópia correta como
 * fonte de verdade (recomendado: elodex-mobile/src/data/pokemon/) e copie
 * para as demais.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..", "..");

const TARGETS = [
  "elodex-mobile/src/data/pokemon/pokemonSpecies.json",
  "shared/pokemon-evolution/data/pokemonSpecies.json",
  "admin/src/data/pokemon/pokemonSpecies.json",
  "elodex-mobile/packages/pokemon-evolution/data/pokemonSpecies.json",
];

function hashFile(p) {
  const buf = fs.readFileSync(p);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function main() {
  const entries = TARGETS.map((rel) => {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) return { rel, abs, hash: null, missing: true };
    return { rel, abs, hash: hashFile(abs), missing: false };
  });

  const missing = entries.filter((e) => e.missing);
  if (missing.length) {
    console.error("[species-drift] cópias ausentes:");
    for (const m of missing) console.error("  -", m.rel);
    process.exit(1);
  }

  const hashes = new Set(entries.map((e) => e.hash));
  for (const e of entries) console.log(`${e.hash}  ${e.rel}`);

  if (hashes.size === 1) {
    console.log("\n[species-drift] OK — todas as cópias são idênticas.");
    return;
  }

  console.error("\n[species-drift] DRIFT DETECTADO! Cópias divergentes:");
  const byHash = new Map();
  for (const e of entries) {
    if (!byHash.has(e.hash)) byHash.set(e.hash, []);
    byHash.get(e.hash).push(e.rel);
  }
  for (const [h, list] of byHash) {
    console.error(`  hash ${h}:`);
    for (const r of list) console.error(`    - ${r}`);
  }
  console.error("\nCorrija escolhendo a cópia fonte-de-verdade e sincronizando as demais.");
  process.exit(1);
}

main();
