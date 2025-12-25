"use client";

import { useMemo, useState } from "react";

import Sidebar from "@/components/Sidebar";
import RequireAuth from "@/components/RequireAuth";

import PokedexHeader from "@/components/pokedex/PokedexHeader";
import PokemonGrid from "@/components/pokedex/PokemonGrid";
import PokemonDetailModal from "@/components/pokedex/PokemonDetailModal";
import CaptureConfigModal from "@/components/pokedex/CaptureConfigModal";
import { PokemonSpecies, PokemonType } from "@/components/pokedex/pokedexTypes";

import ItensPage from "@/components/itens/ItensPage";

// ✅ JSON LOCAL (catálogo fixo)
import pokemonSpeciesJson from "@/data/pokemon/pokemonSpecies.json";
import pokemonFormsJson from "@/data/pokemon/pokemonForms.json";

const VERSIONS = [
  { id: "elodex-base", label: "EloDex Base" },
  { id: "kanto-edition", label: "Kanto Edition" },
  { id: "johto-edition", label: "Johto Edition" },
];

type ViewMode = "pokemon" | "itens";

// Tipagem mínima pra ler pokemonForms.json
type PokemonFormJsonEntry = {
  formId: string;
  baseSpeciesId: string;
  formType: "mega" | "gigantamax" | "other";
  displayName: string;

  types?: PokemonType[];
  baseStats?: any;
  abilities?: any;

  height?: number | null;
  weight?: number | null;

  sprites?: {
    default?: string | null;
    shiny?: string | null;
  };

  typeEffectiveness?: any;
  mechanics?: any;
};

type PokemonFormsJsonMap = Record<string, PokemonFormJsonEntry>;

function normalizeBaseStats(raw: any) {
  if (!raw) return undefined;

  // Formato já "novo" (hp/attack/defense/specialAttack/specialDefense/speed)
  if (
    raw.hp !== undefined &&
    (raw.attack !== undefined ||
      raw.defense !== undefined ||
      raw.specialAttack !== undefined ||
      raw.specialDefense !== undefined ||
      raw.speed !== undefined)
  ) {
    return {
      hp: Number(raw.hp ?? 0),
      attack: Number(raw.attack ?? 0),
      defense: Number(raw.defense ?? 0),
      specialAttack: Number(raw.specialAttack ?? 0),
      specialDefense: Number(raw.specialDefense ?? 0),
      speed: Number(raw.speed ?? 0),
    };
  }

  // Formato do catálogo (hp/atk/def/spa/spd/spe)
  if (
    raw.hp !== undefined &&
    (raw.atk !== undefined ||
      raw.def !== undefined ||
      raw.spa !== undefined ||
      raw.spd !== undefined ||
      raw.spe !== undefined)
  ) {
    return {
      hp: Number(raw.hp ?? 0),
      attack: Number(raw.atk ?? 0),
      defense: Number(raw.def ?? 0),
      specialAttack: Number(raw.spa ?? 0),
      specialDefense: Number(raw.spd ?? 0),
      speed: Number(raw.spe ?? 0),
    };
  }

  return raw;
}

function normalizeSpecies(p: any): PokemonSpecies {
  return {
    // básicos
    id: String(p.id),
    dexNumber: Number(p.dexNumber ?? p.id ?? 0),
    name: String(p.name ?? ""),
    types: (p.types ?? []) as PokemonType[],
    pokemonClass: p.pokemonClass ?? "Comum",
    spriteUrl: p.spriteUrl ?? p.sprites?.default ?? p.sprites?.frontDefault ?? null,
    shinySpriteUrl: p.shinySpriteUrl ?? p.sprites?.shiny ?? p.sprites?.frontShiny ?? null,
    dexEntryPtBr: p.dexEntryPtBr ?? null,
    baseStats: normalizeBaseStats(p.baseStats) ?? undefined,
    height: (p.height ?? p.heightM) ?? undefined,
    weight: (p.weight ?? p.weightKg) ?? undefined,

    // campos obrigatórios novos (do seu tipo atual)
    generation: Number(p.generation ?? 0),
    legendary: Boolean(p.legendary ?? p.flags?.legendary ?? false),
    mythical: Boolean(p.mythical ?? p.flags?.mythical ?? false),
    captureRate: Number(p.captureRate ?? 0),

    // extras (somente se existirem no teu tipo — se não existirem, o TS ignora via cast)
    abilities: p.abilities ?? { normal: [], hidden: [] },
    eggGroups: p.eggGroups ?? [],
    typeEffectiveness: p.typeEffectiveness ?? null,
    typeMatchups: p.typeMatchups ?? null,
    sprites: p.sprites ?? null,
    evolutions: p.evolutions ?? null,
    forms: p.forms ?? [],
    regionalVariants: p.regionalVariants ?? [],
  } as unknown as PokemonSpecies;
}

