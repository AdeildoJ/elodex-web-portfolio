"use client";

import { useMemo, useState } from "react";
import pokemonSpeciesData from "@/data/pokemon/pokemonSpecies.json";

type SpeciesRow = {
  id?: string | number;
  dexNumber?: number;
  name?: string;
};

type SpeciesMap = Record<string, SpeciesRow>;

type PokemonRow = {
  id: number; // usaremos dexNumber como id numérico padrão
  name: string;
  rawId: string; // id real do catálogo (string) para debug/clareza se precisar
};

type Props = {
  value: number;
  onChange: (pokemonId: number) => void;
};

function safeName(v: any) {
  if (!v) return "";
  if (typeof v === "string") return v;
  // caso venha pt-br no futuro (não inventa campo, só previne crash)
  return String(v);
}

function toPokemonRow(raw: SpeciesRow, key: string): PokemonRow | null {
  const name = safeName(raw?.name).trim();
  if (!name) return null;

  // Prioridade: dexNumber (é o número que você usa na UI e é o que faz sentido pro admin)
  const dexNumber =
    typeof raw?.dexNumber === "number"
      ? raw.dexNumber
      : Number(raw?.dexNumber || 0);

  // fallback: id (se vier numérico)
  const rawIdNum = Number(raw?.id || 0);

  const finalId = dexNumber > 0 ? dexNumber : rawIdNum > 0 ? rawIdNum : 0;
  if (!finalId) return null;

  return {
    id: finalId,
    name,
    rawId: String(raw?.id ?? key),
  };
}

export default function JsonPokemonSearch({ value, onChange }: Props) {
  const [search, setSearch] = useState("");

  // ✅ pokemonSpecies.json é um objeto/map: { "1": {...}, "2": {...} }
  const speciesMap = pokemonSpeciesData as unknown as SpeciesMap;

  // ✅ converte map -> array (igual items)
  const pokemons = useMemo(() => {
    const rows: PokemonRow[] = [];
    for (const [key, raw] of Object.entries(speciesMap)) {
      const row = toPokemonRow(raw, key);
      if (row) rows.push(row);
    }

    // ordena por dexNumber/id
    rows.sort((a, b) => a.id - b.id);
    return rows;
  }, [speciesMap]);

  const selected = useMemo(() => {
    if (!value) return null;
    return pokemons.find((p) => p.id === value) ?? null;
  }, [pokemons, value]);

  const results = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return pokemons.slice(0, 20);

    return pokemons
      .filter((p) => {
        const id = String(p.id);
        const name = p.name.toLowerCase();
        return id.includes(s) || name.includes(s);
      })
      .slice(0, 20);
  }, [search, pokemons]);

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-2">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar Pokémon no JSON..."
        className="w-full rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm outline-none"
      />

      <div className="mt-2 flex items-center gap-2">
        <span className="text-[11px] text-slate-400">Selecionado:</span>
        <span className="text-[11px] font-semibold text-slate-200">
          {value ? `#${value}` : "—"}
        </span>

        {selected && (
          <span className="text-[11px] text-slate-300 truncate">
            • {selected.name}
          </span>
        )}
      </div>

      <div className="mt-2 max-h-48 overflow-auto rounded-md border border-slate-800">
        {results.map((p) => (
          <button
            key={`${p.id}-${p.rawId}`}
            type="button"
            onClick={() => onChange(Number(p.id))}
            className="w-full px-3 py-2 text-left text-sm hover:bg-slate-800/60 border-b border-slate-800 last:border-b-0"
          >
            <div className="text-slate-100 font-semibold">{p.name}</div>
            <div className="text-[11px] text-slate-400">#{p.id}</div>
          </button>
        ))}

        {results.length === 0 && (
          <div className="px-3 py-3 text-[11px] text-slate-400">
            Nenhum Pokémon encontrado.
          </div>
        )}
      </div>
    </div>
  );
}
