/**
 * Bundler: empacota a engine PvP do mobile em um arquivo CommonJS auto-contido
 * que pode ser consumido pelas Cloud Functions sem duplicação de código.
 *
 * Uso: `node build-pvp-engine.js`
 * Saída: admin/functions/pvpEngine/engine.bundle.cjs
 *
 * Executar sempre que a engine mobile mudar (resolveTurnImpl, calculateDamage,
 * turnOrder, abilities, moveRules, types).
 */
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const repoRoot = path.resolve(__dirname, "..", "..");
// Usa um entry dedicado do mobile (src/battle/serverEntry.ts) que expõe
// tanto a engine PvP quanto `getBattleTypeMultiplier` — necessários para a
// resolução server-authoritative.
const mobileEngineEntry = path.resolve(
  repoRoot,
  "elodex-mobile",
  "src",
  "battle",
  "serverEntry.ts"
);
const outDir = path.resolve(__dirname, "pvpEngine");
const outFile = path.join(outDir, "engine.bundle.cjs");

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

// Alias para @elodex/pokemon-evolution -> local src.
const pokemonEvolutionAliasPlugin = {
  name: "pokemon-evolution-alias",
  setup(build) {
    build.onResolve({ filter: /^@elodex\/pokemon-evolution$/ }, () => ({
      path: path.resolve(
        repoRoot,
        "shared",
        "pokemon-evolution",
        "src",
        "index.ts"
      ),
    }));
  },
};

async function run() {
  try {
    await esbuild.build({
      entryPoints: [mobileEngineEntry],
      bundle: true,
      platform: "node",
      target: ["node20"],
      format: "cjs",
      outfile: outFile,
      sourcemap: false,
      minify: false,
      logLevel: "info",
      plugins: [pokemonEvolutionAliasPlugin],
      loader: { ".json": "json" },
      external: [],
    });
    const bytes = fs.statSync(outFile).size;
    console.log(
      `[build-pvp-engine] OK: ${outFile} (${(bytes / 1024).toFixed(1)} KB)`
    );
  } catch (err) {
    console.error("[build-pvp-engine] FAIL", err);
    process.exit(1);
  }
}

run();