function normalizeFormToSpecies(f: PokemonFormJsonEntry, base: PokemonSpecies | null): PokemonSpecies {
  const baseDexNumber = base?.dexNumber ?? Number(f.baseSpeciesId ?? 0) ?? 0;

  const baseClass = base?.pokemonClass ?? "Comum";
  const formClass =
    f.formType === "mega" ? "Mega" : f.formType === "gigantamax" ? "Gigantamax" : "Forma";

  return {
    // básicos
    id: String(f.formId),
    dexNumber: baseDexNumber,
    name: String(f.displayName || f.formId),
    types: ((f.types?.length ? f.types : base?.types) ?? []) as PokemonType[],
    pokemonClass: `${formClass} (${baseClass})`,
    spriteUrl: f.sprites?.default ?? null,
    shinySpriteUrl: f.sprites?.shiny ?? null,
    dexEntryPtBr: null,
    baseStats: normalizeBaseStats(f.baseStats ?? base?.baseStats ?? undefined) as any,
    height: typeof f.height === "number" ? f.height : base?.height ?? undefined,
    weight: typeof f.weight === "number" ? f.weight : base?.weight ?? undefined,

    // obrigatórios
    generation: base?.generation ?? 0,
    legendary: base?.legendary ?? false,
    mythical: base?.mythical ?? false,
    captureRate: base?.captureRate ?? 0,

    // extras (herda do base se fizer sentido)
    abilities: f.abilities ?? (base as any)?.abilities ?? { normal: [], hidden: [] },
    eggGroups: (base as any)?.eggGroups ?? [],
    typeEffectiveness: f.typeEffectiveness ?? (base as any)?.typeEffectiveness ?? null,
    typeMatchups: null,

    sprites: f.sprites ?? null,
    evolutions: null,
    forms: [],
    regionalVariants: [],
  } as unknown as PokemonSpecies;
}

