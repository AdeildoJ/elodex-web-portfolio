// admin/scripts/exportPokemonForms.cjs
const fs = require("fs");
const path = require("path");

const POKEAPI = "https://pokeapi.co/api/v2";

const OUT_PATH = path.join(__dirname, "..", "src", "data", "pokemon", "pokemonForms.json");
const MISSING_PATH = path.join(__dirname, "..", "src", "data", "pokemon", "pokemonForms.missing.json");

const SPECIES_PATH = path.join(__dirname, "..", "src", "data", "pokemon", "pokemonSpecies.json");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url, { allow404 = false } = {}) {
  const res = await fetch(url);
  if (res.status === 404 && allow404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return res.json();
}

function toMeters(dm) {
  return Math.round((dm / 10) * 10) / 10;
}
function toKg(hg) {
  return Math.round((hg / 10) * 10) / 10;
}

function isMega(name) {
  return name.endsWith("-mega") || name.endsWith("-mega-x") || name.endsWith("-mega-y");
}
function isGmax(name) {
  return name.endsWith("-gmax");
}

function inferFormType(name) {
  if (isMega(name)) return "mega";
  if (isGmax(name)) return "gigantamax";
  return "other";
}

function humanizeFormName(formName) {
  return formName
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

function pickDexId(entry) {
  // tenta cobrir schemas possíveis
  const id =
    entry?.id ??
    entry?.dexNumber ??
    entry?.dex_number ??
    entry?.dex ??
    null;

  return id == null ? null : Number(id);
}

// STUB: plugar depois a sua lógica real com TYPE_CHART
function calcTypeEffectivenessStub(_types) {
  return { weaknesses: [], resistances: [], immunities: [], neutral: [] };
}

async function main() {
  if (!fs.existsSync(SPECIES_PATH)) {
    throw new Error(`Não encontrei pokemonSpecies.json em: ${SPECIES_PATH}`);
  }

  const speciesById = JSON.parse(fs.readFileSync(SPECIES_PATH, "utf-8"));
  const speciesList = Object.values(speciesById);

  // índice rápido por National Dex ID
  const speciesByDexId = new Map();
  for (const sp of speciesList) {
    const dexId = pickDexId(sp);
    if (dexId != null) speciesByDexId.set(dexId, sp);
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });

  const list = await fetchJson(`${POKEAPI}/pokemon?limit=200000&offset=0`);
  const candidates = list.results
    .map((r) => r.name)
    .filter((n) => isMega(n) || isGmax(n));

  const out = {};
  const missing = [];

  console.log(`Encontrados ${candidates.length} candidatos (mega/gmax) no índice...`);

  let processed = 0;

  for (const formName of candidates) {
    processed++;
    if (processed % 25 === 0) await sleep(350);

    // 1) tenta buscar a forma
    const p = await fetchJson(`${POKEAPI}/pokemon/${formName}`, { allow404: true });
    if (!p) {
      missing.push({ formId: formName, reason: "pokeapi_pokemon_404", url: `${POKEAPI}/pokemon/${formName}` });
      continue;
    }

    // 2) pega species.name e busca /pokemon-species/{name} pra obter o ID da espécie (dex)
    const baseSpeciesName = String(p.species?.name || "").toLowerCase();
    const spApi = await fetchJson(`${POKEAPI}/pokemon-species/${baseSpeciesName}`, { allow404: true });
    if (!spApi) {
      missing.push({ formId: formName, reason: "pokeapi_species_404", baseName: baseSpeciesName });
      continue;
    }

    const dexId = Number(spApi.id);
    const baseEntry = speciesByDexId.get(dexId);

    if (!baseEntry) {
      missing.push({
        formId: formName,
        reason: "base_species_not_found_in_species_json",
        baseName: baseSpeciesName,
        dexId
      });
      continue;
    }

    const formType = inferFormType(formName);

    const types = (p.types || [])
      .slice()
      .sort((a, b) => a.slot - b.slot)
      .map((t) => t.type.name);

    const baseStats = {};
    for (const s of p.stats || []) {
      if (s.stat.name === "hp") baseStats.hp = s.base_stat;
      if (s.stat.name === "attack") baseStats.attack = s.base_stat;
      if (s.stat.name === "defense") baseStats.defense = s.base_stat;
      if (s.stat.name === "special-attack") baseStats.specialAttack = s.base_stat;
      if (s.stat.name === "special-defense") baseStats.specialDefense = s.base_stat;
      if (s.stat.name === "speed") baseStats.speed = s.base_stat;
    }

    const abilities = (p.abilities || [])
      .slice()
      .sort((a, b) => a.slot - b.slot)
      .map((a) => ({
        abilityId: a.ability.name,
        isHidden: !!a.is_hidden,
        slot: a.slot
      }));

    const sprites = {
      default: `/sprites/pokemon/forms/${formName}.png`,
      shiny: `/sprites/pokemon/forms/shiny/${formName}.png`
    };

    const typeEffectiveness = calcTypeEffectivenessStub(types);

    const mechanics =
      formType === "mega"
        ? { mega: { megaStoneItemId: null } }
        : formType === "gigantamax"
          ? { gigantamax: { gmaxFactor: true } }
          : {};

    out[formName] = {
      formId: formName,
      baseSpeciesId: String(dexId),
      formType,
      displayName: humanizeFormName(formName),

      types,
      baseStats,
      abilities,

      height: toMeters(p.height),
      weight: toKg(p.weight),

      sprites,
      typeEffectiveness,
      mechanics
    };
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2), "utf-8");
  fs.writeFileSync(MISSING_PATH, JSON.stringify(missing, null, 2), "utf-8");

  console.log(`\n✅ Gerado: ${OUT_PATH}`);
  console.log(`✅ Total forms exportadas: ${Object.keys(out).length}`);
  console.log(`⚠️ Forms que falharam: ${missing.length}`);
  console.log(`📄 Relatório: ${MISSING_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
