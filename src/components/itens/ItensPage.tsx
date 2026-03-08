"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";

import itemsData from "@/data/items.json";
import movesData from "@/data/moves.json";

import ItemCard from "./ItemCard";
import ItemModal from "./ItemModal";

export type ItemCategory =
  | "pokebola"
  | "cura"
  | "item-batalha"
  | "item-evolucao"
  | "item-segurado"
  | "berries"
  | "tm"
  | "hm"
  | "tr"
  | "item-chave"
  | "status"
  | "multiplicador"
  | "outros";

export type ItemSubCategory =
  | "recuperacao-hp"
  | "recuperacao-status"
  | "aumento-ev"
  | "aumento-iv"
  | "captura"
  | "fuga"
  | "boost-batalha"
  | "experiencia";

export type PokemonItem = {
  id: string;
  name: string;

  descriptionPtBr?: string | null;
  effectPtBr?: string | null;

  category: ItemCategory | string;
  subCategory?: ItemSubCategory | string | null;

  price?: number | null;
  sprite?: string | null;

  consumable?: boolean | null;
  battleUsable?: boolean | null;
  overworldUsable?: boolean | null;

  moveId?: string | null;
  moveNameCache?: string | null;
};

type MoveFromJson = {
  machineItem?: PokemonItem | null;
};

export type SellMode = "game" | "ecoin" | "both";

export type ShopItemConfig = {
  saleEnabled: boolean;
  sellMode: SellMode;
  gamePrice: number | null;
  ecoinPrice: number | null;
  grantType?: "inventory" | "biome_access";
  biomeAccessBiomeId?: string | null;
  biomeAccessDurationHours?: number | null;
};

const CATEGORIES: ItemCategory[] = [
  "pokebola",
  "cura",
  "item-batalha",
  "item-evolucao",
  "item-segurado",
  "berries",
  "tm",
  "hm",
  "tr",
  "item-chave",
  "status",
  "multiplicador",
  "outros",
];

const SUBCATEGORIES: ItemSubCategory[] = [
  "recuperacao-hp",
  "recuperacao-status",
  "aumento-ev",
  "aumento-iv",
  "captura",
  "fuga",
  "boost-batalha",
  "experiencia",
];

const VIRTUAL_SHOP_ITEMS: PokemonItem[] = [
  {
    id: "egg-incubator",
    name: "Egg Incubator",
    descriptionPtBr: "Ativa a incubacao de ovos por passos fora do daycare.",
    effectPtBr: "Consumivel: 1 unidade por ovo.",
    category: "outros",
    subCategory: "experiencia",
    price: 0,
    consumable: true,
    battleUsable: false,
    overworldUsable: true,
  },
  {
    id: "biome-access-pass",
    name: "Biome Access Pass",
    descriptionPtBr: "Concede acesso temporario a um bioma.",
    effectPtBr: "Configuravel por bioma e duracao no painel da loja.",
    category: "outros",
    subCategory: "experiencia",
    price: 0,
    consumable: true,
    battleUsable: false,
    overworldUsable: true,
  },
];