export default function PokedexPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("pokemon");

  const allPokemon = useMemo<PokemonSpecies[]>(() => {
    // --- 1) Species ---
    const rawSpecies = pokemonSpeciesJson as unknown;

    const speciesListRaw = Array.isArray(rawSpecies)
      ? (rawSpecies as any[])
      : Object.values(rawSpecies as Record<string, any>);

    const normalizedSpecies: PokemonSpecies[] = speciesListRaw.map(normalizeSpecies);

    const speciesByDexId = new Map<string, PokemonSpecies>();
    for (const sp of normalizedSpecies) {
      speciesByDexId.set(String(sp.id), sp);
      speciesByDexId.set(String(sp.dexNumber), sp);
      if ((sp as any).slug) speciesByDexId.set(String((sp as any).slug), sp);
    }

    // --- 2) Forms (Mega/Gmax) ---
    const rawForms = pokemonFormsJson as unknown as PokemonFormsJsonMap;
    const formsList = Object.values(rawForms || {});

    const normalizedForms: PokemonSpecies[] = formsList
      .filter((f) => f && (f.formType === "mega" || f.formType === "gigantamax"))
      .map((f) => {
        const base = speciesByDexId.get(String(f.baseSpeciesId)) ?? null;
        return normalizeFormToSpecies(f, base);
      });

    // --- 3) Combine + order ---
    const combined = [...normalizedSpecies, ...normalizedForms];

    combined.sort((a, b) => {
      const ad = a.dexNumber ?? 0;
      const bd = b.dexNumber ?? 0;
      if (ad !== bd) return ad - bd;

      const aIsForm = String(a.id).includes("-");
      const bIsForm = String(b.id).includes("-");
      if (aIsForm !== bIsForm) return aIsForm ? 1 : -1;

      return (a.name ?? "").localeCompare(b.name ?? "");
    });

    return combined;
  }, []);

  const loading = false;
  const [pokemon] = useState<PokemonSpecies[]>(allPokemon);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<PokemonType | "Todos">("Todos");
  const [selectedVersion, setSelectedVersion] = useState<string>("elodex-base");

  const [selectedPokemon, setSelectedPokemon] = useState<PokemonSpecies | null>(null);

  // Marcações (APENAS EM MEMÓRIA)
  const [markedSpeciesIds, setMarkedSpeciesIds] = useState<Set<string>>(() => new Set());
  const [showOnlyMarked, setShowOnlyMarked] = useState(false);

  // Modal de configuração de capturas
  const [captureConfigOpen, setCaptureConfigOpen] = useState(false);

  function handleToggleMark(poke: PokemonSpecies) {
    setMarkedSpeciesIds((prev) => {
      const next = new Set(prev);
      const id = String(poke.id);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function bulkSetMarked(ids: string[], marked: boolean) {
    if (ids.length === 0) return;

    setMarkedSpeciesIds((prev) => {
      const next = new Set(prev);
      if (marked) ids.forEach((id) => next.add(String(id)));
      else ids.forEach((id) => next.delete(String(id)));
      return next;
    });
  }

  function handleBulkMarkAll() {
    const allIds = pokemon.map((p) => String(p.id));
    bulkSetMarked(allIds, true);
  }

  function handleBulkUnmarkAll() {
    const ids = Array.from(markedSpeciesIds);
    bulkSetMarked(ids, false);
  }

  function handleBulkMarkAllOfType(type: PokemonType) {
    const ids = pokemon.filter((p) => p.types.includes(type)).map((p) => String(p.id));
    bulkSetMarked(ids, true);
  }

  function pickRandomIds(allIds: string[], count: number): string[] {
    const ids = [...allIds];
    if (ids.length === 0 || count <= 0) return [];

    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }

    return ids.slice(0, Math.min(count, ids.length));
  }

  function handleBulkMarkRandom(count: number) {
    const allIds = pokemon.map((p) => String(p.id));
    const chosen = pickRandomIds(allIds, count);
    bulkSetMarked(chosen, true);
  }

  function handleBulkMarkRandomOfType(params: { count: number; type: PokemonType }) {
    const ids = pokemon.filter((p) => p.types.includes(params.type)).map((p) => String(p.id));
    const chosen = pickRandomIds(ids, params.count);
    bulkSetMarked(chosen, true);
  }

  const filteredPokemon = useMemo(() => {
    const s = search.trim().toLowerCase();

    let result = pokemon.filter((pk) => {
      const name = (pk.name ?? "").toLowerCase();
      const dex = String(pk.dexNumber ?? "").padStart(4, "0");
      const id = String(pk.id ?? "").toLowerCase();

      const matchSearch = !s || name.includes(s) || dex.includes(s) || id.includes(s);

      const matchType = typeFilter === "Todos" || pk.types.some((t) => t === typeFilter);

      return matchSearch && matchType;
    });

    if (showOnlyMarked) {
      result = result.filter((pk) => markedSpeciesIds.has(String(pk.id)));
    }

    return result;
  }, [pokemon, search, typeFilter, showOnlyMarked, markedSpeciesIds]);

  const markedCount = markedSpeciesIds.size;

  const markedPokemon = useMemo(
    () => pokemon.filter((pk) => markedSpeciesIds.has(String(pk.id))),
    [pokemon, markedSpeciesIds]
  );

  return (
    <RequireAuth>
      <div className="flex min-h-screen bg-slate-950 text-slate-100">
        <Sidebar />

        <main className="flex-1 bg-slate-950 px-4 py-6">
          <div className="flex gap-2 mb-4">
            <button
              className={`px-4 py-2 rounded-md text-sm font-semibold transition ${
                viewMode === "pokemon"
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-800 text-slate-200 hover:bg-slate-700"
              }`}
              onClick={() => setViewMode("pokemon")}
            >
              POKEMON
            </button>

            <button
              className={`px-4 py-2 rounded-md text-sm font-semibold transition ${
                viewMode === "itens"
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-800 text-slate-200 hover:bg-slate-700"
              }`}
              onClick={() => setViewMode("itens")}
            >
              ITENS
            </button>
          </div>

          {viewMode === "pokemon" ? (
            <>
              <PokedexHeader
                search={search}
                onSearchChange={setSearch}
                typeFilter={typeFilter}
                onTypeFilterChange={setTypeFilter}
                selectedVersion={selectedVersion}
                onVersionChange={setSelectedVersion}
                versions={VERSIONS}
                markedCount={markedCount}
                showOnlyMarked={showOnlyMarked}
                onShowOnlyMarkedChange={setShowOnlyMarked}
                onBulkMarkAll={handleBulkMarkAll}
                onBulkUnmarkAll={handleBulkUnmarkAll}
                onBulkMarkAllOfType={handleBulkMarkAllOfType}
                onBulkMarkRandom={handleBulkMarkRandom}
                onBulkMarkRandomOfType={handleBulkMarkRandomOfType}
                onConfigureCapturesClick={() => setCaptureConfigOpen(true)}
              />

              <PokemonGrid
                pokemon={filteredPokemon}
                loading={loading}
                onSelectPokemon={(pk) => setSelectedPokemon(pk)}
                markedIds={markedSpeciesIds}
                onToggleMark={handleToggleMark}
              />
            </>
          ) : (
            <ItensPage />
          )}

          {viewMode === "pokemon" && selectedPokemon && (
            <PokemonDetailModal
              pokemon={selectedPokemon}
              versionId={selectedVersion}
              onClose={() => setSelectedPokemon(null)}
            />
          )}

          {viewMode === "pokemon" && captureConfigOpen && (
            <CaptureConfigModal
              open={captureConfigOpen}
              onClose={() => setCaptureConfigOpen(false)}
              markedPokemon={markedPokemon}
              versionId={selectedVersion}
            />
          )}
        </main>
      </div>
    </RequireAuth>
  );
}
