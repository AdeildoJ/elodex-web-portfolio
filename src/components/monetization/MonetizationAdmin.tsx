"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDocs, serverTimestamp, setDoc } from "firebase/firestore";

import MonetizationProductModal from "@/components/monetization/MonetizationProductModal";
import EcoinPackageModal from "@/components/monetization/EcoinPackageModal";
import { db } from "@/lib/firebase";
import {
  ensureDefaultMonetizationCatalog,
  loadMonetizationProducts,
  loadVipPlans,
  purgeSeededMonetizationProducts,
} from "@/lib/monetization";
import {
  describeProductConfiguration,
  isLegacyProduct,
  normalizeVipPlan,
  serializeMonetizationProduct,
  syncProductDerivedFields,
  validateMonetizationProduct,
  type VipIncludedItemRef,
  type MonetizationProductDoc,
  type SupportedMonetizationProductDoc,
  type VipPlanDoc,
} from "@/lib/monetizationCatalog";

type Props = {
  mode: "vip" | "products" | "ecoin";
};

type SelectOption = {
  id: string;
  label: string;
};

type VipOfferOption = {
  id: string;
  source: "item_config" | "monetization_product" | "ecoin_package";
  refId: string;
  refCode?: string | null;
  label: string;
  categoryLabel?: string | null;
};

