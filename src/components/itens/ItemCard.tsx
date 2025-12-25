"use client";

import type { PokemonItem } from "./ItensPage";

function getPokeApiItemSpriteUrl(id: string) {
  // sprites oficiais do repositório da PokeAPI
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/${id}.png`;
}

function getFallbackByCategory(item: PokemonItem) {
  // ✅ TR normalmente não existe como sprite individual, então cai num genérico
  if (item.category === "tm" || item.category === "hm" || item.category === "tr") {
    return "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/tm-normal.png";
  }
  // genérico final
  return "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/unknown.png";
}

export default function ItemCard({
  item,
  onClick,
}: {
  item: PokemonItem;
  onClick: () => void;
}) {
  // ✅ prioridade:
  // 1) se vier sprite http no JSON, usa
  // 2) senão, tenta pelo id (padrão pokeapi)
  const preferred =
    item.sprite && item.sprite.startsWith("http")
      ? item.sprite
      : getPokeApiItemSpriteUrl(item.id);

  const fallback = getFallbackByCategory(item);

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-slate-900/40 border border-slate-800 rounded-lg p-3 hover:bg-slate-800/40 transition flex items-center gap-3"
    >
      <div className="w-12 h-12 bg-slate-950 border border-slate-800 rounded-lg flex items-center justify-center overflow-hidden shrink-0">
        <img
          src={preferred}
          alt={item.name}
          className="w-10 h-10 object-contain"
          onError={(e) => {
            // ✅ tenta cair no fallback por categoria (tm/hm/tr) e depois unknown
            const img = e.currentTarget as HTMLImageElement;
            if (img.src !== fallback) img.src = fallback;
          }}
        />
      </div>

      <div className="min-w-0">
        <div className="text-slate-100 font-semibold truncate">{item.name}</div>
        <div className="text-xs text-slate-400 truncate">{String(item.category)}</div>
      </div>
    </button>
  );
}
