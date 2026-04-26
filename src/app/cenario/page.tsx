"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import { collection, deleteDoc, doc, getDocs, serverTimestamp, setDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";

import RequireAuth from "@/components/RequireAuth";
import Sidebar from "@/components/Sidebar";
import { db, storage } from "@/lib/firebase";
import { cropImageToAspectDataUrl, dataUrlToBlob, imageFileToStorableDataUrl } from "@/lib/imageProcessing";
import {
  GYM_ELEMENT_OPTIONS,
  SCENARIO_SPECIAL_TYPE_OPTIONS,
  SCENARIO_WEATHER_OPTIONS,
  type GymElementType,
  type ScenarioRecord,
  type ScenarioSpecialType,
  type ScenarioWeather,
  normalizeScenarioRecord,
  slugifyScenario,
} from "@/lib/scenarioCatalog";

type ScenarioFormState = {
  scenarioId: string;
  name: string;
  isPaid: boolean;
  priceEcoin: string;
  isSpecial: boolean;
  specialType: ScenarioSpecialType | "";
  weather: ScenarioWeather;
  gymType: GymElementType | "";
  isActive: boolean;
};

const emptyForm: ScenarioFormState = {
  scenarioId: "",
  name: "",
  isPaid: false,
  priceEcoin: "",
  isSpecial: false,
  specialType: "",
  weather: "clear",
  gymType: "",
  isActive: true,
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
  const [selectedFileDay, setSelectedFileDay] = useState<File | null>(null);
  const [selectedFileNight, setSelectedFileNight] = useState<File | null>(null);
  const [previewDay, setPreviewDay] = useState("");
  const [previewNight, setPreviewNight] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fileInputDayRef = useRef<HTMLInputElement | null>(null);
  const fileInputNightRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void loadScenarios();
  }, []);

  async function loadScenarios() {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, "scenarios"));
      const list = snap.docs.map((row) => normalizeScenarioRecord(row.id, row.data()));
      setItems(list.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")));
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
    setSelectedFileDay(null);
    setSelectedFileNight(null);
    setPreviewDay("");
    setPreviewNight("");
    setErrorMsg(null);
  }

  function startEdit(item: ScenarioRecord) {
    setEditingId(item.id);
    setForm({
      scenarioId: item.id,
      name: item.name,
      isPaid: item.isPaid,
      priceEcoin: item.priceEcoin != null ? String(item.priceEcoin) : "",
      isSpecial: item.isSpecial,
      specialType: item.specialType || "",
      weather: item.weather,
      gymType: item.gymType || "",
      isActive: item.isActive,
    });
    setSelectedFileDay(null);
    setSelectedFileNight(null);
    setPreviewDay("");
    setPreviewNight("");
    setErrorMsg(null);
    setSuccessMsg(null);
  }

  async function handleImagePick(period: "day" | "night", event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    if (!file) return;
    try {
      if (period === "day") {
        setSelectedFileDay(file);
        const [original, processed] = await Promise.all([
          imageFileToStorableDataUrl(file, 1600, 0.84),
          cropImageToAspectDataUrl(file, 1280, 720, 0.88),
        ]);
        setPreviewDay(processed || original);
      } else {
        setSelectedFileNight(file);
        const [original, processed] = await Promise.all([
          imageFileToStorableDataUrl(file, 1600, 0.84),
          cropImageToAspectDataUrl(file, 1280, 720, 0.88),
        ]);
        setPreviewNight(processed || original);
      }
      setErrorMsg(null);
    } catch (error) {
      console.error("[CenarioPage] image pick error", error);
      setErrorMsg("Nao foi possivel processar a imagem.");
    } finally {
      const ref = period === "day" ? fileInputDayRef : fileInputNightRef;
      if (ref.current) ref.current.value = "";
    }
  }

  async function uploadImages(scenarioId: string) {
    const existing = editingId ? items.find((i) => i.id === editingId) : null;
    const result = {
      imageDay: existing?.imageDay || "",
      imageNight: existing?.imageNight || "",
      processedImageDay: existing?.processedImageDay || "",
      processedImageNight: existing?.processedImageNight || "",
    };

    const ts = Date.now();
    const ext = (f: File) => (f.name.includes(".") ? f.name.split(".").pop()?.toLowerCase() || "jpg" : "jpg");

    if (selectedFileDay) {
      const refDay = ref(storage, `scenarios/${scenarioId}-day-${ts}.${ext(selectedFileDay)}`);
      await uploadBytes(refDay, selectedFileDay, {
        contentType: selectedFileDay.type || `image/${ext(selectedFileDay)}`,
        cacheControl: "public,max-age=31536000,immutable",
      });
      result.imageDay = await getDownloadURL(refDay);
      const procDay = previewDay || (await cropImageToAspectDataUrl(selectedFileDay, 1280, 720, 0.88));
      const procRefDay = ref(storage, `scenarios/${scenarioId}-day-processed-${ts}.jpg`);
      await uploadBytes(procRefDay, dataUrlToBlob(procDay), {
        contentType: "image/jpeg",
        cacheControl: "public,max-age=31536000,immutable",
      });
      result.processedImageDay = await getDownloadURL(procRefDay);
    }

    if (selectedFileNight) {
      const refNight = ref(storage, `scenarios/${scenarioId}-night-${ts}.${ext(selectedFileNight)}`);
      await uploadBytes(refNight, selectedFileNight, {
        contentType: selectedFileNight.type || `image/${ext(selectedFileNight)}`,
        cacheControl: "public,max-age=31536000,immutable",
      });
      result.imageNight = await getDownloadURL(refNight);
      const procNight = previewNight || (await cropImageToAspectDataUrl(selectedFileNight, 1280, 720, 0.88));
      const procRefNight = ref(storage, `scenarios/${scenarioId}-night-processed-${ts}.jpg`);
      await uploadBytes(procRefNight, dataUrlToBlob(procNight), {
        contentType: "image/jpeg",
        cacheControl: "public,max-age=31536000,immutable",
      });
      result.processedImageNight = await getDownloadURL(procRefNight);
    }

    return result;
  }

  async function saveScenario() {
    const resolvedId = editingId || slugifyScenario(form.scenarioId || form.name);
    const name = String(form.name || "").trim();
    if (!resolvedId || !name) {
      setErrorMsg("Informe o nome do cenario.");
      return;
    }
    if (form.isPaid) {
      const value = Number(form.priceEcoin || 0);
      if (!Number.isFinite(value) || value <= 0) {
        setErrorMsg("Informe um valor valido em ECoin para cenario pago.");
        return;
      }
    }
    if (form.isSpecial && !form.specialType) {
      setErrorMsg("Selecione o tipo do cenario especial.");
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const images = await uploadImages(resolvedId);
      const payload = {
        scenarioId: resolvedId,
        name,
        isPaid: form.isPaid,
        priceEcoin: form.isPaid ? Math.max(0, Math.trunc(Number(form.priceEcoin || 0))) : null,
        isSpecial: form.isSpecial,
        specialType: form.isSpecial ? (form.specialType || null) : null,
        weather: form.weather || "clear",
        gymType: form.gymType || null,
        imageDay: images.imageDay,
        imageNight: images.imageNight,
        processedImageDay: images.processedImageDay || images.imageDay,
        processedImageNight: images.processedImageNight || images.imageNight,
        isActive: form.isActive,
        updatedAt: serverTimestamp(),
        ...(editingId ? {} : { createdAt: serverTimestamp() }),
      };

      await setDoc(doc(db, "scenarios", resolvedId), payload, { merge: true });
      await loadScenarios();
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
    await loadScenarios();
  }

  async function removeScenario(item: ScenarioRecord) {
    if (!confirm(`Excluir o cenario "${item.name}"?`)) return;
    await deleteDoc(doc(db, "scenarios", item.id));
    await loadScenarios();
    if (editingId === item.id) resetForm();
  }

  const previewDayUrl = previewDay || (editingId && items.find((i) => i.id === editingId)?.processedImageDay) || "";
  const previewNightUrl = previewNight || (editingId && items.find((i) => i.id === editingId)?.processedImageNight) || "";

  return (
    <RequireAuth>
      <div className="flex min-h-screen bg-slate-950 text-slate-100">
        <Sidebar />
        <main className="flex-1 px-4 py-6">
          <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold tracking-tight md:text-2xl">Cadastro de Cenarios</h1>
              <p className="text-xs text-slate-300 md:text-sm">
                Cenarios usados nos GYMs. Clima influencia batalha; gymType da bonus de dano.
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
                <div className="rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{errorMsg}</div>
              ) : null}
              {successMsg ? (
                <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{successMsg}</div>
              ) : null}
            </section>
          )}

          <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
            <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
              <h2 className="text-sm font-semibold text-slate-100">{editingId ? "Editar cenario" : "Novo cenario"}</h2>

              <div className="mt-4 space-y-4">
                <div className="space-y-2">
                  <label className="block text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Nome</label>
                  <input
                    value={form.name}
                    onChange={(e) => updateForm("name", e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60"
                    placeholder="Ex: Arena Vulcanica"
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Scenario ID</label>
                  <input
                    value={form.scenarioId}
                    onChange={(e) => updateForm("scenarioId", e.target.value)}
                    disabled={Boolean(editingId)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60 disabled:opacity-50"
                    placeholder="Opcional. Gerado pelo nome se vazio."
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Imagem dia</label>
                    <input ref={fileInputDayRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleImagePick("day", e)} />
                    <button
                      type="button"
                      onClick={() => fileInputDayRef.current?.click()}
                      className="mt-2 w-full rounded-xl border border-dashed border-cyan-300/40 bg-cyan-400/10 px-3 py-3 text-sm font-bold text-cyan-200 hover:bg-cyan-400/15"
                    >
                      {selectedFileDay ? "Trocar" : "Dia"}
                    </button>
                    {previewDayUrl ? (
                      <div className="mt-2 aspect-video overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
                        <img src={previewDayUrl} alt="Dia" className="h-full w-full object-cover" />
                      </div>
                    ) : null}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Imagem noite</label>
                    <input ref={fileInputNightRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleImagePick("night", e)} />
                    <button
                      type="button"
                      onClick={() => fileInputNightRef.current?.click()}
                      className="mt-2 w-full rounded-xl border border-dashed border-cyan-300/40 bg-cyan-400/10 px-3 py-3 text-sm font-bold text-cyan-200 hover:bg-cyan-400/15"
                    >
                      {selectedFileNight ? "Trocar" : "Noite"}
                    </button>
                    {previewNightUrl ? (
                      <div className="mt-2 aspect-video overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
                        <img src={previewNightUrl} alt="Noite" className="h-full w-full object-cover" />
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-white">Pago (ECoin)</p>
                      <p className="text-xs text-slate-400">Cenario vendido na EloMart.</p>
                    </div>
                    <Toggle checked={form.isPaid} onChange={(v) => updateForm("isPaid", v)} />
                  </div>
                  {form.isPaid && (
                    <div className="mt-4">
                      <label className="block text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Preco ECoin</label>
                      <input
                        value={form.priceEcoin}
                        onChange={(e) => updateForm("priceEcoin", e.target.value)}
                        className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60"
                        inputMode="numeric"
                        placeholder="Ex: 250"
                      />
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Clima</label>
                  <select
                    value={form.weather}
                    onChange={(e) => updateForm("weather", e.target.value as ScenarioWeather)}
                    className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60"
                  >
                    {SCENARIO_WEATHER_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Tipo GYM</label>
                  <select
                    value={form.gymType}
                    onChange={(e) => updateForm("gymType", e.target.value as GymElementType | "")}
                    className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60"
                  >
                    <option value="">Nenhum</option>
                    {GYM_ELEMENT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-400">Movimentos do tipo ganham bonus de dano.</p>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-white">Cenario especial</p>
                      <p className="text-xs text-slate-400">Clima permanente ou bonus de dano por tipo.</p>
                    </div>
                    <Toggle checked={form.isSpecial} onChange={(v) => updateForm("isSpecial", v)} />
                  </div>
                  {form.isSpecial && (
                    <div className="mt-4">
                      <label className="block text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Tipo especial</label>
                      <select
                        value={form.specialType}
                        onChange={(e) => updateForm("specialType", e.target.value as ScenarioSpecialType | "")}
                        className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/60"
                      >
                        <option value="">Selecione</option>
                        {SCENARIO_SPECIAL_TYPE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-white">Ativo</p>
                    </div>
                    <Toggle checked={form.isActive} onChange={(v) => updateForm("isActive", v)} />
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void saveScenario()}
                    disabled={saving}
                    className="flex-1 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-black uppercase tracking-[0.18em] text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
                  >
                    {saving ? "Salvando..." : editingId ? "Salvar" : "Criar"}
                  </button>
                  {editingId ? (
                    <button type="button" onClick={resetForm} className="rounded-xl border border-slate-700 px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-slate-800">
                      Cancelar
                    </button>
                  ) : null}
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
              <h2 className="text-sm font-semibold text-slate-100">Cenarios cadastrados</h2>
              <p className="text-xs text-slate-400">Total: {items.length}</p>

              {loading ? (
                <p className="mt-4 text-sm text-slate-300">Carregando...</p>
              ) : (
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {items.map((item) => {
                    const img = item.processedImageDay || item.imageDay || item.processedImageNight || item.imageNight || "";
                    return (
                      <article key={item.id} className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/70">
                        <div className="aspect-video bg-slate-900">
                          {img ? (
                            <img src={img} alt={item.name} className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full items-center justify-center text-xs uppercase tracking-[0.24em] text-slate-500">Sem imagem</div>
                          )}
                        </div>
                        <div className="space-y-3 p-4">
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">{item.id}</p>
                            <h3 className="mt-1 text-lg font-black text-white">{item.name}</h3>
                          </div>
                          <div className="grid gap-2 text-xs text-slate-300">
                            <p>Pago: {item.isPaid ? `Sim (${item.priceEcoin ?? "-"} ECoin)` : "Nao"}</p>
                            <p>Clima: {item.weather}</p>
                            <p>Tipo GYM: {item.gymType || "-"}</p>
                            <p>Status: {item.isActive ? "Ativo" : "Inativo"}</p>
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
