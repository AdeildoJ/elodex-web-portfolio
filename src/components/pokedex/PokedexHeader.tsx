import { useState } from "react";
import { ALL_TYPES, PokemonType } from "@/components/pokedex/pokedexTypes";

type PokedexHeaderProps = {
  search: string;
  onSearchChange: (value: string) => void;
  typeFilter: PokemonType | "Todos";
  onTypeFilterChange: (value: PokemonType | "Todos") => void;
  selectedVersion: string;
  onVersionChange: (value: string) => void;
  versions: { id: string; label: string }[];

  markedCount: number;
  showOnlyMarked: boolean;
  onShowOnlyMarkedChange: (value: boolean) => void;
  onBulkMarkAll: () => void;
  onBulkUnmarkAll: () => void;
  onBulkMarkAllOfType: (type: PokemonType) => void;
  onBulkMarkRandom: (count: number) => void;
  onBulkMarkRandomOfType: (params: { count: number; type: PokemonType }) => void;
  onConfigureCapturesClick: () => void;
};

const TYPE_FILTER_OPTIONS: (PokemonType | "Todos")[] = ["Todos", ...ALL_TYPES];

const typeBadgeLabel = (t: PokemonType) => t.charAt(0).toUpperCase() + t.slice(1);

export default function PokedexHeader({
  search,
  onSearchChange,
  typeFilter,
  onTypeFilterChange,
  selectedVersion,
  onVersionChange,
  versions,
  markedCount,
  showOnlyMarked,
  onShowOnlyMarkedChange,
  onBulkMarkAll,
  onBulkUnmarkAll,
  onBulkMarkAllOfType,
  onBulkMarkRandom,
  onBulkMarkRandomOfType,
  onConfigureCapturesClick,
}: PokedexHeaderProps) {
  const [bulkTypeAll, setBulkTypeAll] = useState<PokemonType>("fire");
  const [randomCount, setRandomCount] = useState<number>(10);
  const [randomCountType, setRandomCountType] = useState<number>(10);
  const [bulkTypeRandom, setBulkTypeRandom] = useState<PokemonType>("fire");

  return (
    <>
      {/* Topo */}
      <header className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Pokédex (Admin)</h1>
          <p className="text-sm text-slate-300 mt-1">
            Consulte dados enciclopédicos (JSON) e configure como cada Pokémon aparece no jogo.
            <span className="text-slate-400"> (Inclui formas como Mega/Gigantamax quando existirem.)</span>
          </p>
        </div>

        <div className="w-full md:w-64">
          <label className="block text-xs font-semibold text-slate-400 mb-1">
            Versão do EloDex
          </label>
          <select
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            value={selectedVersion}
            onChange={(e) => onVersionChange(e.target.value)}
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* Barra de filtros + marcações */}
      <section className="mb-4 rounded-lg bg-slate-900/70 border border-slate-800 px-4 py-3 space-y-3">
        {/* Linha 1: busca + filtro de tipo */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex-1">
            <label className="block text-xs font-semibold text-slate-400 mb-1">
              Buscar Pokémon
            </label>
            <input
              type="text"
              placeholder="Nome, formId, ou número da Pokédex..."
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>

          <div className="w-full lg:w-56">
            <label className="block text-xs font-semibold text-slate-400 mb-1">
              Filtrar por tipo
            </label>
            <select
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={typeFilter}
              onChange={(e) => onTypeFilterChange(e.target.value as PokemonType | "Todos")}
            >
              {TYPE_FILTER_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t === "Todos" ? "Todos" : typeBadgeLabel(t)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Linha 2: resumo de marcações + ver apenas marcados + botão Configurar */}
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between border-t border-slate-800 pt-3">
          <div className="text-xs text-slate-300">
            <span className="font-semibold text-slate-100">{markedCount}</span>{" "}
            selecionado(s) para configuração de captura.
          </div>

          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={showOnlyMarked}
                onChange={(e) => onShowOnlyMarkedChange(e.target.checked)}
                className="h-4 w-4 rounded border-slate-600 bg-slate-900"
              />
              Ver apenas selecionados
            </label>

            {markedCount > 0 && (
              <button
                type="button"
                onClick={onConfigureCapturesClick}
                className="inline-flex items-center rounded-md bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-[11px] font-semibold text-white"
              >
                Configurar Capturas
              </button>
            )}
          </div>
        </div>

        {/* Linha 3: ferramentas de marcação */}
        <div className="border-t border-slate-800 pt-3 space-y-2">
          <p className="text-[11px] text-slate-400">
            Ferramentas de seleção (somente nesta tela). Use para escolher quais Pokémon
            serão enviados ao modal “Configurar Capturas”.
          </p>

          <div className="grid gap-2 md:grid-cols-2">
            {/* Marcar / desmarcar todos + marcar todos do tipo */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onBulkMarkAll}
                  className="flex-1 inline-flex items-center justify-center rounded-md bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-[11px] font-semibold text-white"
                >
                  Marcar todos
                </button>

                <button
                  type="button"
                  onClick={onBulkUnmarkAll}
                  disabled={markedCount === 0}
                  className={`inline-flex items-center justify-center rounded-md px-3 py-1.5 text-[11px] font-semibold ${
                    markedCount === 0
                      ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                      : "bg-rose-600 hover:bg-rose-500 text-white"
                  }`}
                >
                  Desmarcar todos
                </button>
              </div>

              <div className="flex items-center gap-2">
                <select
                  className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={bulkTypeAll}
                  onChange={(e) => setBulkTypeAll(e.target.value as PokemonType)}
                >
                  {ALL_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {typeBadgeLabel(t)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => onBulkMarkAllOfType(bulkTypeAll)}
                  className="rounded-md bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-100 whitespace-nowrap"
                >
                  Marcar todos do tipo
                </button>
              </div>
            </div>

            {/* Marcar X aleatórios / X do tipo Y aleatórios */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  className="w-20 rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={randomCount}
                  onChange={(e) =>
                    setRandomCount(e.target.value === "" ? 0 : Number(e.target.value))
                  }
                />
                <button
                  type="button"
                  onClick={() => randomCount > 0 && onBulkMarkRandom(randomCount)}
                  className="flex-1 rounded-md bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-100 whitespace-nowrap"
                >
                  Marcar X aleatório
                </button>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  className="w-16 rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={randomCountType}
                  onChange={(e) =>
                    setRandomCountType(e.target.value === "" ? 0 : Number(e.target.value))
                  }
                />
                <select
                  className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={bulkTypeRandom}
                  onChange={(e) => setBulkTypeRandom(e.target.value as PokemonType)}
                >
                  {ALL_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {typeBadgeLabel(t)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() =>
                    randomCountType > 0 &&
                    onBulkMarkRandomOfType({ count: randomCountType, type: bulkTypeRandom })
                  }
                  className="rounded-md bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-100 whitespace-nowrap"
                >
                  Marcar X do tipo
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
