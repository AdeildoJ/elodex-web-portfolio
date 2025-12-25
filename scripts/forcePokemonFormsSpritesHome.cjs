/* admin/scripts/forcePokemonFormsSpritesHome.cjs
 *
 * Lê:  admin/src/data/pokemon/pokemonForms.json
 * Atualiza sprites:
 *   - sprites.default  (URL)
 *   - sprites.shiny    (URL)
 *
 * Fonte (fallback):
 *   1) sprites.other.home.front_default / front_shiny
 *   2) sprites.other["official-artwork"].front_default / front_shiny
 *   3) sprites.front_default / front_shiny
 *
 * Salva:
 *   - sobrescreve pokemonForms.json
 *   - cria pokemonForms.sprites.report.json
 */

const fs = require("fs");
const path = require("path");

const FORMS_PATH = path.join(__dirname, "..", "src", "data", "pokemon", "pokemonForms.json");
const REPORT_PATH = path.join(__dirname, "..", "src", "data", "pokemon", "pokemonForms.sprites.report.json");

const POKEAPI = "https://pokeapi.co/api/v2/pokemon";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url) {
  // Node 18+ tem fetch global; Node 22 tem também.
  const fetchFn = globalThis.fetch;
  if (!fetchFn) throw new Error("fetch não disponível no Node. Atualize para Node 18+.");
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return res.json();
}

function pickSpriteUrls(pokemonJson) {
  const other = pokemonJson?.sprites?.other;

  const homeDefault = other?.home?.front_default || null;
  const homeShiny = other?.home?.front_shiny || null;

  const officialDefault = other?.["official-artwork"]?.front_default || null;
  const officialShiny = other?.["official-artwork"]?.front_shiny || null;

  const frontDefault = pokemonJson?.sprites?.front_default || null;
  const frontShiny = pokemonJson?.sprites?.front_shiny || null;

  const finalDefault = homeDefault || officialDefault || frontDefault || null;
  const finalShiny = homeShiny || officialShiny || frontShiny || null;

  const source =
    homeDefault || homeShiny
      ? "home"
      : officialDefault || officialShiny
        ? "official-artwork"
        : frontDefault || frontShiny
          ? "front"
          : "none";

  return { default: finalDefault, shiny: finalShiny, source };
}

function ensureSpritesObject(entry) {
  if (!entry.sprites || typeof entry.sprites !== "object") entry.sprites = {};
  return entry.sprites;
}

function getEntriesFromJson(raw) {
  // Suporta:
  // 1) objeto: { "charizard-gmax": {...}, ... }
  // 2) array:  [ {...}, {...} ]  (nesse caso precisa ter formId dentro)
  if (Array.isArray(raw)) {
    const map = {};
    for (const e of raw) {
      if (!e || !e.formId) continue;
      map[String(e.formId)] = e;
    }
    return { map, isArray: true };
  }

  // objeto normal
  return { map: raw || {}, isArray: false };
}

async function main() {
  if (!fs.existsSync(FORMS_PATH)) {
    throw new Error(`Arquivo não encontrado: ${FORMS_PATH}`);
  }

  const rawText = fs.readFileSync(FORMS_PATH, "utf-8");
  const rawJson = JSON.parse(rawText);

  const { map: formsMap, isArray } = getEntriesFromJson(rawJson);

  const formIds = Object.keys(formsMap);

  console.log(`Total de forms no JSON: ${formIds.length} (formato: ${isArray ? "array" : "objeto"})`);

  const report = {
    updated: 0,
    noChange: 0,
    missingSprite: [],
    failedFetch: [],
    bySource: { home: 0, "official-artwork": 0, front: 0, none: 0 },
  };

  for (let i = 0; i < formIds.length; i++) {
    const formId = formIds[i];
    const entry = formsMap[formId];

    // throttling leve (evita rate limit)
    if (i % 25 === 0 && i !== 0) await sleep(350);

    const url = `${POKEAPI}/${encodeURIComponent(formId)}`;

    try {
      const p = await fetchJson(url);
      const sprite = pickSpriteUrls(p);

      const spritesObj = ensureSpritesObject(entry);

      const prevDefault = spritesObj.default ?? null;
      const prevShiny = spritesObj.shiny ?? null;

      spritesObj.default = sprite.default;
      spritesObj.shiny = sprite.shiny;

      // opcional: manter a origem para debug (você pode remover se quiser)
      spritesObj.source = sprite.source;

      report.bySource[sprite.source] = (report.bySource[sprite.source] || 0) + 1;

      const changed = prevDefault !== spritesObj.default || prevShiny !== spritesObj.shiny;
      if (changed) report.updated++;
      else report.noChange++;

      if (!spritesObj.default && !spritesObj.shiny) {
        report.missingSprite.push({ formId, url, source: sprite.source });
      }

      formsMap[formId] = entry;
    } catch (err) {
      report.failedFetch.push({ formId, url, error: String(err?.message || err) });
      continue;
    }
  }

  // Se o JSON original era array, reexporta como array; se era objeto, reexporta como objeto
  const outJson = isArray ? Object.values(formsMap) : formsMap;

  fs.writeFileSync(FORMS_PATH, JSON.stringify(outJson, null, 2), "utf-8");
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf-8");

  console.log("\n✅ Concluído!");
  console.log(`✅ Atualizados: ${report.updated}`);
  console.log(`➖ Sem alteração: ${report.noChange}`);
  console.log(`⚠️ Sem sprites (default e shiny): ${report.missingSprite.length}`);
  console.log(`❌ Falha no fetch: ${report.failedFetch.length}`);
  console.log(`📊 Fonte: home=${report.bySource.home}, official=${report.bySource["official-artwork"]}, front=${report.bySource.front}, none=${report.bySource.none}`);
  console.log(`📄 Relatório: ${REPORT_PATH}`);
}

main().catch((e) => {
  console.error("❌ Erro fatal:", e);
  process.exit(1);
});
