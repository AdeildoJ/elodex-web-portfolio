/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

const INPUT = path.join(
  process.cwd(),
  "src",
  "data",
  "pokemon",
  "pokemonSpecies.json"
);

const OUT = INPUT;

// ✅ Pokémon HOME sprites (via repositório oficial do PokéAPI)
const BASE_DEFAULT =
  "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home";
const BASE_SHINY =
  "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/shiny";

/**
 * Obtém o número do Pokémon (National Dex)
 * Prioridade: id → dexNumber
 */
function toIdNumber(p) {
  const n = Number(p?.id ?? p?.dexNumber);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function patchOneForce(p) {
  const idNum = toIdNumber(p);
  if (!idNum) return p;

  return {
    ...p,
    sprites: {
      ...(p.sprites ?? {}),
      default: `${BASE_DEFAULT}/${idNum}.png`,
      shiny: `${BASE_SHINY}/${idNum}.png`,
    },
  };
}

function main() {
  if (!fs.existsSync(INPUT)) {
    console.error("❌ Arquivo não encontrado:", INPUT);
    process.exit(1);
  }

  const rawText = fs.readFileSync(INPUT, "utf8");
  const raw = JSON.parse(rawText);

  let patched;

  // Suporta JSON como ARRAY ou MAPA
  if (Array.isArray(raw)) {
    patched = raw.map(patchOneForce);
  } else if (raw && typeof raw === "object") {
    patched = {};
    for (const [key, value] of Object.entries(raw)) {
      patched[key] = patchOneForce(value);
    }
  } else {
    console.error("❌ Formato inesperado no pokemonSpecies.json.");
    process.exit(1);
  }

  fs.writeFileSync(OUT, JSON.stringify(patched, null, 2), "utf8");

  console.log("✅ Sprites do Pokémon HOME aplicados com sucesso!");
  console.log("Arquivo atualizado:", OUT);

  const sample = Array.isArray(patched)
    ? patched[0]
    : patched[Object.keys(patched)[0]];

  console.log("Exemplo:");
  console.log({
    id: sample.id,
    name: sample.name,
    sprites: sample.sprites,
  });
}

main();
