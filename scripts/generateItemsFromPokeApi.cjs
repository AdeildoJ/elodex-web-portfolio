/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

const OUTPUT = path.join(process.cwd(), "src", "data", "items.json");

const ITEM_LIST_URL = "https://pokeapi.co/api/v2/item?limit=9999";

// ⚙️ Config
const CONCURRENCY = 8; // não exagere pra não levar 429
const RETRIES = 3;
const RETRY_DELAY_MS = 800;

// -----------------------------
// Helpers
// -----------------------------
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url, triesLeft = RETRIES) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "EloDexAdmin/1.0 (items generator)",
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      // 404 / 500 / 429 etc.
      const msg = `HTTP ${res.status} ao buscar ${url}`;
      throw new Error(msg);
    }
    return res.json();
  } catch (err) {
    if (triesLeft > 1) {
      await sleep(RETRY_DELAY_MS);
      return fetchJson(url, triesLeft - 1);
    }
    throw err;
  }
}

// Mapeamento simples (você pode melhorar depois)
function mapCategory(item) {
  const cat = item.category?.name || "";

  if (cat.includes("ball")) return { category: "pokebola", subCategory: "captura" };

  // medicine costuma cobrir hp/status (vamos refinar depois)
  if (cat.includes("medicine")) return { category: "cura", subCategory: "recuperacao-hp" };

  if (cat.includes("healing")) return { category: "cura", subCategory: "recuperacao-hp" };
  if (cat.includes("revival")) return { category: "cura", subCategory: "recuperacao-status" };
  if (cat.includes("status-cures")) return { category: "status", subCategory: "recuperacao-status" };

  if (cat.includes("effort-drop")) return { category: "status", subCategory: "aumento-ev" };
  if (cat.includes("vitamins")) return { category: "status", subCategory: "aumento-ev" };

  if (cat.includes("held-items")) return { category: "item-segurado", subCategory: null };
  if (cat.includes("evolution")) return { category: "item-evolucao", subCategory: null };
  if (cat.includes("berry")) return { category: "berries", subCategory: null };
  if (cat.includes("key-items")) return { category: "item-chave", subCategory: null };

  // battle-items existe na PokeAPI em algumas gerações
  if (cat.includes("battle")) return { category: "item-batalha", subCategory: "boost-batalha" };

  return { category: "outros", subCategory: null };
}

function getPtBrName(data) {
  const pt = data.names?.find((n) => n.language?.name === "pt-BR");
  return pt?.name || data.name;
}

function getPtBrEffect(data) {
  const e = data.effect_entries?.find((x) => x.language?.name === "pt-BR");
  return {
    descriptionPtBr: e?.short_effect || null,
    effectPtBr: e?.effect || null,
  };
}

function isMachineItemName(name) {
  // ✅ TM/HM/TR NÃO entram no items.json (porque já vêm do moves.json)
  return name.startsWith("tm") || name.startsWith("hm") || name.startsWith("tr");
}

// -----------------------------
// Concurrency runner (pool)
// -----------------------------
async function runPool(inputs, worker, concurrency) {
  const results = [];
  let index = 0;

  async function next() {
    while (index < inputs.length) {
      const i = index++;
      try {
        const r = await worker(inputs[i], i);
        results.push(r);
      } catch (e) {
        results.push({ __error: true, input: inputs[i], error: String(e?.message || e) });
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => next());
  await Promise.all(workers);
  return results;
}

// -----------------------------
// Main
// -----------------------------
async function run() {
  console.log("🔄 Buscando lista de itens...");
  const list = await fetchJson(ITEM_LIST_URL);

  const urls = list.results.map((r) => r.url);

  let okCount = 0;
  let failCount = 0;

  const items = {};
  const failures = [];

  console.log(`📦 Total encontrado: ${urls.length} itens. Baixando com concorrência ${CONCURRENCY}...`);

  const processed = await runPool(
    urls,
    async (url) => {
      let data;
      try {
        data = await fetchJson(url);
      } catch (err) {
        failCount++;
        failures.push({ url, error: String(err?.message || err) });
        console.log(`⚠️ Falhou: ${url} -> ${String(err?.message || err)}`);
        return null;
      }

      if (!data || !data.name) return null;

      // Ignorar TM/HM/TR
      if (isMachineItemName(data.name)) return null;

      const { category, subCategory } = mapCategory(data);
      const { descriptionPtBr, effectPtBr } = getPtBrEffect(data);

      items[data.name] = {
        id: data.name, // ✅ padrão pokeapi
        name: getPtBrName(data), // PT-BR (nome)
        descriptionPtBr,
        effectPtBr,
        category,
        subCategory,
        price: typeof data.cost === "number" ? data.cost : null,
        consumable: data.consumable ?? null,
        battleUsable: Array.isArray(data.battle_effects) ? data.battle_effects.length > 0 : false,
        overworldUsable: Array.isArray(data.attributes)
          ? data.attributes.some((a) => a.name === "usable-overworld")
          : false,
      };

      okCount++;
      return data.name;
    },
    CONCURRENCY
  );

  // remove nulls do retorno (não usamos muito, mas ok)
  processed.filter(Boolean);

  fs.writeFileSync(OUTPUT, JSON.stringify(items, null, 2), "utf8");

  console.log("✅ items.json gerado!");
  console.log(`✅ Sucesso: ${okCount}`);
  console.log(`⚠️ Falhas: ${failCount}`);

  if (failures.length) {
    const failPath = path.join(process.cwd(), "scripts", "items_failures.json");
    fs.writeFileSync(failPath, JSON.stringify(failures, null, 2), "utf8");
    console.log(`🧾 Lista de falhas salva em: scripts/items_failures.json`);
  }
}

run().catch((e) => {
  console.error("❌ Erro fatal:", e);
  process.exit(1);
});