function numberValue(value: string, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function slugify(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function MonetizationAdmin({ mode }: Props) {
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [vipPlans, setVipPlans] = useState<VipPlanDoc[]>([]);
  const [products, setProducts] = useState<MonetizationProductDoc[]>([]);
  const [ecoinPackages, setEcoinPackages] = useState<any[]>([]);
  const [editingEcoin, setEditingEcoin] = useState<any | null>(null);
  const [biomeOptions, setBiomeOptions] = useState<SelectOption[]>([]);
  const [eventOptions, setEventOptions] = useState<SelectOption[]>([]);
  const [speciesOptions, setSpeciesOptions] = useState<Array<{ id: number; label: string }>>([]);
  const [fishingGroupOptions, setFishingGroupOptions] = useState<SelectOption[]>([]);
  const [vipOfferOptions, setVipOfferOptions] = useState<VipOfferOption[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<SupportedMonetizationProductDoc | null>(null);

  async function loadReferenceOptions() {
    const [biomeSnap, missionEventSnap, itemsConfigSnap, monetizationSnap, ecoinSnap, fishingGroupSnap] = await Promise.all([
      getDocs(collection(db, "biomes")),
      getDocs(collection(db, "missionsEvents")),
      getDocs(collection(db, "itemsConfig")),
      getDocs(collection(db, "monetizationProducts")),
      getDocs(collection(db, "ecoinPackages")),
      getDocs(collection(db, "fishingGroups")),
    ]);

    let speciesCatalog: Array<{ id: number; label: string }> = [];
    try {
      const res = await fetch("/api/catalog/options.json");
      if (res.ok) {
        const data = (await res.json()) as { species?: Array<{ id: number; label: string }> };
        if (Array.isArray(data?.species)) speciesCatalog = data.species;
      }
    } catch {
      speciesCatalog = [];
    }
    setSpeciesOptions(speciesCatalog);

    const biomes = biomeSnap.docs
      .map((docSnap) => {
        const data = docSnap.data() as Record<string, unknown>;
        const id = String(data.id || docSnap.id).trim().toLowerCase();
        return {
          id,
          label: String(data.name || data.nome || id),
        };
      })
      .filter((row) => row.id)
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

    const events = missionEventSnap.docs
      .map((docSnap) => {
        const data = docSnap.data() as Record<string, unknown>;
        const tipo = String(data.tipo || "").trim().toUpperCase();
        if (tipo !== "EVENTO") return null;
        return {
          id: docSnap.id,
          label: String(data.titulo || docSnap.id),
        };
      })
      .filter((row): row is SelectOption => Boolean(row))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

    setBiomeOptions(biomes);
    setEventOptions(events);

    const fishingGroupRows = fishingGroupSnap.docs
      .map((docSnap) => {
        const data = docSnap.data() as Record<string, unknown>;
        const id = String(data.id || docSnap.id).trim().toLowerCase();
        return {
          id,
          label: String(data.name || data.nome || id),
        };
      })
      .filter((row) => row.id)
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
    setFishingGroupOptions(fishingGroupRows);

    const offerRows: VipOfferOption[] = [];

    itemsConfigSnap.docs.forEach((docSnap) => {
      const data = docSnap.data() as Record<string, unknown>;
      if (!Boolean(data.saleEnabled)) return;
      offerRows.push({
        id: `item_config:${docSnap.id}`,
        source: "item_config",
        refId: docSnap.id,
        refCode: docSnap.id,
        label: String(data.itemName || docSnap.id),
        categoryLabel: `Item da loja${data.category ? ` • ${String(data.category)}` : ""}`,
      });
    });

    monetizationSnap.docs.forEach((docSnap) => {
      const data = docSnap.data() as Record<string, unknown>;
      offerRows.push({
        id: `monetization_product:${docSnap.id}`,
        source: "monetization_product",
        refId: docSnap.id,
        refCode: String(data.code || docSnap.id),
        label: String(data.name || docSnap.id),
        categoryLabel: `Monetizado • ${String(data.type || "produto")}`,
      });
    });

    ecoinSnap.docs.forEach((docSnap) => {
      const data = docSnap.data() as Record<string, unknown>;
      offerRows.push({
        id: `ecoin_package:${docSnap.id}`,
        source: "ecoin_package",
        refId: docSnap.id,
        refCode: String(data.code || docSnap.id),
        label: `${Number(data.amount || 0)} Ecoins`,
        categoryLabel: "Pacote Ecoin",
      });
    });

    offerRows.sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
    setVipOfferOptions(offerRows);
  }

  async function reloadAll() {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      await ensureDefaultMonetizationCatalog();
      const tasks: Promise<unknown>[] = [loadReferenceOptions()];

      if (mode === "vip") {
        tasks.push(loadVipPlans(true).then((rows) => setVipPlans(rows)));
      } else if (mode === "products") {
        try {
          await purgeSeededMonetizationProducts();
        } catch (e) {
          console.error("purgeSeededMonetizationProducts", e);
        }
        tasks.push(loadMonetizationProducts(true).then((rows) => setProducts(rows)));
      } else if (mode === "ecoin") {
        tasks.push(
          getDocs(collection(db, "ecoinPackages")).then((snap) => {
            const rows = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }));
            setEcoinPackages(rows);
          })
        );
      }

      await Promise.all(tasks);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Falha ao carregar monetizacao.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reloadAll();
  }, [mode]);

  async function saveVipPlan(plan: VipPlanDoc) {
    try {
      setSavingId(plan.id);
      setError(null);
      setSuccess(null);

      await setDoc(
        doc(db, "vipPlans", plan.id),
        {
          ...normalizeVipPlan(plan, plan.id),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setSuccess(`Plano ${plan.name} salvo.`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Falha ao salvar plano VIP.");
    } finally {
      setSavingId(null);
    }
  }

  async function saveProduct(product: SupportedMonetizationProductDoc) {
    const normalized = syncProductDerivedFields({
      ...product,
      id: slugify(product.id || product.code || product.name),
      code: slugify(product.code || product.id || product.name),
    });

    const errors = validateMonetizationProduct(normalized);
    if (errors.length) {
      setError(errors[0]);
      throw new Error(errors[0]);
    }

    const isEditing = products.some((row) => row.id === normalized.id);

    const duplicated = products.find(
      (row) => row.id === normalized.id && row.id !== normalized.id
    );

    if (duplicated && !isEditing) {
      const message = `Ja existe um produto com o id ${normalized.id}.`;
      setError(message);
      throw new Error(message);
    }

    try {
      setSavingId(normalized.id || "__new__");
      setError(null);
      setSuccess(null);

      await setDoc(
        doc(db, "monetizationProducts", normalized.id),
        {
          ...serializeMonetizationProduct(normalized),
          updatedAt: serverTimestamp(),
          ...(isEditing ? {} : { createdAt: serverTimestamp() }),
        },
        { merge: true }
      );

      setSuccess(`Produto ${normalized.name} salvo.`);
      setModalOpen(false);
      setEditingProduct(null);
      await reloadAll();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Falha ao salvar produto.";
      setError(message);
      throw new Error(message);
    } finally {
      setSavingId(null);
    }
  }

  async function saveEcoinPackage(pkg: any) {
    const normalized = {
      ...pkg,
      id: slugify(pkg.id || pkg.code || `${pkg.amount || ""}-ecoins`),
      code: slugify(pkg.code || pkg.id || `${pkg.amount || ""}-ecoins`),
    };

    try {
      setSavingId(normalized.id || "__new__");
      setError(null);
      setSuccess(null);

      await setDoc(
        doc(db, "ecoinPackages", normalized.id),
        {
          ...normalized,
          updatedAt: serverTimestamp(),
          ...(pkg.id ? {} : { createdAt: serverTimestamp() }),
        },
        { merge: true }
      );

      setSuccess(`Pacote Ecoin ${normalized.amount} salvo.`);
      setEditingEcoin(null);
      await reloadAll();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Falha ao salvar pacote de Ecoin.";
      setError(message);
      throw new Error(message);
    } finally {
      setSavingId(null);
    }
  }

  function updateVipPlan(id: string, updater: (current: VipPlanDoc) => VipPlanDoc) {
    setVipPlans((current) => current.map((plan) => (plan.id === id ? updater(plan) : plan)));
  }

  function addVipIncludedItem(planId: string, option: VipOfferOption) {
    updateVipPlan(planId, (current) => {
      if (current.includedItems.some((item) => item.id === option.id)) return current;
      const nextItem: VipIncludedItemRef = {
        id: option.id,
        source: option.source,
        refId: option.refId,
        refCode: option.refCode || null,
        name: option.label,
        categoryLabel: option.categoryLabel || null,
        quantity: 1,
      };
      return { ...current, includedItems: [...(current.includedItems || []), nextItem] };
    });
  }

  function openCreateModal() {
    setError(null);
    setSuccess(null);
    setEditingProduct(null);
    setModalOpen(true);
  }

  function openEditModal(product: MonetizationProductDoc) {
    if (isLegacyProduct(product)) {
      setError(`O produto ${product.name} usa schema legado (${product.type}) e nao pode ser editado neste novo modal.`);
      return;
    }

    setError(null);
    setSuccess(null);
    setEditingProduct(syncProductDerivedFields(product));
    setModalOpen(true);
  }

  const supportedProducts = useMemo(
    () => products.filter((product) => !isLegacyProduct(product)),
    [products]
  );

  const legacyProducts = useMemo(
    () => products.filter((product) => isLegacyProduct(product)),
    [products]
  );

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-100">
            {mode === "vip"
              ? "Planos VIP"
              : mode === "products"
              ? "Produtos monetizaveis"
              : "Pacotes de Ecoin"}
          </h2>
          <p className="text-sm text-slate-400">
            {mode === "vip"
              ? "Cadastre assinatura, validade e beneficios sem mexer nos fluxos do jogo."
              : mode === "products"
              ? "Novo fluxo com modal, tipagem clara e campos condicionais por tipo de produto."
              : "Configure os pacotes de Ecoin que aparecem no app mobile (preco em R$, quantidade de ecoin)."}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {mode === "products" ? (
            <button
              onClick={openCreateModal}
              className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
            >
              NOVO PRODUTO
            </button>
          ) : null}
          {mode === "ecoin" ? (
            <button
              onClick={() => {
                setError(null);
                setSuccess(null);
                setEditingEcoin({ id: "", code: "", amount: 0, price: 0, currency: "BRL", status: "active", sortOrder: 1 });
              }}
              className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
            >
              NOVO PACOTE
            </button>
          ) : null}

          <button
            onClick={reloadAll}
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 hover:border-slate-500"
          >
            Recarregar
          </button>
        </div>
      </div>

      {error ? (
        <div className="mb-3 rounded-md border border-red-500/30 bg-red-950/30 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      {success ? (
        <div className="mb-3 rounded-md border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-200">
          {success}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-lg border border-slate-800 bg-slate-950 px-4 py-8 text-center text-sm text-slate-400">
          Carregando configuracoes de monetizacao...
        </div>
      ) : mode === "vip" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {vipPlans.map((plan) => (
            <article key={plan.id} className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-100">{plan.id}</div>
                  <div className="text-xs text-slate-500">Checkout usa este id/codigo como oferta.</div>
                </div>
                <span
                  className={`rounded-full px-2 py-1 text-xs font-semibold ${
                    plan.status === "active"
                      ? "bg-emerald-500/20 text-emerald-300"
                      : "bg-slate-700 text-slate-300"
                  }`}
                >
                  {plan.status}
                </span>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm text-slate-300">
                  Nome
                  <input
                    className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
                    value={plan.name}
                    onChange={(e) => updateVipPlan(plan.id, (current) => ({ ...current, name: e.target.value }))}
                  />
                </label>

                <label className="text-sm text-slate-300">
                  Codigo
                  <input
                    className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
                    value={plan.code}
                    onChange={(e) =>
                      updateVipPlan(plan.id, (current) => ({
                        ...current,
                        code: e.target.value.trim().toLowerCase(),
                      }))
                    }
                  />
                </label>

                <label className="text-sm text-slate-300 md:col-span-2">
                  Descricao
                  <textarea
                    className="mt-1 min-h-24 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
                    value={plan.description}
                    onChange={(e) =>
                      updateVipPlan(plan.id, (current) => ({ ...current, description: e.target.value }))
                    }
                  />
                </label>

                <label className="text-sm text-slate-300">
                  Preco
                  <input
                    className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
                    value={String(plan.price)}
                    onChange={(e) =>
                      updateVipPlan(plan.id, (current) => ({
                        ...current,
                        price: numberValue(e.target.value, current.price),
                      }))
                    }
                  />
                </label>

                <label className="text-sm text-slate-300">
                  Duracao (dias)
                  <input
                    className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
                    value={String(plan.durationDays)}
                    onChange={(e) =>
                      updateVipPlan(plan.id, (current) => ({
                        ...current,
                        durationDays: Math.max(1, Math.floor(numberValue(e.target.value, current.durationDays))),
                      }))
                    }
                  />
                </label>

                <label className="text-sm text-slate-300">
                  Status
                  <select
                    className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
                    value={plan.status}
                    onChange={(e) =>
                      updateVipPlan(plan.id, (current) => ({
                        ...current,
                        status: e.target.value === "active" ? "active" : "inactive",
                      }))
                    }
                  >
                    <option value="active">Ativo</option>
                    <option value="inactive">Inativo</option>
                  </select>
                </label>

                <label className="text-sm text-slate-300">
                  Ordem
                  <input
                    className="mt-1 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
                    value={String(plan.sortOrder)}
                    onChange={(e) =>
                      updateVipPlan(plan.id, (current) => ({
                        ...current,
                        sortOrder: Math.max(1, Math.floor(numberValue(e.target.value, current.sortOrder))),
                      }))
                    }
                  />
                </label>
              </div>

              <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <div className="mb-2 text-sm font-semibold text-slate-100">Beneficios</div>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-sm text-slate-300">
                    Max personagens
                    <input
                      className="mt-1 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                      value={String(plan.benefits.maxCharacters)}
                      onChange={(e) =>
                        updateVipPlan(plan.id, (current) => ({
                          ...current,
                          benefits: {
                            ...current.benefits,
                            maxCharacters: Math.max(1, Math.floor(numberValue(e.target.value, current.benefits.maxCharacters))),
                          },
                        }))
                      }
                    />
                  </label>

                  <label className="text-sm text-slate-300">
                    Max Pokemon capturados
                    <input
                      className="mt-1 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                      value={String(plan.benefits.maxCapturedPokemon)}
                      onChange={(e) =>
                        updateVipPlan(plan.id, (current) => ({
                          ...current,
                          benefits: {
                            ...current.benefits,
                            maxCapturedPokemon: Math.max(
                              1,
                              Math.floor(numberValue(e.target.value, current.benefits.maxCapturedPokemon))
                            ),
                          },
                        }))
                      }
                    />
                  </label>

                  <label className="text-sm text-slate-300">
                    Max itens no storage
                    <input
                      className="mt-1 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                      value={String(plan.benefits.maxStorageItems)}
                      onChange={(e) =>
                        updateVipPlan(plan.id, (current) => ({
                          ...current,
                          benefits: {
                            ...current.benefits,
                            maxStorageItems: Math.max(1, Math.floor(numberValue(e.target.value, current.benefits.maxStorageItems))),
                          },
                        }))
                      }
                    />
                  </label>

                  <label className="text-sm text-slate-300">
                    Bonus XP (%)
                    <input
                      className="mt-1 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                      value={String(plan.benefits.xpBonusPercent)}
                      onChange={(e) =>
                        updateVipPlan(plan.id, (current) => ({
                          ...current,
                          benefits: {
                            ...current.benefits,
                            xpBonusPercent: Math.max(0, numberValue(e.target.value, current.benefits.xpBonusPercent)),
                          },
                        }))
                      }
                    />
                  </label>

                  <label className="text-sm text-slate-300">
                    Bonus dinheiro (%)
                    <input
                      className="mt-1 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                      value={String(plan.benefits.moneyBonusPercent)}
                      onChange={(e) =>
                        updateVipPlan(plan.id, (current) => ({
                          ...current,
                          benefits: {
                            ...current.benefits,
                            moneyBonusPercent: Math.max(0, numberValue(e.target.value, current.benefits.moneyBonusPercent)),
                          },
                        }))
                      }
                    />
                  </label>

                  <label className="text-sm text-slate-300">
                    Incubadoras semanais
                    <input
                      className="mt-1 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                      value={String(plan.benefits.weeklyIncubators)}
                      onChange={(e) =>
                        updateVipPlan(plan.id, (current) => ({
                          ...current,
                          benefits: {
                            ...current.benefits,
                            weeklyIncubators: Math.max(0, Math.floor(numberValue(e.target.value, current.benefits.weeklyIncubators))),
                          },
                        }))
                      }
                    />
                  </label>
                </div>
              </div>

              <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <div className="mb-2 text-sm font-semibold text-slate-100">Itens do pacote VIP</div>
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px]">
                  <select
                    className="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200"
                    defaultValue=""
                    onChange={(e) => {
                      const option = vipOfferOptions.find((row) => row.id === e.target.value);
                      if (option) addVipIncludedItem(plan.id, option);
                      e.target.value = "";
                    }}
                  >
                    <option value="">Adicionar item existente</option>
                    {vipOfferOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label} {option.categoryLabel ? `• ${option.categoryLabel}` : ""}
                      </option>
                    ))}
                  </select>
                  <div className="rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-400">
                    Seleção genérica por oferta cadastrada
                  </div>
                </div>

                <div className="mt-3 space-y-2">
                  {!plan.includedItems?.length ? (
                    <div className="rounded-md border border-dashed border-slate-700 px-3 py-3 text-sm text-slate-400">
                      Nenhum item vinculado ao pacote VIP.
                    </div>
                  ) : (
                    plan.includedItems.map((item) => (
                      <div key={item.id} className="grid gap-2 rounded-md border border-slate-800 bg-slate-950 p-3 md:grid-cols-[minmax(0,1fr)_110px_110px]">
                        <div>
                          <div className="text-sm font-semibold text-slate-100">{item.name}</div>
                          <div className="text-xs text-slate-500">
                            {item.categoryLabel || item.source} • {item.refCode || item.refId}
                          </div>
                        </div>
                        <input
                          className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
                          value={String(item.quantity)}
                          onChange={(e) =>
                            updateVipPlan(plan.id, (current) => ({
                              ...current,
                              includedItems: current.includedItems.map((row) =>
                                row.id === item.id
                                  ? { ...row, quantity: Math.max(1, Math.floor(numberValue(e.target.value, row.quantity))) }
                                  : row
                              ),
                            }))
                          }
                        />
                        <button
                          type="button"
                          onClick={() =>
                            updateVipPlan(plan.id, (current) => ({
                              ...current,
                              includedItems: current.includedItems.filter((row) => row.id !== item.id),
                            }))
                          }
                          className="rounded-md border border-red-500/40 px-3 py-2 text-sm text-red-200 hover:bg-red-500/10"
                        >
                          Remover
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  onClick={() => saveVipPlan(plan)}
                  disabled={savingId === plan.id}
                  className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {savingId === plan.id ? "Salvando..." : "Salvar plano"}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : mode === "products" ? (
        <div className="space-y-6">
          {!supportedProducts.length ? (
            <div className="rounded-lg border border-slate-800 bg-slate-950 px-4 py-8 text-center text-sm text-slate-400">
              Nenhum produto monetizado cadastrado.
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {supportedProducts.map((product) => (
                <article key={product.id} className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      {product.imageUrl ? (
                        <img
                          src={product.imageUrl}
                          alt={product.name}
                          className="h-14 w-14 rounded-lg border border-slate-700 object-cover"
                        />
                      ) : (
                        <div className="flex h-14 w-14 items-center justify-center">No image</div>
                      )}
                      <button
                        onClick={() => openEditModal(product)}
                        className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
                      >
                        Editar
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      ) : mode === "ecoin" ? (
        <div className="space-y-6">
          {!ecoinPackages.length ? (
            <div className="rounded-lg border border-slate-800 bg-slate-950 px-4 py-8 text-center text-sm text-slate-400">
              Nenhum pacote de Ecoin cadastrado.
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {ecoinPackages.map((pkg) => (
                <article key={pkg.id} className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-slate-100">{pkg.amount} Ecoins</h3>
                      <div className="text-xs text-slate-400">R$ {Number(pkg.price).toFixed(2)}</div>
                    </div>
                    <button
                      onClick={() => setEditingEcoin(pkg)}
                      className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
                    >
                      Editar
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {mode === "products" ? (
        <MonetizationProductModal
          open={modalOpen}
          saving={Boolean(savingId)}
          product={editingProduct}
          biomes={biomeOptions}
          events={eventOptions}
          speciesOptions={speciesOptions}
          fishingGroupOptions={fishingGroupOptions}
          onClose={() => {
            setModalOpen(false);
            setEditingProduct(null);
          }}
          onSave={saveProduct}
        />
      ) : null}
      {mode === "ecoin" ? (
        <EcoinPackageModal
          open={Boolean(editingEcoin)}
          saving={Boolean(savingId)}
          pkg={editingEcoin}
          onClose={() => setEditingEcoin(null)}
          onSave={saveEcoinPackage}
        />
      ) : null}
    </section>
  );
}
