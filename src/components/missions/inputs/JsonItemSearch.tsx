"use client";

import { useMemo, useState } from "react";
import itemsData from "@/data/items.json";

type ItemRow = {
  id: string;
  name?: string;
};

type ItemsMap = Record<string, ItemRow>;

type Props = {
  value: string;
  onChange: (itemId: string) => void;
};

export default function JsonItemSearch({ value, onChange }: Props) {
  const [search, setSearch] = useState("");

  // ✅ items.json é um objeto (map), não array
  const itemsMap = itemsData as unknown as ItemsMap;

  // ✅ converte map -> array
  const items = useMemo(() => Object.values(itemsMap), [itemsMap]);

  const results = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return items.slice(0, 20);

    return items
      .filter((x) => {
        const id = String(x.id || "");
        const name = String(x.name || "");
        return id.toLowerCase().includes(s) || name.toLowerCase().includes(s);
      })
      .slice(0, 20);
  }, [items, search]);

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-2">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar item no JSON..."
        className="w-full rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm outline-none"
      />

      <div className="mt-2 flex items-center gap-2">
        <span className="text-[11px] text-slate-400">Selecionado:</span>
        <span className="text-[11px] font-semibold text-slate-200">
          {value || "—"}
        </span>
      </div>

      <div className="mt-2 max-h-48 overflow-auto rounded-md border border-slate-800">
        {results.map((it) => (
          <button
            key={it.id}
            type="button"
            onClick={() => onChange(String(it.id))}
            className="w-full px-3 py-2 text-left text-sm hover:bg-slate-800/60 border-b border-slate-800 last:border-b-0"
          >
            <div className="text-slate-100 font-semibold">
              {it.name ?? it.id}
            </div>
            <div className="text-[11px] text-slate-400">{it.id}</div>
          </button>
        ))}

        {results.length === 0 && (
          <div className="px-3 py-3 text-[11px] text-slate-400">
            Nenhum item encontrado.
          </div>
        )}
      </div>
    </div>
  );
}
