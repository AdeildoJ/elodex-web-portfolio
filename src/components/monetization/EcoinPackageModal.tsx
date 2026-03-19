"use client";

import { useEffect, useState } from "react";

// simple slugify helper (copied from product modal)
function slugify(value: string) {
  // reuse the same logic as MonetizationAdmin to keep behavior consistent
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface EcoinPackage {
  id: string;
  code: string;
  amount: number;
  price: number;
  currency: string;
  status: "active" | "inactive";
  sortOrder: number;
}

interface Props {
  open: boolean;
  saving: boolean;
  pkg: EcoinPackage | null;
  onClose: () => void;
  onSave: (pkg: EcoinPackage) => Promise<void> | void;
}

export default function EcoinPackageModal({ open, saving, pkg, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<EcoinPackage>({
    id: "",
    code: "",
    amount: 0,
    price: 0,
    currency: "BRL",
    status: "active",
    sortOrder: 1,
  });
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLocalError(null);
    if (pkg) {
      setDraft(pkg);
    } else {
      setDraft({
        id: "",
        code: "",
        amount: 0,
        price: 0,
        currency: "BRL",
        status: "active",
        sortOrder: 1,
      });
    }
  }, [open, pkg]);

  if (!open) return null;

  function update<K extends keyof EcoinPackage>(key: K, value: EcoinPackage[K]) {
    setDraft((c) => ({ ...c, [key]: value }));
  }

  async function handleSubmit() {
    setLocalError(null);
    const normalized = {
      ...draft,
      id: slugify(draft.id || draft.code || `${draft.amount}-ecoins`),
      code: slugify(draft.code || draft.id || `${draft.amount}-ecoins`),
    };
    if (!normalized.id) {
      setLocalError("Informe quantidade/descricao suficiente para gerar identificador.");
      return;
    }
    await onSave(normalized);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800 bg-slate-950/95 px-6 py-4 backdrop-blur">
          <h2 className="text-lg font-bold text-slate-100">
            {pkg ? "Editar pacote de Ecoin" : "Novo pacote de Ecoin"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-900"
          >
            Fechar
          </button>
        </div>
        <div className="space-y-6 px-6 py-5">
          {localError ? (
            <div className="rounded-lg border border-red-500/30 bg-red-950/30 px-3 py-2 text-sm text-red-200">
              {localError}
            </div>
          ) : null}

          <label className="text-sm text-slate-200">
            Quantidade de Ecoins
            <input
              type="number"
              min="0"
              step="1"
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              value={draft.amount}
              onChange={(e) => update("amount", Math.max(0, Number(e.target.value)))}
            />
          </label>

          <label className="text-sm text-slate-200">
            Preco (R$)
            <input
              type="number"
              min="0"
              step="0.01"
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              value={draft.price}
              onChange={(e) => update("price", Math.max(0, Number(e.target.value)))}
            />
          </label>

          <label className="text-sm text-slate-200">
            Codigo (opcional)
            <input
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              value={draft.code}
              onChange={(e) => update("code", slugify(e.target.value))}
            />
          </label>

          <label className="text-sm text-slate-200">
            Status
            <select
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              value={draft.status}
              onChange={(e) => update("status", e.target.value === "inactive" ? "inactive" : "active")}
            >
              <option value="active">Ativo</option>
              <option value="inactive">Inativo</option>
            </select>
          </label>

          <label className="text-sm text-slate-200">
            Ordem de exibicao
            <input
              type="number"
              min="1"
              step="1"
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              value={draft.sortOrder}
              onChange={(e) => update("sortOrder", Math.max(1, Math.floor(Number(e.target.value))))}
            />
          </label>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-900"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleSubmit}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {saving ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
