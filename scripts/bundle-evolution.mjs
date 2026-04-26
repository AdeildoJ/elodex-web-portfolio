/**
 * Gera admin/functions/lib/pokemonEvolution.cjs a partir de shared/pokemon-evolution.
 * Execute antes do deploy das Cloud Functions: node admin/scripts/bundle-evolution.mjs
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..");
const outDir = path.join(root, "admin", "functions", "lib");
const entry = path.join(root, "shared", "pokemon-evolution", "src", "index.ts");
const outfile = path.join(outDir, "pokemonEvolution.cjs");

fs.mkdirSync(outDir, { recursive: true });

const cmd = [
  "npx",
  "esbuild",
  entry,
  "--bundle",
  "--platform=node",
  "--format=cjs",
  `--outfile=${outfile}`,
  "--sourcemap",
  "--log-level=warning",
].join(" ");

execSync(cmd, { stdio: "inherit", cwd: root, shell: true });
console.log("OK:", outfile);
