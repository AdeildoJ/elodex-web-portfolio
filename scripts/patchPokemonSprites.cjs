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

const OUT = INPUT; // sobrescreve o mesmo arquivo

// ✅ Official Artwork (Sugimori / Game Freak via repositório do PokéAPI)
const BASE_OFFICIAL =
  "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork";

// Observação importante:
// - Official Artwork normalmente não tem "shiny" separado nesse caminho.
// - Para não quebrar sua UI (toggle shiny), vamos preencher shiny com o mesmo link do default.
// - Depois, se você quiser, a gente muda "shiny" para HOME (que tem versões bem consistentes).
function toIdNumber(p) {
  // prefere "id", senão dexNumber
  const n = Number(p?.id ?? p?.dexNumber);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function patchOne(p) {
  const idNum = toIdNumber(p);
  if (!idNum) return p;

  const existing = p.sprites ?? {};

  const defaultUrl = existing.default || `${BASE_OFFICIAL}/${idNum}.png`;
  const shinyUrl = existing.shiny || defaultUrl; // sem shiny oficial separado

  return {
    ...p,
    sprites: {
      ...existing,
      default: defaultUrl,
      shiny: shinyUrl,
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

  // Seu JSON pode ser:
  // - Array: [ {...}, {...} ]
  // - Mapa: { "1": {...}, "2": {...} }
  let patched;

  if (Array.isArray(raw)) {
    patched = raw.map(patchOne);
  } else if (raw && typeof raw === "object") {
    patched = {};
    for (const [key, value] of Object.entries(raw)) {
      patched[key] = patchOne(value);
    }
  } else {
    console.error("❌ Formato inesperado no pokemonSpecies.json (não é array nem objeto).");
    process.exit(1);
  }

  fs.writeFileSync(OUT, JSON.stringify(patched, null, 2), "utf8");

  console.log("✅ Sprites (Official Artwork) adicionados com sucesso em:", OUT);

  // Log de exemplo
  const sample = Array.isArray(patched)
    ? patched[0]
    : patched[Object.keys(patched)[0]];

  console.log("Exemplo de resultado:");
  console.log({
    id: sample.id,
    name: sample.name,
    sprites: sample.sprites,
  });
}

main();
