"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { collection, deleteDoc, doc, getDocs, serverTimestamp, setDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";

import RequireAuth from "@/components/RequireAuth";
import Sidebar from "@/components/Sidebar";
import { db, storage } from "@/lib/firebase";
import { cropImageToAspectDataUrl, dataUrlToBlob, imageFileToStorableDataUrl } from "@/lib/imageProcessing";
import {
  GYM_ELEMENT_OPTIONS,
  LEGACY_SCENARIOS,
  SCENARIO_CLIMATE_OPTIONS,
  SCENARIO_SPECIAL_TYPE_OPTIONS,
  type GymElementType,
  type ScenarioClimateType,
  type ScenarioRecord,
  type ScenarioSpecialType,
  createLegacyScenarioSeed,
  normalizeScenarioRecord,
  slugifyScenario,
} from "@/lib/scenarioCatalog";

type ScenarioFormState = {
  scenarioId: string;
  name: string;
  imageUrl: string;
  processedImageUrl: string;
  isCommercialized: boolean;
  ecoinPrice: string;
  isSpecial: boolean;
  specialType: ScenarioSpecialType | "";
  climateType: ScenarioClimateType | "";
  gymElementType: GymElementType | "";
  isActive: boolean;
  sourceType: "legacy" | "custom";
  legacyScenarioId: string;
};

type BiomeUsageMap = Record<string, string[]>;

