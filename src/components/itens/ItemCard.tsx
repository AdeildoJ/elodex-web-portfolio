"use client";

import movesData from "@/data/moves.json";
import type { PokemonItem, ShopItemConfig } from "./ItensPage";

type MoveEntry = { name?: string | null };
const movesMap = movesData as unknown as Record<string, MoveEntry>;

function getPokeApiItemSpriteUrl(id: string) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/${id}.png`;
}

function getFallbackByCategory(item: PokemonItem) {
  if (item.category === "tm" || item.category === "hm" || item.category === "tr") {
    return "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/tm-normal.png";
  }
  return "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/unknown.png";
}

function prettifyMoveName(raw: string) {
  return raw
    .split("-")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function resolveMachineMoveName(item: PokemonItem): string | null {
  const isMachine = item.category === "tm" || item.category === "hm" || item.category === "tr";
  if (!isMachine) return null;
  const moveId = String(item.moveId || "").trim().toLowerCase();
  if (!moveId) return null;
  const entry = movesMap[moveId];
  const raw = String(entry?.name || item.moveNameCache || moveId).trim();
  return raw ? prettifyMoveName(raw) : null;
}

function formatPrice(config?: ShopItemConfig) {
  if (!config?.saleEnabled) return null;

  if (config.sellMode === "game") {
    return `Moedas: ${config.gamePrice ?? "-"}`;
  }

  if (config.sellMode === "ecoin") {
    return `Real: ${config.ecoinPrice ?? "-"}`;
  }

  return `Moedas: ${config.gamePrice ?? "-"} | Real: ${config.ecoinPrice ?? "-"}`;
}

export default function ItemCard({
  item,
  shopConfig,
  onClick,
}: {
  item: PokemonItem;
  shopConfig?: ShopItemConfig;
  onClick: () => void;
}) {
  const preferred =
    item.sprite && item.sprite.startsWith("http")
      ? item.sprite
      : getPokeApiItemSpriteUrl(item.id);

  const fallback = getFallbackByCategory(item);
  const priceText = formatPrice(shopConfig);
  const machineMoveName = resolveMachineMoveName(item);

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
            const img = e.currentTarget as HTMLImageElement;
            if (img.src !== fallback) img.src = fallback;
          }}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="text-slate-100 font-semibold truncate">
            {item.name}
            {machineMoveName ? (
              <span className="text-slate-300 font-normal"> - {machineMoveName}</span>
            ) : null}
          </div>
          {shopConfig?.saleEnabled ? (
            <span className="rounded bg-emerald-600/25 border border-emerald-600/40 px-2 py-0.5 text-[10px] text-emerald-300">
              NA LOJA
            </span>
          ) : null}
        </div>

        <div className="text-xs text-slate-400 truncate">{String(item.category)}</div>
        {priceText ? <div className="text-xs text-emerald-300 truncate mt-1">{priceText}</div> : null}
      </div>
    </button>
  );
}
