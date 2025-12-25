import { useEffect, useMemo, useState } from "react";
import { PokemonSpecies, PokemonType } from "@/components/pokedex/pokedexTypes";

type PokemonGridProps = {
  pokemon: PokemonSpecies[];
  loading: boolean;
  onSelectPokemon: (pokemon: PokemonSpecies) => void;

  // marcações
  markedIds: Set<string>;
  onToggleMark: (pokemon: PokemonSpecies) => void;
};

const typeBadgeLabel = (t: PokemonType) =>
  t.charAt(0).toUpperCase() + t.slice(1);

const formatDexNumber = (n: number) => `#${String(n).padStart(4, "0")}`;

/**
 * Normaliza path:
 * - se vier "sprites/001.png" -> "/sprites/001.png"
 * - se vier "/sprites/001.png" -> mantém
 * - se vier "http..." -> mantém
 */
function normalizeSpritePath(path: string): string {
  const p = path.trim();
  if (!p) return p;
  if (p.startsWith("http://") || p.startsWith("https://")) return p;
  if (p.startsWith("/")) return p;
  return `/${p}`;
}

/**
 * Suporta tanto formato legado (spriteUrl) quanto novo (sprites.default)
 * sem depender do normalizador do page.tsx.
 */
function getSprite(pk: PokemonSpecies): string | null {
  const anyPk = pk as any;

  const candidates = [
    anyPk?.spriteUrl, // legado
    anyPk?.sprites?.default, // novo padrão pedido
    anyPk?.sprites?.front_default, // fallback se veio do modelo PokeAPI
    anyPk?.sprites?.other?.default, // fallback
  ].filter(Boolean);

  const first = candidates[0];
  if (typeof first !== "string") return null;

  return normalizeSpritePath(first);
}

export default function PokemonGrid({
  pokemon,
  loading,
  onSelectPokemon,
  markedIds,
  onToggleMark,
}: PokemonGridProps) {
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // sempre que o resultado filtrado mudar (ou mudar de tamanho),
  // volta para a primeira página para evitar cair em página vazia
  useEffect(() => {
    setPage(1);
  }, [pokemon.length]);

  if (loading) {
    return (
      <section className="mt-4 px-2 py-8 text-sm text-slate-300">
        Carregando Pokémon...
      </section>
    );
  }

  if (!loading && pokemon.length === 0) {
    return (
      <section className="mt-4 px-2 py-8 text-sm text-slate-300">
        Nenhum Pokémon encontrado com esses filtros.
      </section>
    );
  }

  const total = pokemon.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, total);
  const currentPageItems = pokemon.slice(startIndex, endIndex);

  return (
    <section className="mt-4">
      {/* Barra de paginação / resumo */}
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-[11px] text-slate-400 px-1">
        <span>
          Mostrando{" "}
          <span className="text-slate-100">{total === 0 ? 0 : startIndex + 1}</span>{" "}
          –{" "}
          <span className="text-slate-100">{endIndex}</span>{" "}
          de{" "}
          <span className="text-slate-100">{total}</span>{" "}
          Pokémon
        </span>

        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className={`rounded-md border px-2 py-1 text-[11px] ${
                currentPage === 1
                  ? "border-slate-700 bg-slate-900 text-slate-600 cursor-not-allowed"
                  : "border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
              }`}
            >
              &larr; Anterior
            </button>

            <span className="text-[11px] text-slate-300">
              Página <span className="text-slate-100">{currentPage}</span> de{" "}
              <span className="text-slate-100">{totalPages}</span>
            </span>

            <button
              type="button"
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
              className={`rounded-md border px-2 py-1 text-[11px] ${
                currentPage === totalPages
                  ? "border-slate-700 bg-slate-900 text-slate-600 cursor-not-allowed"
                  : "border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
              }`}
            >
              Próxima &rarr;
            </button>
          </div>
        )}
      </div>

      {/* Grid de cards – usando apenas os itens da página atual */}
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {currentPageItems.map((pk) => {
          const isMarked = markedIds.has(pk.id);
          const sprite = getSprite(pk);

          return (
            <div
              key={pk.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectPokemon(pk)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectPokemon(pk);
                }
              }}
              className={`group relative flex flex-col items-stretch rounded-xl border bg-slate-900/70 hover:bg-slate-800/80 transition overflow-hidden shadow-sm cursor-pointer
                ${
                  isMarked
                    ? "border-emerald-400/80 ring-1 ring-emerald-400/40"
                    : "border-slate-800 hover:border-indigo-500/70"
                }`}
            >
              {/* Botão de marcação (não abre o modal) */}
              <div className="absolute top-2 right-2 z-10">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation(); // impede abrir modal
                    onToggleMark(pk);
                  }}
                  className={`flex h-6 w-6 items-center justify-center rounded-full border text-[13px] ${
                    isMarked
                      ? "border-emerald-400 bg-emerald-500 text-slate-950"
                      : "border-slate-500/60 bg-slate-900/80 text-slate-300 hover:bg-slate-800"
                  }`}
                  title={isMarked ? "Desmarcar este Pokémon" : "Marcar este Pokémon"}
                >
                  {isMarked ? "✓" : "+"}
                </button>
              </div>

              <div className="flex justify-between px-3 pt-2 text-[11px] text-slate-400">
                <span>{formatDexNumber(pk.dexNumber)}</span>
                <span className="rounded-full bg-emerald-600/20 px-2 py-0.5 text-[10px] text-emerald-300">
                  {pk.pokemonClass || "Comum"}
                </span>
              </div>

              <div className="flex-1 flex flex-col items-center justify-center py-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {sprite ? (
                  <img
                    src={sprite}
                    alt={pk.name}
                    className="w-20 h-20 object-contain drop-shadow-[0_0_15px_rgba(79,70,229,0.5)] group-hover:scale-110 transition-transform"
                    onError={(e) => {
                      // troca por "Sem sprite" visualmente
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                      console.warn(
                        "[EloDex] Sprite não carregou:",
                        pk.name,
                        "→",
                        sprite
                      );
                    }}
                  />
                ) : (
                  <div className="w-20 h-20 flex items-center justify-center text-xs text-slate-500 border border-dashed border-slate-700 rounded-lg">
                    Sem sprite
                  </div>
                )}
              </div>

              <div className="px-3 pb-3">
                <div className="text-sm font-semibold text-slate-100 truncate">
                  {pk.name.charAt(0).toUpperCase() + pk.name.slice(1)}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {pk.types.map((t) => (
                    <span
                      key={t}
                      className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-100"
                    >
                      {typeBadgeLabel(t)}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