const emptyForm: ScenarioFormState = {
  scenarioId: "",
  name: "",
  imageUrl: "",
  processedImageUrl: "",
  isCommercialized: false,
  ecoinPrice: "",
  isSpecial: false,
  specialType: "",
  climateType: "",
  gymElementType: "",
  isActive: true,
  sourceType: "custom",
  legacyScenarioId: "",
};

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-14 items-center rounded-full border transition ${
        checked ? "border-emerald-400/60 bg-emerald-500/30" : "border-slate-700 bg-slate-800"
      } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${
          checked ? "translate-x-8" : "translate-x-1"
        }`}
      />
    </button>
  );
}

export default function CenarioPage() {
  const [items, setItems] = useState<ScenarioRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ScenarioFormState>(emptyForm);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [originalPreview, setOriginalPreview] = useState("");
  const [processedPreview, setProcessedPreview] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [biomeUsage, setBiomeUsage] = useState<BiomeUsageMap>({});

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const previewUrl = processedPreview || form.processedImageUrl || originalPreview || form.imageUrl;
  const linkedBiomeNames = useMemo(() => {
    if (!editingId) return [];
    return biomeUsage[editingId] || [];
  }, [biomeUsage, editingId]);

  useEffect(() => {
    void loadData();
  }, []);

  async function ensureLegacyScenarioDocs() {
    const snap = await getDocs(collection(db, "scenarios"));
    const existing = new Set(snap.docs.map((row) => row.id));
    const missing = LEGACY_SCENARIOS.filter((scenarioId) => !existing.has(scenarioId));
    if (!missing.length) return;

    await Promise.all(
      missing.map((scenarioId) => {
        const seed = createLegacyScenarioSeed(scenarioId);
        return setDoc(
          doc(db, "scenarios", seed.id),
          {
            ...seed,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      })
    );
  }

  async function loadBiomeUsage() {
    const snap = await getDocs(collection(db, "biomes"));
    const usage: BiomeUsageMap = {};
    snap.forEach((row) => {
      const data = row.data() as Record<string, unknown>;
      const biomeName = String(data.name || row.id);
      const scenarioIds = Array.isArray(data.battleScenarios) ? data.battleScenarios.map(String) : [];
      scenarioIds.forEach((scenarioId) => {
        const key = slugifyScenario(scenarioId);
        if (!key) return;
        usage[key] = [...(usage[key] || []), biomeName];
      });
    });
    setBiomeUsage(usage);
  }

  async function loadScenarios() {
    const snap = await getDocs(collection(db, "scenarios"));
    const merged = new Map<string, ScenarioRecord>();

    LEGACY_SCENARIOS.forEach((scenarioId) => {
      const seed = createLegacyScenarioSeed(scenarioId);
      merged.set(seed.id, seed);
    });

    snap.forEach((row) => {
      const item = normalizeScenarioRecord(row.id, row.data());
      merged.set(item.id, item);
    });

    setItems(Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")));
  }

  async function loadData() {
    setLoading(true);
    try {
      await ensureLegacyScenarioDocs();
      await Promise.all([loadScenarios(), loadBiomeUsage()]);
    } finally {
      setLoading(false);
    }
  }

  function updateForm<K extends keyof ScenarioFormState>(key: K, value: ScenarioFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
    setSelectedFile(null);
    setOriginalPreview("");
    setProcessedPreview("");
    setErrorMsg(null);
  }

  function startEdit(item: ScenarioRecord) {
    setEditingId(item.id);
    setForm({
      scenarioId: item.id,
      name: item.name,
      imageUrl: item.imageUrl || "",
      processedImageUrl: item.processedImageUrl || "",
      isCommercialized: item.isCommercialized,
      ecoinPrice: item.ecoinPrice != null ? String(item.ecoinPrice) : "",
      isSpecial: item.isSpecial,
      specialType: item.specialType || "",
      climateType: item.climateType || "",
      gymElementType: item.gymElementType || "",
      isActive: item.isActive,
      sourceType: item.sourceType,
      legacyScenarioId: item.legacyScenarioId || "",
    });
    setSelectedFile(null);
    setOriginalPreview("");
    setProcessedPreview("");
    setErrorMsg(null);
    setSuccessMsg(null);
  }

  async function handleImagePick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    if (!file) return;

    try {
      setSelectedFile(file);
      const [originalDataUrl, processedDataUrl] = await Promise.all([
        imageFileToStorableDataUrl(file, 1600, 0.84),
        cropImageToAspectDataUrl(file, 1280, 720, 0.88),
      ]);
      setOriginalPreview(originalDataUrl);
      setProcessedPreview(processedDataUrl);
      setErrorMsg(null);
    } catch (error) {
      console.error("[CenarioPage] image pick error", error);
      setErrorMsg("Nao foi possivel processar a imagem do cenario.");
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function uploadScenarioImages(scenarioId: string) {
    if (!selectedFile) {
      const currentProcessed = processedPreview || form.processedImageUrl || form.imageUrl || "";
      return {
        imageUrl: originalPreview || form.imageUrl || "",
        processedImageUrl: currentProcessed,
      };
    }

    const extension = selectedFile.name.includes(".")
      ? selectedFile.name.split(".").pop()?.toLowerCase() || "jpg"
      : "jpg";
    const timestamp = Date.now();
    const originalRef = ref(storage, `scenarios/original/${scenarioId}-${timestamp}.${extension}`);
    await uploadBytes(originalRef, selectedFile, {
      contentType: selectedFile.type || `image/${extension}`,
      cacheControl: "public,max-age=31536000,immutable",
    });
    const imageUrl = await getDownloadURL(originalRef);

    const processedDataUrl = processedPreview || (await cropImageToAspectDataUrl(selectedFile, 1280, 720, 0.88));
    const processedRef = ref(storage, `scenarios/processed/${scenarioId}-${timestamp}.jpg`);
    await uploadBytes(processedRef, dataUrlToBlob(processedDataUrl), {
      contentType: "image/jpeg",
      cacheControl: "public,max-age=31536000,immutable",
    });
    const processedImageUrl = await getDownloadURL(processedRef);

    return { imageUrl, processedImageUrl };
  }

  async function saveScenario() {
    const resolvedId = editingId || slugifyScenario(form.scenarioId || form.name);
    const name = String(form.name || "").trim();
    if (!resolvedId || !name) {
      setErrorMsg("Informe o nome do cenario.");
      return;
    }

    if (form.isCommercialized) {
      const value = Number(form.ecoinPrice || 0);
      if (!Number.isFinite(value) || value <= 0) {
        setErrorMsg("Informe um valor valido em ECoin para o cenario comercializado.");
        return;
      }
    }

    if (form.isSpecial && !form.specialType) {
      setErrorMsg("Selecione o tipo do cenario especial.");
      return;
    }
    if (form.isSpecial && form.specialType === "climate" && !form.climateType) {
      setErrorMsg("Selecione o clima do cenario especial.");
      return;
    }
    if (form.isSpecial && form.specialType === "status" && !form.gymElementType) {
      setErrorMsg("Selecione o tipo principal do GYM para o bonus de status.");
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const uploaded = await uploadScenarioImages(resolvedId);
      const processedUrl = uploaded.processedImageUrl || form.processedImageUrl || form.imageUrl || "";
      const payload = {
        scenarioId: resolvedId,
        name,
        imageUrl: uploaded.imageUrl || form.imageUrl || "",
        processedImageUrl: processedUrl,
        isCommercialized: form.isCommercialized,
        ecoinPrice: form.isCommercialized ? Math.max(0, Math.trunc(Number(form.ecoinPrice || 0))) : null,
        isSpecial: form.isSpecial,
        specialType: form.isSpecial ? form.specialType || null : null,
        climateType: form.isSpecial && form.specialType === "climate" ? form.climateType || null : null,
        gymElementType: form.isSpecial && form.specialType === "status" ? form.gymElementType || null : null,
        isActive: form.isActive,
        sourceType: form.sourceType,
        legacyScenarioId: form.sourceType === "legacy" ? form.legacyScenarioId || resolvedId : null,
        battleAssets: {
          background: processedUrl,
          backgroundDay: processedUrl,
          backgroundNight: processedUrl,
        },
        updatedAt: serverTimestamp(),
        ...(editingId ? {} : { createdAt: serverTimestamp() }),
      };

      await setDoc(doc(db, "scenarios", resolvedId), payload, { merge: true });
      await loadData();
      setSuccessMsg("Cenario salvo com sucesso.");
      resetForm();
    } catch (error) {
      console.error("[CenarioPage] save error", error);
      setErrorMsg("Nao foi possivel salvar o cenario.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(item: ScenarioRecord) {
    await setDoc(
      doc(db, "scenarios", item.id),
      {
        scenarioId: item.id,
        name: item.name,
        isActive: !item.isActive,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    await loadData();
  }

  async function removeScenario(item: ScenarioRecord) {
    const linkedBiomes = biomeUsage[item.id] || [];
    if (linkedBiomes.length > 0) {
      setErrorMsg(`Nao e possivel remover. Cenario vinculado aos biomas: ${linkedBiomes.join(", ")}.`);
      return;
    }
    if (item.sourceType === "legacy") {
      setErrorMsg("Cenarios legados nao devem ser removidos. Use apenas ativar/desativar ou editar.");
      return;
    }
    const confirmed = confirm(`Excluir o cenario "${item.name}"?`);
    if (!confirmed) return;

    await deleteDoc(doc(db, "scenarios", item.id));
    await loadData();
    if (editingId === item.id) resetForm();
  }

  return (
    <RequireAuth>
      <div className="flex min-h-screen bg-slate-950 text-slate-100">
        <Sidebar />
        <main className="flex-1 px-4 py-6">
          <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold tracking-tight md:text-2xl">Cadastro de Cenarios</h1>
              <p className="text-xs text-slate-300 md:text-sm">
                Gerencie cenarios visuais e especiais usados nos GYMs e nas battle scenes.
              </p>
            </div>
            <button
              type="button"
              onClick={resetForm}
              className="rounded-md bg-cyan-300 px-3 py-2 text-xs font-bold uppercase tracking-[0.2em] text-slate-950 hover:bg-cyan-200"
            >
              Novo cenario
            </button>
          </header>

          {(errorMsg || successMsg) && (
            <section className="mb-4 space-y-2">
              {errorMsg ? (
                <div className="rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {errorMsg}
                </div>
              ) : null}
              {successMsg ? (
                <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                  {successMsg}
                </div>
              ) : null}
            </section>
          )}

          <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
            <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
              <h2 className="text-sm font-semibold text-slate-100">
                {editingId ? "Editar cenario" : "Novo cenario"}
              </h2>

              <div className="mt-4 space-y-4">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-3">
                  <div className="aspect-video overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
                    {previewUrl ? (
                      <img src={previewUrl} alt={form.name || "Preview do cenario"} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs uppercase tracking-[0.24em] text-slate-500">
                        Preview battle scene
                      </div>
                    )}
                  </div>
                  <p className="mt-2 text-[11px] text-slate-400">
                    A imagem processada usa corte 16:9 para encaixar no padrao das batalhas.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                    Nome do cenario
                  </label>
                  <input
                    value={form.name}
                    onChange={(event) => updateForm("name", event.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60"
                    placeholder="Ex: Arena Vulcanica"
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                    Scenario ID
                  </label>
                  <input
                    value={form.scenarioId}
                    onChange={(event) => updateForm("scenarioId", event.target.value)}
                    disabled={Boolean(editingId)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60 disabled:opacity-50"
                    placeholder="Opcional. Se vazio, sera gerado pelo nome."
                  />
                </div>

                <div className="space-y-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleImagePick}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full rounded-xl border border-dashed border-cyan-300/40 bg-cyan-400/10 px-3 py-3 text-sm font-bold text-cyan-200 hover:bg-cyan-400/15"
                  >
                    {selectedFile ? "Trocar imagem do cenario" : "Adicionar imagem do cenario"}
                  </button>
                  {(form.imageUrl || selectedFile) && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedFile(null);
                        setOriginalPreview("");
                        setProcessedPreview("");
                        updateForm("imageUrl", "");
                        updateForm("processedImageUrl", "");
                      }}
                      className="w-full rounded-xl border border-red-400/25 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-200 hover:bg-red-500/15"
                    >
                      Remover imagem
                    </button>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-white">Comercializar</p>
                      <p className="text-xs text-slate-400">Use ECoin para cenarios vendidos no jogo.</p>
                    </div>
                    <Toggle checked={form.isCommercialized} onChange={(value) => updateForm("isCommercialized", value)} />
                  </div>
                  {form.isCommercialized && (
                    <div className="mt-4">
                      <label className="block text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                        Valor em ECoin
                      </label>
                      <input
                        value={form.ecoinPrice}
                        onChange={(event) => updateForm("ecoinPrice", event.target.value)}
                        className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60"
                        inputMode="numeric"
                        placeholder="Ex: 250"
                      />
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-white">Cenario especial</p>
                      <p className="text-xs text-slate-400">Clima permanente ou bonus de dano por tipo do GYM.</p>
                    </div>
                    <Toggle checked={form.isSpecial} onChange={(value) => updateForm("isSpecial", value)} />
                  </div>

                  {form.isSpecial && (
                    <div className="mt-4 space-y-4">
                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                          Tipo especial
                        </label>
                        <select
                          value={form.specialType}
                          onChange={(event) => updateForm("specialType", event.target.value as ScenarioSpecialType | "")}
                          className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60"
                        >
                          <option value="">Selecione</option>
                          {SCENARIO_SPECIAL_TYPE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      {form.specialType === "climate" && (
                        <div>
                          <label className="block text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                            Clima
                          </label>
                          <select
                            value={form.climateType}
                            onChange={(event) => updateForm("climateType", event.target.value as ScenarioClimateType | "")}
                            className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60"
                          >
                            <option value="">Selecione</option>
                            {SCENARIO_CLIMATE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {form.specialType === "status" && (
                        <div>
                          <label className="block text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                            Tipo principal do GYM
                          </label>
                          <select
                            value={form.gymElementType}
                            onChange={(event) => updateForm("gymElementType", event.target.value as GymElementType | "")}
                            className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60"
                          >
                            <option value="">Selecione</option>
                            {GYM_ELEMENT_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-white">Cenario ativo</p>
                      <p className="text-xs text-slate-400">Cenarios inativos saem do fluxo novo sem perder historico.</p>
                    </div>
                    <Toggle checked={form.isActive} onChange={(value) => updateForm("isActive", value)} />
                  </div>
                </div>

                {linkedBiomeNames.length ? (
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
                    <p className="text-sm font-semibold text-white">Biomas relacionados</p>
                    <p className="mt-2 text-xs text-slate-400">{linkedBiomeNames.join(", ")}</p>
                  </div>
                ) : null}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void saveScenario()}
                    disabled={saving}
                    className="flex-1 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-black uppercase tracking-[0.18em] text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
                  >
                    {saving ? "Salvando..." : editingId ? "Salvar cenario" : "Criar cenario"}
                  </button>
                  {editingId ? (
                    <button
                      type="button"
                      onClick={resetForm}
                      className="rounded-xl border border-slate-700 px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-slate-800"
                    >
                      Cancelar
                    </button>
                  ) : null}
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-100">Cenarios cadastrados</h2>
                  <p className="text-xs text-slate-400">Total: {items.length}</p>
                </div>
              </div>

              {loading ? (
                <p className="mt-4 text-sm text-slate-300">Carregando cenarios...</p>
              ) : (
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {items.map((item) => {
                    const linkedBiomes = biomeUsage[item.id] || [];
                    const image = item.processedImageUrl || item.imageUrl || "";
                    return (
                      <article key={item.id} className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/70">
                        <div className="aspect-video bg-slate-900">
                          {image ? (
                            <img src={image} alt={item.name} className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full items-center justify-center text-xs uppercase tracking-[0.24em] text-slate-500">
                              {item.sourceType === "legacy" ? "Legacy" : "Sem imagem"}
                            </div>
                          )}
                        </div>
                        <div className="space-y-3 p-4">
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">{item.id}</p>
                            <h3 className="mt-1 text-lg font-black text-white">{item.name}</h3>
                          </div>

                          <div className="grid gap-2 text-xs text-slate-300">
                            <p>Comercializado: {item.isCommercialized ? "Sim" : "Nao"}</p>
                            <p>ECoin: {item.ecoinPrice != null ? item.ecoinPrice : "-"}</p>
                            <p>Especial: {item.isSpecial ? "Sim" : "Nao"}</p>
                            <p>Tipo especial: {item.specialType || "-"}</p>
                            <p>Clima: {item.climateType || "-"}</p>
                            <p>Tipo GYM: {item.gymElementType || "-"}</p>
                            <p>Status: {item.isActive ? "Ativo" : "Inativo"}</p>
                            <p>Biomas: {linkedBiomes.length ? linkedBiomes.join(", ") : "Nao associado"}</p>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => startEdit(item)}
                              className="rounded-lg border border-cyan-300/30 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/15"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => void toggleActive(item)}
                              className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/15"
                            >
                              {item.isActive ? "Desativar" : "Ativar"}
                            </button>
                            <button
                              type="button"
                              onClick={() => void removeScenario(item)}
                              className="rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200 hover:bg-red-500/15"
                            >
                              Remover
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </main>
      </div>
    </RequireAuth>
  );
}
