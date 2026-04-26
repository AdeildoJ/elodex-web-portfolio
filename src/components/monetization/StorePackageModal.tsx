"use client";

import { useEffect, useState } from "react";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { auth, ensureFreshIdToken, storage } from "@/lib/firebase";

function slugify(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function boostHoursFromFirestore(boostRaw: Record<string, unknown>): number {
  let h = Math.max(0, Math.floor(Number(boostRaw.durationHours ?? 0)));
  if (h <= 0) {
    const legacyDays = Math.max(0, Math.floor(Number(boostRaw.durationDays ?? 0)));
    if (legacyDays > 0) h = legacyDays * 24;
  }
  return h;
}

export type StorePackageDraft = {
  id: string;
  code: string;
  name: string;
  description: string;
  sellKm: boolean;
  sellEcoin: boolean;
  sellBoost: boolean;
  itemsKm: number;
  itemsEcoin: number;
  boostBonusPercent: number;
  boostDurationHours: number;
  price: number;
  stockTotal: number;
  stockSold: number;
  purchaseLimitPerPlayer: number;
  isActive: boolean;
  imageUrl: string;
  currency: string;
  sortOrder: number;
};

interface Props {
  open: boolean;
  saving: boolean;
  pkg: StorePackageDraft | null;
  onClose: () => void;
  onSave: (pkg: Record<string, unknown>) => Promise<void> | void;
}

const defaultDraft: StorePackageDraft = {
  id: "",
  code: "",
  name: "",
  description: "",
  sellKm: false,
  sellEcoin: false,
  sellBoost: false,
  itemsKm: 0,
  itemsEcoin: 0,
  boostBonusPercent: 0,
  boostDurationHours: 24,
  price: 0,
  stockTotal: 0,
  stockSold: 0,
  purchaseLimitPerPlayer: 1,
  isActive: true,
  imageUrl: "",
  currency: "BRL",
  sortOrder: 1,
};

export default function StorePackageModal({ open, saving, pkg, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<StorePackageDraft>(defaultDraft);
  const [localError, setLocalError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLocalError(null);
    if (pkg) {
      const data = pkg as Record<string, unknown>;
      const items = (data.items as Record<string, unknown> | undefined) || {};
      const boostRaw =
        items.boost && typeof items.boost === "object" ? (items.boost as Record<string, unknown>) : {};
      const km = Math.max(0, Number(items.km ?? data.kmAmount ?? 0));
      const ecoin = Math.max(0, Number(items.ecoin ?? data.ecoinAmount ?? data.amount ?? 0));
      const bp = Math.max(0, Number(boostRaw.bonusPercent ?? boostRaw.kmBonusPercent ?? 0));
      const bh = boostHoursFromFirestore(boostRaw);
      setDraft({
        id: String(data.id ?? ""),
        code: String(data.code ?? ""),
        name: String(data.name ?? ""),
        description: String(data.description ?? ""),
        sellKm: km > 0,
        sellEcoin: ecoin > 0,
        sellBoost: bp > 0 && bh > 0,
        itemsKm: km,
        itemsEcoin: ecoin,
        boostBonusPercent: bp,
        boostDurationHours: bh > 0 ? bh : 24,
        price: Math.max(0, Number(data.price ?? 0)),
        stockTotal: Math.max(0, Math.floor(Number(data.stockTotal ?? 0))),
        stockSold: Math.max(0, Math.floor(Number(data.stockSold ?? 0))),
        purchaseLimitPerPlayer: Math.max(1, Math.floor(Number(data.purchaseLimitPerPlayer ?? 1))),
        isActive: data.isActive !== false,
        imageUrl: String(data.imageUrl ?? ""),
        currency: String(data.currency ?? "BRL"),
        sortOrder: Math.max(1, Math.floor(Number(data.sortOrder ?? 1))),
      });
    } else {
      setDraft({ ...defaultDraft });
    }
  }, [open, pkg]);

  if (!open) return null;

  function update<K extends keyof StorePackageDraft>(key: K, value: StorePackageDraft[K]) {
    setDraft((c) => ({ ...c, [key]: value }));
  }

  async function onPickImage(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setLocalError("Selecione um arquivo de imagem (JPEG, PNG ou WebP).");
      return;
    }
    if (file.size > 2.5 * 1024 * 1024) {
      setLocalError("Imagem muito grande (max. 2,5 MB).");
      return;
    }
    const baseId = slugify(draft.id || draft.code || draft.name || `pkg-${Date.now()}`);
    try {
      setUploading(true);
      setLocalError(null);
      await ensureFreshIdToken();
      const ext = file.name.split(".").pop()?.toLowerCase();
      const safeExt = ext && ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "jpg";
      const path = `storePackages/${baseId}/cover-${Date.now()}.${safeExt}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, file, { contentType: file.type });
      const url = await getDownloadURL(storageRef);
      update("imageUrl", url);
    } catch (e) {
      const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "";
      setLocalError(
        code === "storage/unauthorized"
          ? "Storage negou o upload. Precisa claim admin no usuario e regras publicadas (gravação storePackages/ só admin)."
          : e instanceof Error
            ? e.message
            : "Falha no upload da imagem."
      );
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit() {
    setLocalError(null);
    if (!draft.sellKm && !draft.sellEcoin && !draft.sellBoost) {
      setLocalError("Marque pelo menos um tipo: KM, Ecoin ou Boost.");
      return;
    }
    if (draft.sellKm && draft.itemsKm <= 0) {
      setLocalError("Informe a quantidade de KM (maior que zero).");
      return;
    }
    if (draft.sellEcoin && draft.itemsEcoin <= 0) {
      setLocalError("Informe a quantidade de Ecoin (maior que zero).");
      return;
    }
    if (draft.sellBoost) {
      if (draft.boostBonusPercent <= 0) {
        setLocalError("Informe o % (maior que zero).");
        return;
      }
      if (draft.boostDurationHours < 1) {
        setLocalError("Informe as horas (minimo 1).");
        return;
      }
    }
    if (!String(draft.name || "").trim()) {
      setLocalError("Nome do pacote e obrigatorio.");
      return;
    }
    if (draft.price <= 0) {
      setLocalError("Preco deve ser maior que zero.");
      return;
    }
    if (!Number.isInteger(draft.stockTotal) || draft.stockTotal < 0) {
      setLocalError("Estoque total deve ser um inteiro >= 0 (0 = ilimitado).");
      return;
    }
    if (draft.stockTotal > 0 && draft.stockTotal < draft.stockSold) {
      setLocalError("Estoque total nao pode ser menor que o ja vendido.");
      return;
    }
    if (!Number.isInteger(draft.purchaseLimitPerPlayer) || draft.purchaseLimitPerPlayer < 1) {
      setLocalError("Limite por jogador deve ser um inteiro >= 1.");
      return;
    }

    const normalizedId = slugify(draft.id || draft.code || draft.name);
    if (!normalizedId) {
      setLocalError("Nao foi possivel gerar o identificador do pacote.");
      return;
    }

    const items: Record<string, unknown> = {};
    if (draft.sellKm && draft.itemsKm > 0) items.km = Math.floor(draft.itemsKm);
    if (draft.sellEcoin && draft.itemsEcoin > 0) items.ecoin = Math.floor(draft.itemsEcoin);
    if (draft.sellBoost && draft.boostBonusPercent > 0 && draft.boostDurationHours >= 1) {
      items.boost = {
        bonusPercent: Math.floor(draft.boostBonusPercent),
        durationHours: Math.floor(draft.boostDurationHours),
      };
    }

    const payload: Record<string, unknown> = {
      id: normalizedId,
      code: slugify(draft.code || normalizedId),
      name: String(draft.name).trim(),
      description: String(draft.description || "").trim(),
      items,
      price: draft.price,
      stockTotal: Math.floor(draft.stockTotal),
      purchaseLimitPerPlayer:
        draft.purchaseLimitPerPlayer <= 0 ? 0 : Math.floor(draft.purchaseLimitPerPlayer),
      isActive: draft.isActive,
      imageUrl: draft.imageUrl?.trim() || "",
      currency: draft.currency || "BRL",
      sortOrder: Math.floor(draft.sortOrder),
      schemaVersion: 1,
    };

    const uid = auth.currentUser?.uid;
    if (uid && !pkg?.id) payload.createdBy = uid;

    await onSave(payload);
  }

  const num = (v: number, fallback = 0) => (Number.isFinite(v) ? v : fallback);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800 bg-slate-950/95 px-6 py-4 backdrop-blur">
          <h2 className="text-lg font-bold text-slate-100">{pkg ? "Editar pacote" : "Criar Pacote"}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-900"
          >
            Fechar
          </button>
        </div>
        <div className="space-y-4 px-6 py-5">
          {localError ? (
            <div className="rounded-lg border border-red-500/30 bg-red-950/30 px-3 py-2 text-sm text-red-200">
              {localError}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={draft.sellKm}
                onChange={(e) => update("sellKm", e.target.checked)}
                className="h-4 w-4 rounded border-slate-600"
              />
              KM
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={draft.sellEcoin}
                onChange={(e) => update("sellEcoin", e.target.checked)}
                className="h-4 w-4 rounded border-slate-600"
              />
              Ecoin
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={draft.sellBoost}
                onChange={(e) => update("sellBoost", e.target.checked)}
                className="h-4 w-4 rounded border-slate-600"
              />
              Boost
            </label>
          </div>

          {draft.sellKm ? (
            <label className="block text-sm text-slate-200">
              Quantidade de KM
              <input
                type="number"
                min={1}
                step={1}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                value={num(draft.itemsKm, 0)}
                onChange={(e) => update("itemsKm", Math.max(0, Number(e.target.value)))}
              />
            </label>
          ) : null}

          {draft.sellEcoin ? (
            <label className="block text-sm text-slate-200">
              Quantidade de Ecoin
              <input
                type="number"
                min={1}
                step={1}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                value={num(draft.itemsEcoin, 0)}
                onChange={(e) => update("itemsEcoin", Math.max(0, Number(e.target.value)))}
              />
            </label>
          ) : null}

          {draft.sellBoost ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm text-slate-200">
                %
                <input
                  type="number"
                  min={1}
                  step={1}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  value={num(draft.boostBonusPercent, 0)}
                  onChange={(e) => update("boostBonusPercent", Math.max(0, Number(e.target.value)))}
                />
              </label>
              <label className="block text-sm text-slate-200">
                Horas
                <input
                  type="number"
                  min={1}
                  step={1}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  value={num(draft.boostDurationHours, 1)}
                  onChange={(e) => update("boostDurationHours", Math.max(1, Math.floor(Number(e.target.value))))}
                />
              </label>
            </div>
          ) : null}

          <label className="block text-sm text-slate-200">
            Nome
            <input
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              value={draft.name}
              onChange={(e) => update("name", e.target.value)}
            />
          </label>

          <label className="block text-sm text-slate-200">
            Descricao
            <textarea
              className="mt-1 min-h-16 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              value={draft.description}
              onChange={(e) => update("description", e.target.value)}
            />
          </label>

          <div className="space-y-2">
            <div className="text-sm text-slate-200">Imagem</div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="cursor-pointer rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 hover:bg-slate-800">
                Inserir imagem
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  disabled={uploading || saving}
                  onChange={(e) => void onPickImage(e.target.files?.[0] || null)}
                />
              </label>
            </div>
            {draft.imageUrl ? (
              <img
                src={draft.imageUrl}
                alt=""
                className="mt-1 h-16 w-16 rounded-lg border border-slate-700 object-cover"
              />
            ) : null}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <label className="block text-xs text-slate-200 sm:text-sm">
              Preco (R$)
              <input
                type="number"
                min={0}
                step={0.01}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                value={num(draft.price, 0)}
                onChange={(e) => update("price", Math.max(0, Number(e.target.value)))}
              />
            </label>
            <label className="block text-xs text-slate-200 sm:text-sm">
              Estoque (0=ilim.)
              <input
                type="number"
                min={0}
                step={1}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                value={num(draft.stockTotal, 0)}
                onChange={(e) => update("stockTotal", Math.max(0, Math.floor(Number(e.target.value))))}
              />
            </label>
            <label className="block text-xs text-slate-200 sm:text-sm">
              Limite / jogador
              <input
                type="number"
                min={1}
                step={1}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
                value={num(draft.purchaseLimitPerPlayer, 1)}
                onChange={(e) =>
                  update("purchaseLimitPerPlayer", Math.max(1, Math.floor(Number(e.target.value))))
                }
              />
            </label>
          </div>
          {pkg?.id ? <div className="text-xs text-slate-500">Ja vendidos: {draft.stockSold}</div> : null}

          <div className="grid grid-cols-3 gap-2">
            <label className="block text-sm text-slate-200">
              Status
              <select
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                value={draft.isActive ? "active" : "inactive"}
                onChange={(e) => update("isActive", e.target.value === "active")}
              >
                <option value="active">Ativo</option>
                <option value="inactive">Inativo</option>
              </select>
            </label>
            <label className="block text-sm text-slate-200">
              Codigo
              <input
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                value={draft.code}
                onChange={(e) => update("code", slugify(e.target.value))}
              />
            </label>
            <label className="block text-sm text-slate-200">
              Ordem
              <input
                type="number"
                min={1}
                step={1}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                value={num(draft.sortOrder, 1)}
                onChange={(e) => update("sortOrder", Math.max(1, Math.floor(Number(e.target.value))))}
              />
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-900"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={saving || uploading}
              onClick={() => void handleSubmit()}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {uploading ? "Enviando..." : saving ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
