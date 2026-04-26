"use client";

import { useMemo, useState } from "react";

export type CatalogSpeciesOption = { id: number; label: string };

export function FilteredMultiNumber({
  label,
  options,
  values,
  onChange,
  hint,
}: {
  label: string;
  options: CatalogSpeciesOption[];
  values: number[];
  onChange: (next: number[]) => void;
  hint?: string;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return options.slice(0, 120);
    return options
      .filter((o) => o.label.toLowerCase().includes(s) || String(o.id).includes(s))
      .slice(0, 200);
  }, [options, q]);

  const set = useMemo(() => new Set(values), [values]);
  const toggle = (id: number) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(Array.from(next).sort((a, b) => a - b));
  };

  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-slate-400">{label}</label>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Filtrar…"
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600"
      />
      <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/80 p-2 text-xs">
        {filtered.map((o) => (
          <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-slate-800/80">
            <input type="checkbox" checked={set.has(o.id)} onChange={() => toggle(o.id)} className="rounded border-slate-600" />
            <span className="text-slate-200">
              #{o.id} — {o.label}
            </span>
          </label>
        ))}
        {!filtered.length && <p className="text-slate-500">Nenhum resultado.</p>}
      </div>
      {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

export function FilteredMultiString({
  label,
  options,
  values,
  onChange,
}: {
  label: string;
  options: { id: string; label: string }[];
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return options.slice(0, 100);
    return options.filter((o) => o.label.toLowerCase().includes(s) || o.id.includes(s)).slice(0, 150);
  }, [options, q]);

  const set = useMemo(() => new Set(values.map((x) => x.toLowerCase())), [values]);
  const toggle = (id: string) => {
    const key = id.toLowerCase();
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(Array.from(next));
  };

  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-slate-400">{label}</label>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Filtrar…"
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600"
      />
      <div className="max-h-36 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/80 p-2 text-xs">
        {filtered.map((o) => (
          <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-slate-800/80">
            <input
              type="checkbox"
              checked={set.has(o.id.toLowerCase())}
              onChange={() => toggle(o.id)}
              className="rounded border-slate-600"
            />
            <span className="font-mono text-slate-200">{o.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
