/**
 * Gera `src/data/evolutionTargetsBySpecies.json` a partir de `functions/lib/pokemonEvolution.cjs`.
 * Assim o admin Next (incl. Turbopack) não precisa importar TypeScript fora da pasta `admin/`.
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const bundlePath = path.join(__dirname, "..", "functions", "lib", "pokemonEvolution.cjs");
if (!fs.existsSync(bundlePath)) {
  console.error(
    "[generate-evolution-targets-admin] Arquivo ausente:",
    bundlePath,
    "\nRode o build do bundle em admin/functions (ex.: bundle-evolution) antes."
  );
  process.exit(1);
}

const evo = require(bundlePath);
const rules = evo.EVOLUTION_RULES_BY_SPECIES;
if (!rules || typeof rules !== "object") {
  console.error("[generate-evolution-targets-admin] EVOLUTION_RULES_BY_SPECIES inválido.");
  process.exit(1);
}

/** @type {Record<string, number[]>} */
const out = {};
for (const [fromKey, list] of Object.entries(rules)) {
  const from = Math.max(1, Math.trunc(Number(fromKey)));
  if (!from || !Array.isArray(list) || !list.length) continue;
  const targets = [...new Set(list.map((r) => Math.trunc(Number(r?.toSpeciesId))).filter((n) => n > 0))];
  if (targets.length) {
    out[String(from)] = targets.sort((a, b) => a - b);
  }
}

const outPath = path.join(__dirname, "..", "src", "data", "evolutionTargetsBySpecies.json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out));
console.log(
  "Wrote",
  path.relative(path.join(__dirname, ".."), outPath),
  "—",
  Object.keys(out).length,
  "espécies com destinos de evolução."
);
