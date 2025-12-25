/**
 * SEED OFICIAL DO ELODEX
 * ----------------------
 * Popula o Firestore com TODOS os Pokémon da PokéAPI.
 *
 * Rodar com:
 *   npx ts-node --transpile-only scripts/seed-pokemon.ts
 */

import admin from "firebase-admin";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// ==============================
// __dirname em ESM
// ==============================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Caminho da chave de serviço (serviceAccountKey.json na pasta /admin)
const serviceAccountPath = path.join(__dirname, "..", "serviceAccountKey.json");

// Garante que o arquivo existe
if (!fs.existsSync(serviceAccountPath)) {
  console.error(
    "❌ Arquivo serviceAccountKey.json não encontrado em:",
    serviceAccountPath
  );
  console.error(
    "   Coloque o arquivo na pasta /admin (mesmo nível de scripts/, src/, package.json)."
  );
  process.exit(1);
}

// Lê e parseia o JSON manualmente
const serviceAccountJson = fs.readFileSync(serviceAccountPath, "utf8");
const serviceAccount = JSON.parse(serviceAccountJson);

// Inicializa Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

// ==============================
// Tipos usados no EloDex
// ==============================
type PokemonType =
  | "fire"
  | "water"
  | "grass"
  | "electric"
  | "rock"
  | "steel"
  | "bug"
  | "ground"
  | "flying"
  | "fighting"
  | "psychic"
  | "poison"
  | "normal"
  | "ghost"
  | "ice"
  | "dragon"
  | "dark"
  | "fairy";

type PokemonClass = "Comum" | "Baby" | "Semi-Lendário" | "Mítico" | "Lendário";

interface PokemonSpeciesDoc {
  dexNumber: number;
  name: string;
  types: PokemonType[];
  pokemonClass: PokemonClass;
  spriteUrl: string | null;
  baseStats: {
    hp: number;
    attack: number;
    defense: number;
    specialAttack: number;
    specialDefense: number;
    speed: number;
  };
  height: number;
  weight: number;
}

// ==============================
// Helpers de API
// ==============================
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAllPokemonUrls() {
  console.log("🌐 Buscando lista de Pokémon na PokéAPI...");
  const res = await fetch("https://pokeapi.co/api/v2/pokemon?limit=2000");

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Erro HTTP ao buscar lista de Pokémon: ${res.status} ${res.statusText} – ${text.slice(
        0,
        200
      )}`
    );
  }

  const data: any = await res.json();

  if (!data || !Array.isArray(data.results)) {
    console.error("⚠️ Resposta inesperada da PokéAPI em /pokemon?limit=2000");
    console.error("   Chaves retornadas:", data ? Object.keys(data) : "nenhuma");
    return [];
  }

  return data.results as { name: string; url: string }[];
}

async function fetchPokemonDetails(url: string) {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Erro HTTP ao buscar Pokémon em ${url}: ${res.status} ${res.statusText} – ${text.slice(
        0,
        200
      )}`
    );
  }
  return res.json();
}

// ==============================
// Script principal
// ==============================
async function main() {
  console.log("🔄 Iniciando seed de Pokémon no Firestore...");

  const list = await fetchAllPokemonUrls();

  if (!Array.isArray(list)) {
    console.error(
      "❌ A lista de Pokémon retornada não é um array. Abortando seed."
    );
    process.exit(1);
  }

  console.log(`📦 Encontrados ${list.length} Pokémon na PokéAPI.`);

  let count = 0;

  for (const item of list) {
    try {
      const data: any = await fetchPokemonDetails(item.url);

      const id: number = data.id;
      const name: string = data.name;

      const types: PokemonType[] = (data.types || [])
        .map((t: any) => t.type?.name)
        .filter((t: string) =>
          [
            "fire",
            "water",
            "grass",
            "electric",
            "rock",
            "steel",
            "bug",
            "ground",
            "flying",
            "fighting",
            "psychic",
            "poison",
            "normal",
            "ghost",
            "ice",
            "dragon",
            "dark",
            "fairy",
          ].includes(t)
        );

      const spriteUrl: string | null =
        data.sprites?.other?.["official-artwork"]?.front_default ??
        data.sprites?.front_default ??
        null;

      const statsMap: Record<string, number> = {};
      for (const st of data.stats as any[]) {
        statsMap[st.stat.name] = st.base_stat;
      }

      const doc: PokemonSpeciesDoc = {
        dexNumber: id,
        name,
        types,
        pokemonClass: "Comum", // depois ajustamos lendário/mítico via painel
        spriteUrl,
        baseStats: {
          hp: statsMap["hp"] ?? 0,
          attack: statsMap["attack"] ?? 0,
          defense: statsMap["defense"] ?? 0,
          specialAttack: statsMap["special-attack"] ?? 0,
          specialDefense: statsMap["special-defense"] ?? 0,
          speed: statsMap["speed"] ?? 0,
        },
        height: data.height ?? 0,
        weight: data.weight ?? 0,
      };

      await db.collection("pokemonSpecies").doc(String(id)).set(doc, {
        merge: true,
      });

      count++;

      if (count % 50 === 0) {
        console.log(`✔️ ${count} Pokémon salvos... (último: #${id} ${name})`);
      }

      await sleep(80);
    } catch (error) {
      console.error(`❌ Erro ao processar ${item.name}:`, error);
    }
  }

  console.log(`🎉 Seed finalizado! Total importado: ${count} Pokémon.`);
}

// ==============================
// Executar
// ==============================
main()
  .then(() => {
    console.log("🏁 Concluído.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("💥 Erro crítico:", err);
    process.exit(1);
  });
