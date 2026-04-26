/**
 * Heurística: moves gravados no pokemonMoves.json por espécie vs moves aprendidos level-up.
 * Uso: node admin/scripts/audit-pokemon-moves-integrity.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const adminRoot = join(__dirname, "..");
const movesBySpecies = join(adminRoot, "../elodex-mobile/src/data/pokemon/pokemonMoves.json");
const movesDex = join(adminRoot, "../elodex-mobile/src/data/pokemon/moves.json");

function norm(s) {
  return String(s || "")
    .trim()
    .toLowerCase();
}

function main() {
  if (!existsSync(movesBySpecies) || !existsSync(movesDex)) {
    console.error("Missing pokemon json");
    process.exit(1);
  }
  const bySpec = JSON.parse(readFileSync(movesBySpecies, "utf8"));
  const moves = JSON.parse(readFileSync(movesDex, "utf8"));
  const validMoveIds = new Set(Object.keys(moves).map((k) => norm(k)));

  let badMoveId = 0;
  let speciesChecked = 0;
  const samples = [];

  for (const [sid, row] of Object.entries(bySpec)) {
    speciesChecked++;
    const rawMoves = Array.isArray(row?.moves) ? row.moves : Array.isArray(row) ? row : [];
    for (const m of rawMoves) {
      const mid = norm(m?.moveId ?? m?.id ?? m?.name ?? m?.move);
      if (!mid) continue;
      if (!validMoveIds.has(mid)) {
        badMoveId++;
        if (samples.length < 30) samples.push({ speciesId: sid, moveId: mid });
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        speciesWithLearnset: speciesChecked,
        learnsetEntriesReferencingUnknownMove: badMoveId,
        samples,
      },
      null,
      2
    )
  );
}

main();
