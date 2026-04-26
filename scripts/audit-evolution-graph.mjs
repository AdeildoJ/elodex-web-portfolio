/**
 * Interpreta o grafo de evoluções bundled vs dex — separa folhas, raízes e "alvos sem saída".
 * Uso: node admin/scripts/audit-evolution-graph.mjs
 *
 * Não prova linhas oficiais completas (o dex local não lista `evolutions.to` populado);
 * destaca espécies que são destino de regra mas não têm regras próprias (normais = estágio final).
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const adminRoot = join(__dirname, "..");
const mobileSpecies = join(adminRoot, "../elodex-mobile/src/data/pokemon/pokemonSpecies.json");
const pePath = join(adminRoot, "functions/lib/pokemonEvolution.cjs");
const require = createRequire(import.meta.url);

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
  const pe = require(pePath);
  const rules = pe.EVOLUTION_RULES_BY_SPECIES || {};
  const dex = JSON.parse(readFileSync(mobileSpecies, "utf8"));
  const dexIds = speciesIdsFromDex(dex);

  const ruleKeys = new Set(Object.keys(rules).map((k) => Math.trunc(Number(k))).filter((n) => n > 0));
  const evolveTo = new Set();
  const ruleCountByFrom = new Map();
  for (const [k, arr] of Object.entries(rules)) {
    const from = Math.trunc(Number(k));
    const n = Array.isArray(arr) ? arr.length : 0;
    ruleCountByFrom.set(from, n);
    for (const r of arr || []) {
      if (r?.toSpeciesId) evolveTo.add(Math.trunc(Number(r.toSpeciesId)));
    }
  }

  /** Espécie no dex que é alvo de evolução mas não define saída — em geral estágio final. */
  const targetsWithoutOutgoing = [...evolveTo].filter((id) => dexIds.has(id) && !ruleCountByFrom.get(id)).sort((a, b) => a - b);

  /** No dex, sem chave em rules (não tenta evoluir no app). */
  const dexWithoutRuleKey = [...dexIds].filter((id) => !ruleKeys.has(id)).sort((a, b) => a - b);

  /** Interseção: aparece como destino mas também tem regras (ex.: Spewpa → Vivillon). */
  const chainMiddles = [...ruleKeys].filter((id) => evolveTo.has(id) && (ruleCountByFrom.get(id) || 0) > 0).sort((a, b) => a - b);

  const mandatory = {
    wurmple265: Boolean(rules[265]?.length),
    scatterbug664: Boolean(rules[664]?.length),
    spewpa665: Boolean(rules[665]?.length),
    tyrogue236: Boolean(rules[236]?.length),
    eevee133: Boolean(rules[133]?.length),
    burmy412: Boolean(rules[412]?.length),
    rockruff744: Boolean(rules[744]?.length),
  };

  console.log(
    JSON.stringify(
      {
        dexSpeciesCount: dexIds.size,
        speciesWithOutgoingRules: ruleKeys.size,
        evolutionTargetsCount: evolveTo.size,
        targetsInDexWithNoOutgoingRule: targetsWithoutOutgoing.length,
        sampleTargetsFinalStage: targetsWithoutOutgoing.slice(0, 30),
        dexSpeciesWithoutRuleKey: dexWithoutRuleKey.length,
        interpretation:
          "dexSpeciesWithoutRuleKey inclui finais, bebês sem evolução no app, event-only e lacunas reais. targetsInDexWithNoOutgoingRule costuma ser massa de estágios finais válidos.",
        chainMiddlesSample: chainMiddles.slice(0, 25),
        mandatorySpeciesChecks: mandatory,
      },
      null,
      2
    )
  );
}

main();
