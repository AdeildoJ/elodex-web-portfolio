"use client";

import { useMemo, useState } from "react";

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
  id: string; // ✅ id padrão PokeAPI (ex: "potion", "poke-ball", "tm01", "tr12")
  name: string;

  descriptionPtBr?: string | null;
  effectPtBr?: string | null;

  category: ItemCategory | string;
  subCategory?: ItemSubCategory | string | null;

  price?: number | null;

  // pode vir do JSON, mas vamos resolver a imagem dinamicamente nos componentes
  sprite?: string | null;

  consumable?: boolean | null;
  battleUsable?: boolean | null;
  overworldUsable?: boolean | null;

  // quando for TM/HM/TR
  moveId?: string | null;
  moveNameCache?: string | null;
};

type MoveFromJson = {
  machineItem?: PokemonItem | null;
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

export default function ItensPage() {
  const PAGE_SIZE = 27;

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<ItemCategory | "todas">("todas");
  const [subCategory, setSubCategory] = useState<ItemSubCategory | "todas">("todas");
  const [page, setPage] = useState(1);

  const [selected, setSelected] = useState<PokemonItem | null>(null);

  const itemsArray: PokemonItem[] = useMemo(() => {
    const baseItems = Object.values(itemsData as Record<string, PokemonItem>);

    // ✅ puxa TM/HM/TR do moves.json (machineItem)
    const tmHmTrFromMoves = Object.values(movesData as Record<string, MoveFromJson>)
      .map((mv) => mv.machineItem)
      .filter((x): x is PokemonItem => !!x && !!x.id);

    // evita duplicar ids
    const baseIds = new Set(baseItems.map((it) => it.id));
    const uniqueMachines = tmHmTrFromMoves.filter((it) => !baseIds.has(it.id));

    // ✅ BUG FIX: espalhar arrays
    return [...baseItems, ...uniqueMachines];
  }, []);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();

    const list = itemsArray.filter((it) => {
      const matchSearch =
        !s ||
        (it.name || "").toLowerCase().includes(s) ||
        (it.id || "").toLowerCase().includes(s) ||
        (it.moveId || "").toLowerCase().includes(s);

      const matchCategory = category === "todas" || it.category === category;
      const matchSub = subCategory === "todas" || it.subCategory === subCategory;

      return matchSearch && matchCategory && matchSub;
    });

    return list;
  }, [itemsArray, search, category, subCategory]);

  // quando filtros mudarem, volta pra página 1
  useMemo(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, category, subCategory]);

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
      {/* Menu lateral */}
      <aside className="w-72 shrink-0 bg-slate-900/40 border border-slate-800 rounded-lg p-3">
        <div className="text-sm font-semibold mb-2">Itens</div>

        <input
          className="w-full mb-3 px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-sm"
          placeholder="Buscar item (nome, id, moveId)..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="mb-3">
          <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">
            Categorias
          </div>

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
          <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">
            Subcategorias
          </div>

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

      {/* Grid + paginação */}
      <section className="flex-1">
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
              Página <b>{safePage}</b> / <b>{totalPages}</b>
            </div>

            <button
              className="px-3 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-sm disabled:opacity-40"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Próximo
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {paginated.map((it) => (
            <ItemCard key={it.id} item={it} onClick={() => setSelected(it)} />
          ))}
        </div>

        {selected && <ItemModal item={selected} onClose={() => setSelected(null)} />}
      </section>
    </div>
  );
}
