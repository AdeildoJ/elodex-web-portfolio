/**
 * Compara espécies no dex (mobile) com regras bundled (admin/functions/lib/pokemonEvolution.cjs).
 * Uso na raiz: node admin/scripts/audit-evolution-coverage.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const adminRoot = join(__dirname, "..");
const mobileSpecies = join(adminRoot, "../elodex-mobile/src/data/pokemon/pokemonSpecies.json");
const require = createRequire(import.meta.url);
const pePath = join(adminRoot, "functions/lib/pokemonEvolution.cjs");

function speciesIdsFromDex(raw) {
  const list = Array.isArray(raw) ? raw : Object.values(raw);
  const ids = new Set();
  for (const e of list) {
    const id = Math.trunc(Number(e?.id ?? e?.speciesId ?? 0));
    if (id > 0) ids.add(id);
  }
  return ids;
}

function main() {
  if (!existsSync(pePath)) {
    console.error("Missing bundle. Run: node admin/scripts/bundle-evolution.mjs");
    process.exit(1);
  }
  if (!existsSync(mobileSpecies)) {
    console.error("Missing", mobileSpecies);
    process.exit(1);
  }
  const pe = require(pePath);
  const rules = pe.EVOLUTION_RULES_BY_SPECIES || {};
  const dex = JSON.parse(readFileSync(mobileSpecies, "utf8"));
  const dexIds = speciesIdsFromDex(dex);

  const withRules = Object.keys(rules).map((k) => Math.trunc(Number(k))).filter((n) => n > 0);
  const ruleFromSet = new Set(withRules);

  /** Espécies que evoluem (aparecem como origem em qualquer regra). */
  const evolveFrom = new Set(withRules);
  /** Espécies destino de alguma evolução. */
  const evolveTo = new Set();
  for (const arr of Object.values(rules)) {
    for (const r of arr || []) {
      if (r?.toSpeciesId) evolveTo.add(Math.trunc(Number(r.toSpeciesId)));
    }
  }

  const inDexWithoutRule = [...dexIds].filter((id) => !ruleFromSet.has(id)).sort((a, b) => a - b);

  /** Heurística: estágio “intermediário” comum — muitos mons de uma linha só aparecem como destino. */
  const maybeMissingRules = inDexWithoutRule.filter((id) => {
    const e = (Array.isArray(dex) ? dex : Object.values(dex)).find((x) => Math.trunc(Number(x?.id ?? x?.speciesId)) === id);
    const name = String(e?.name || "");
    return id < 1025 && !name.toLowerCase().includes("mega");
  });

  console.log(
    JSON.stringify(
      {
        dexSpeciesCount: dexIds.size,
        speciesWithEvolutionRules: ruleFromSet.size,
        speciesInDexButNoRulesEntry: inDexWithoutRule.length,
        sampleDexIdsWithoutRules: maybeMissingRules.slice(0, 40),
        message:
          "Sem regra em EVOLUTION_RULES não implica bug — muitas espécies são estágio final ou event-only. Use este relatório para caçar buracos (ex.: linha inteira sem nenhum fromId).",
        specialChecks: {
          scatterbugChain664: Boolean(rules[664]?.length),
          wurmple265: Boolean(rules[265]?.length),
          tyrogue236: Boolean(rules[236]?.length),
          eevee133: Boolean(rules[133]?.length),
        },
      },
      null,
      2
    )
  );
}

main();
