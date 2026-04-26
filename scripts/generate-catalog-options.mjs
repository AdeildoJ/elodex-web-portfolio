import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const speciesPath = path.join(root, "src", "data", "pokemon", "pokemonSpecies.json");
const movesPath = path.join(root, "src", "data", "moves.json");
const outDir = path.join(root, "public", "api", "catalog");
const outFile = path.join(outDir, "options.json");

const pokemonSpeciesData = JSON.parse(fs.readFileSync(speciesPath, "utf8"));
const movesData = JSON.parse(fs.readFileSync(movesPath, "utf8"));

const species = Object.values(pokemonSpeciesData)
  .map((row) => {
    const id = Number(row.id || 0);
    const name = String(row.name || "").trim();
    if (!id || !name) return null;
    return { id, label: `#${id} ${name}` };
  })
  .filter(Boolean)
  .sort((a, b) => a.id - b.id);

const moves = Object.entries(movesData)
  .map(([id, row]) => ({
    id,
    label: String(row.name || id),
  }))
  .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, JSON.stringify({ species, moves }), "utf8");
console.log("Wrote", outFile);
