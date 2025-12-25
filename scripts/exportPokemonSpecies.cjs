/* admin/scripts/exportPokemonSpecies.cjs */
const fs = require("fs");
const path = require("path");

const OUT_PATH = path.join(__dirname, "..", "src", "data", "pokemon", "pokemonSpecies.json");

// Ajuste aqui se você quiser limitar:
const MAX_ID = 1025; // deixe alto para cobrir todas as gerações suportadas pela PokéAPI

const POKEAPI = "https://pokeapi.co/api/v2";

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return res.json();
}

function toMeters(dm) {
  // PokéAPI: height em decímetros
  return Math.round((dm / 10) * 10) / 10;
}

function toKg(hg) {
  // PokéAPI: weight em hectogramas
  return Math.round((hg / 10) * 10) / 10;
}

function normalizeTypeName(t) {
  return String(t).toLowerCase();
}

function emptyTypeChart() {
  const types = [
    "normal","fire","water","electric","grass","ice",
    "fighting","poison","ground","flying","psychic","bug",
    "rock","ghost","dragon","dark","steel","fairy"
  ];
  const obj = {};
  for (const t of types) obj[t] = 1;
  return obj;
}

/**
 * Calcula multiplicadores defensivos finais do Pokémon dado seus tipos.
 * Usa damage_relations da PokéAPI (double/half/no damage from).
 */
async function buildDefensiveMultipliers(pokemonTypes, typeCache) {
  const multipliers = emptyTypeChart();

  for (const defType of pokemonTypes) {
    const t = normalizeTypeName(defType);

    if (!typeCache[t]) {
      const typeData = await fetchJson(`${POKEAPI}/type/${t}`);
      typeCache[t] = typeData.damage_relations;
    }

    const rel = typeCache[t];

    for (const atk of rel.double_damage_from) {
      const a = normalizeTypeName(atk.name);
      multipliers[a] *= 2;
    }
    for (const atk of rel.half_damage_from) {
      const a = normalizeTypeName(atk.name);
      multipliers[a] *= 0.5;
    }
    for (const atk of rel.no_damage_from) {
      const a = normalizeTypeName(atk.name);
      multipliers[a] *= 0;
    }
  }

  // Derivados prontos pra UI
  const immune = [];
  const resist = [];
  const weak = [];
  const neutral = [];

  for (const [atkType, mult] of Object.entries(multipliers)) {
    if (mult === 0) immune.push(atkType);
    else if (mult < 1) resist.push({ type: atkType, multiplier: mult });
    else if (mult > 1) weak.push({ type: atkType, multiplier: mult });
    else neutral.push(atkType);
  }

  // Ordena bonitinho
  resist.sort((a,b) => a.multiplier - b.multiplier);
  weak.sort((a,b) => b.multiplier - a.multiplier);

  return { multipliers, immune, resist, weak, neutral };
}

async function main() {
  const out = {};
  const typeCache = {}; // cache de damage_relations por tipo

  // garante pasta
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });

  for (let id = 1; id <= MAX_ID; id++) {
    try {
      const pokemon = await fetchJson(`${POKEAPI}/pokemon/${id}`);
      const species = await fetchJson(`${POKEAPI}/pokemon-species/${id}`);

      const types = pokemon.types
        .sort((a,b) => a.slot - b.slot)
        .map((t) => normalizeTypeName(t.type.name));

      const baseStats = {};
      for (const s of pokemon.stats) {
        const key = s.stat.name; // hp, attack, defense, special-attack, special-defense, speed
        if (key === "hp") baseStats.hp = s.base_stat;
        if (key === "attack") baseStats.atk = s.base_stat;
        if (key === "defense") baseStats.def = s.base_stat;
        if (key === "special-attack") baseStats.spa = s.base_stat;
        if (key === "special-defense") baseStats.spd = s.base_stat;
        if (key === "speed") baseStats.spe = s.base_stat;
      }

      const abilities = pokemon.abilities
        .sort((a,b) => a.slot - b.slot)
        .map((a) => ({
          abilityId: a.ability.name,
          isHidden: !!a.is_hidden,
          slot: a.slot
        }));

      const eggGroups = species.egg_groups.map((g) => g.name);

      const hatchCounter = species.hatch_counter ?? null;
      const stepsPerCycle = 255; // base comum usada em muito conteúdo + referência do ecossistema PokéAPI
      const stepsToHatch = (hatchCounter == null) ? null : stepsPerCycle * (hatchCounter + 1);

      const typeMatchups = await buildDefensiveMultipliers(types, typeCache);

      out[String(id)] = {
        id,
        name: pokemon.name[0].toUpperCase() + pokemon.name.slice(1),

        generation: Number(String(species.generation?.name || "generation-i").replace("generation-","").replace("i","1").replace("ii","2").replace("iii","3").replace("iv","4").replace("v","5").replace("vi","6").replace("vii","7").replace("viii","8").replace("ix","9")) || null,

        types,
        baseStats,

        abilities,
        eggGroups,

        heightM: toMeters(pokemon.height),
        weightKg: toKg(pokemon.weight),

        incubation: {
          hatchCounter,
          stepsPerCycle,
          stepsToHatch
        },

        captureRate: species.capture_rate ?? null,

        flags: {
          legendary: !!species.is_legendary,
          mythical: !!species.is_mythical
        },

        sprites: {
          frontDefault: `/sprites/pokemon/${id}.png`,
          frontShiny: `/sprites/pokemon/shiny/${id}.png`
        },

        typeMatchups,

        evolutions: {
          chainId: species.evolution_chain ? Number(species.evolution_chain.url.split("/").filter(Boolean).pop()) : null,
          fromId: null,
          to: [] // preencher depois via evolution_chain (se você quiser embutir)
        }
      };

      // evita rate limit
      if (id % 25 === 0) await sleep(350);

      console.log(`OK #${id} ${pokemon.name}`);
    } catch (e) {
      // Se a PokéAPI não tiver aquele id, só pula (não quebra o script).
      console.warn(`SKIP #${id}: ${e.message}`);
      await sleep(150);
    }
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2), "utf-8");
  console.log(`\nGerado: ${OUT_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