export default function ItensPage() {
  const PAGE_SIZE = 27;

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<ItemCategory | "todas">("todas");
  const [subCategory, setSubCategory] = useState<ItemSubCategory | "todas">("todas");
  const [page, setPage] = useState(1);

  const [selected, setSelected] = useState<PokemonItem | null>(null);
  const [shopConfigs, setShopConfigs] = useState<Record<string, ShopItemConfig>>({});
  const [shopLoading, setShopLoading] = useState(true);
  const [showOnlyShopItems, setShowOnlyShopItems] = useState(false);

  const itemsArray: PokemonItem[] = useMemo(() => {
    const baseItems = Object.values(itemsData as Record<string, PokemonItem>);

    const tmHmTrFromMoves = Object.values(movesData as Record<string, MoveFromJson>)
      .map((mv) => mv.machineItem)
      .filter((x): x is PokemonItem => !!x && !!x.id);

    const baseIds = new Set(baseItems.map((it) => it.id));
    const uniqueMachines = tmHmTrFromMoves.filter((it) => !baseIds.has(it.id));
    const uniqueVirtual = VIRTUAL_SHOP_ITEMS.filter((it) => !baseIds.has(it.id));

    return [...baseItems, ...uniqueMachines, ...uniqueVirtual];
  }, []);

  useEffect(() => {
    let alive = true;

    async function loadShopConfigs() {
      setShopLoading(true);
      try {
        const snap = await getDocs(collection(db, "itemsConfig"));
        if (!alive) return;

        const next: Record<string, ShopItemConfig> = {};

        snap.forEach((docSnap) => {
          const data = docSnap.data() as Record<string, unknown>;
          const sellModeRaw = String(data.sellMode ?? "game");
          const normalizedSellMode: SellMode =
            sellModeRaw === "real"
              ? "ecoin"
              : sellModeRaw === "game" || sellModeRaw === "ecoin" || sellModeRaw === "both"
              ? (sellModeRaw as SellMode)
              : "game";

          const gameRaw = data.gamePrice;
          const gamePriceNumber =
            typeof gameRaw === "number" ? gameRaw : gameRaw != null ? Number(gameRaw) : null;

          const realRaw = data.ecoinPrice ?? data.realPrice ?? null;
          const realPriceNumber =
            typeof realRaw === "number" ? realRaw : realRaw != null ? Number(realRaw) : null;

          next[docSnap.id] = {
            saleEnabled: Boolean(data.saleEnabled),
            sellMode: normalizedSellMode,
            gamePrice: Number.isFinite(gamePriceNumber as number) ? gamePriceNumber : null,
            ecoinPrice: Number.isFinite(realPriceNumber as number) ? realPriceNumber : null,
          };
        });

        setShopConfigs(next);
      } finally {
        if (alive) setShopLoading(false);
      }
    }

    loadShopConfigs();
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();

    return itemsArray.filter((it) => {
      const matchSearch =
        !s ||
        (it.name || "").toLowerCase().includes(s) ||
        (it.id || "").toLowerCase().includes(s) ||
        (it.moveId || "").toLowerCase().includes(s);

      const matchCategory = category === "todas" || it.category === category;
      const matchSub = subCategory === "todas" || it.subCategory === subCategory;
      const matchShop = !showOnlyShopItems || Boolean(shopConfigs[it.id]?.saleEnabled);

      return matchSearch && matchCategory && matchSub && matchShop;
    });
  }, [itemsArray, search, category, subCategory, showOnlyShopItems, shopConfigs]);

  useEffect(() => {
    setPage(1);
  }, [search, category, subCategory, showOnlyShopItems]);

  const shopEnabledCount = useMemo(
    () => itemsArray.filter((it) => shopConfigs[it.id]?.saleEnabled).length,
    [itemsArray, shopConfigs]
  );

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  const paginated = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    return filtered.slice(start, end);
  }, [filtered, safePage]);

  return (
    <div className="flex gap-4">
      <aside className="w-72 shrink-0 bg-slate-900/40 border border-slate-800 rounded-lg p-3">
        <div className="text-sm font-semibold mb-2">Itens</div>

        <input
          className="w-full mb-3 px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-sm"
          placeholder="Buscar item (nome, id, moveId)..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="mb-3">
          <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">Categorias</div>

          <button
            className={`w-full text-left px-3 py-2 rounded-md text-sm ${
              category === "todas" ? "bg-emerald-600 text-white" : "hover:bg-slate-800"
            }`}
            onClick={() => setCategory("todas")}
          >
            Todas
          </button>

          <div className="mt-2 space-y-1 max-h-64 overflow-auto pr-1">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                className={`w-full text-left px-3 py-2 rounded-md text-sm ${
                  category === c ? "bg-emerald-600 text-white" : "hover:bg-slate-800"
                }`}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">Subcategorias</div>

          <button
            className={`w-full text-left px-3 py-2 rounded-md text-sm ${
              subCategory === "todas" ? "bg-emerald-600 text-white" : "hover:bg-slate-800"
            }`}
            onClick={() => setSubCategory("todas")}
          >
            Todas
          </button>

          <div className="mt-2 space-y-1 max-h-64 overflow-auto pr-1">
            {SUBCATEGORIES.map((sc) => (
              <button
                key={sc}
                className={`w-full text-left px-3 py-2 rounded-md text-sm ${
                  subCategory === sc ? "bg-emerald-600 text-white" : "hover:bg-slate-800"
                }`}
                onClick={() => setSubCategory(sc)}
              >
                {sc}
              </button>
            ))}
          </div>
        </div>
      </aside>

      <section className="flex-1">
        <div className="mb-3 rounded-lg border border-emerald-700/50 bg-emerald-950/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-emerald-300">Modo de criacao de loja</div>
              <div className="text-xs text-slate-300">
                Escolha os itens no modal e defina preco em moeda do jogo ou dinheiro real.
              </div>
            </div>

            <label className="inline-flex items-center gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={showOnlyShopItems}
                onChange={(e) => setShowOnlyShopItems(e.target.checked)}
              />
              Mostrar somente itens da loja
            </label>
          </div>

          <div className="mt-2 text-xs text-slate-300">
            {shopLoading ? (
              "Carregando configuracoes da loja..."
            ) : (
              <>
                Itens ativos na loja: <b>{shopEnabledCount}</b>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between mb-3">
          <div className="text-sm text-slate-300">
            Mostrando <b>{paginated.length}</b> de <b>{total}</b> itens
          </div>

          <div className="flex items-center gap-2">
            <button
              className="px-3 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-sm disabled:opacity-40"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Anterior
            </button>

            <div className="text-sm text-slate-300">
              Pagina <b>{safePage}</b> / <b>{totalPages}</b>
            </div>

            <button
              className="px-3 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-sm disabled:opacity-40"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Proximo
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {paginated.map((it) => (
            <ItemCard
              key={it.id}
              item={it}
              shopConfig={shopConfigs[it.id]}
              onClick={() => setSelected(it)}
            />
          ))}
        </div>

        {selected && (
          <ItemModal
            item={selected}
            onClose={() => setSelected(null)}
            onConfigSaved={(config) =>
              setShopConfigs((prev) => ({
                ...prev,
                [selected.id]: config,
              }))
            }
          />
        )}
      </section>
    </div>
  );
}
