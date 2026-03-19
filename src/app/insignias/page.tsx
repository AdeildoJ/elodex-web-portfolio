"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { collection, deleteDoc, doc, getDocs, serverTimestamp, setDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";

import RequireAuth from "@/components/RequireAuth";
import Sidebar from "@/components/Sidebar";
import { db, storage } from "@/lib/firebase";
import {
  BADGE_BONUS_OPTIONS,
  type BadgeBonusType,
  type BadgeRecord,
  normalizeBadgeRecord,
  slugifyBadge,
} from "@/lib/badgeCatalog";

type BadgeFormState = {
  badgeId: string;
  name: string;
  imageUrl: string;
  description: string;
  bonusType: BadgeBonusType;
  bonusValue: string;
  isActive: boolean;
};

const emptyForm: BadgeFormState = {
  badgeId: "",
  name: "",
  imageUrl: "",
  description: "",
  bonusType: "xp",
  bonusValue: "",
  isActive: true,
};

type GymUsageMap = Record<string, string[]>;

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-14 items-center rounded-full border transition ${
        checked ? "border-emerald-400/60 bg-emerald-500/30" : "border-slate-700 bg-slate-800"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${
          checked ? "translate-x-8" : "translate-x-1"
        }`}
      />
    </button>
  );
}

export default function InsigniasPage() {
  const [items, setItems] = useState<BadgeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<BadgeFormState>(emptyForm);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [gymUsage, setGymUsage] = useState<GymUsageMap>({});

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const linkedGyms = useMemo(() => {
    if (!editingId) return [];
    return gymUsage[editingId] || [];
  }, [editingId, gymUsage]);

  useEffect(() => {
    void loadData();
  }, []);

  async function loadUsage() {
    const snap = await getDocs(collection(db, "gyms"));
    const usage: GymUsageMap = {};
    snap.forEach((row) => {
      const data = row.data() as Record<string, unknown>;
      const badgeId = slugifyBadge(String(data.primaryBadgeId || ""));
      if (!badgeId) return;
      usage[badgeId] = [...(usage[badgeId] || []), String(data.name || row.id)];
    });
    setGymUsage(usage);
  }

  async function loadBadges() {
    const snap = await getDocs(collection(db, "badges"));
    const rows = snap.docs
      .map((row) => normalizeBadgeRecord(row.id, row.data()))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    setItems(rows);
  }

  async function loadData() {
    setLoading(true);
    try {
      await Promise.all([loadBadges(), loadUsage()]);
    } catch (error) {
      console.error("[InsigniasPage] load error", error);
      setErrorMsg("Nao foi possivel carregar o cadastro de insignias.");
    } finally {
      setLoading(false);
    }
  }

  function updateForm<K extends keyof BadgeFormState>(key: K, value: BadgeFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
    setSelectedFile(null);
    setPreviewUrl("");
    setErrorMsg(null);
  }

  function startEdit(item: BadgeRecord) {
    setEditingId(item.id);
    setForm({
      badgeId: item.id,
      name: item.name,
      imageUrl: item.imageUrl || "",
      description: item.description || "",
      bonusType: item.bonusType,
      bonusValue: String(item.bonusValue ?? ""),
      isActive: item.isActive,
    });
    setSelectedFile(null);
    setPreviewUrl(item.imageUrl || "");
    setErrorMsg(null);
    setSuccessMsg(null);
  }

  function handleImagePick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    if (!file) return;
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function uploadBadgeImage(badgeId: string) {
    if (!selectedFile) return form.imageUrl || "";
    const extension = selectedFile.name.includes(".")
      ? selectedFile.name.split(".").pop()?.toLowerCase() || "png"
      : "png";
    const timestamp = Date.now();
    const imageRef = ref(storage, `badges/${badgeId}-${timestamp}.${extension}`);
    await uploadBytes(imageRef, selectedFile, {
      contentType: selectedFile.type || `image/${extension}`,
      cacheControl: "public,max-age=31536000,immutable",
    });
    return getDownloadURL(imageRef);
  }

  async function handleSubmit() {
    const resolvedId = editingId || slugifyBadge(form.badgeId || form.name);
    const bonusValue = Number(form.bonusValue);
    if (!resolvedId) {
      setErrorMsg("Informe o nome da insignia.");
      return;
    }
    if (!form.name.trim()) {
      setErrorMsg("Informe o nome da insignia.");
      return;
    }
    if (!form.description.trim()) {
      setErrorMsg("Informe a descricao da insignia.");
      return;
    }
    if (!Number.isFinite(bonusValue) || bonusValue <= 0) {
      setErrorMsg("Informe um valor valido para o bonus.");
      return;
    }

    try {
      setSaving(true);
      setErrorMsg(null);
      setSuccessMsg(null);
      const imageUrl = await uploadBadgeImage(resolvedId);
      const payload: Record<string, unknown> = {
        badgeId: resolvedId,
        name: form.name.trim(),
        imageUrl,
        description: form.description.trim(),
        bonusType: form.bonusType,
        bonusValue,
        isActive: form.isActive,
        updatedAt: serverTimestamp(),
      };
      if (!editingId) {
        payload.createdAt = serverTimestamp();
      }
      await setDoc(
        doc(db, "badges", resolvedId),
        payload,
        { merge: true }
      );
      setSuccessMsg(editingId ? "Insignia atualizada com sucesso." : "Insignia criada com sucesso.");
      resetForm();
      await Promise.all([loadBadges(), loadUsage()]);
    } catch (error) {
      console.error("[InsigniasPage] save error", error);
      setErrorMsg("Nao foi possivel salvar a insignia.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(item: BadgeRecord, nextValue: boolean) {
    try {
      await setDoc(
        doc(db, "badges", item.id),
        {
          isActive: nextValue,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      await loadBadges();
    } catch (error) {
      console.error("[InsigniasPage] toggle error", error);
      setErrorMsg("Nao foi possivel atualizar o status da insignia.");
    }
  }

  async function handleRemove(item: BadgeRecord) {
    if ((gymUsage[item.id] || []).length > 0) {
      setErrorMsg("Essa insignia esta vinculada a um GYM e nao pode ser removida agora.");
      return;
    }
    try {
      await deleteDoc(doc(db, "badges", item.id));
      if (editingId === item.id) {
        resetForm();
      }
      await loadBadges();
      setSuccessMsg("Insignia removida.");
    } catch (error) {
      console.error("[InsigniasPage] remove error", error);
      setErrorMsg("Nao foi possivel remover a insignia.");
    }
  }

  const currentBonusHelper =
    BADGE_BONUS_OPTIONS.find((item) => item.value === form.bonusType)?.helper || BADGE_BONUS_OPTIONS[0].helper;

  return (
    <RequireAuth>
      <div className="flex min-h-screen bg-slate-950 text-white">
        <Sidebar />

        <main className="flex-1 overflow-x-hidden">
          <section className="relative isolate px-6 py-8 md:px-10 md:py-10">
            <div className="absolute inset-x-0 top-0 -z-10 h-72 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.22),_transparent_42%),radial-gradient(circle_at_top_right,_rgba(34,197,94,0.18),_transparent_38%)]" />

            <div className="mx-auto grid max-w-7xl gap-6 xl:grid-cols-[420px,minmax(0,1fr)]">
              <div className="rounded-[28px] border border-white/10 bg-slate-900/80 p-6 shadow-2xl shadow-cyan-950/20 backdrop-blur">
                <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300">Cadastro</p>
                <h1 className="mt-3 text-3xl font-black tracking-tight text-white">Insignias</h1>
                <p className="mt-3 text-sm leading-6 text-slate-300">
                  Cada insignia tem um bonus principal. O jogo fica protegido contra acúmulo quebrado aplicando
                  somente o maior bonus ativo por categoria.
                </p>

                {errorMsg ? (
                  <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-950/30 px-4 py-3 text-sm text-red-100">
                    {errorMsg}
                  </div>
                ) : null}
                {successMsg ? (
                  <div className="mt-4 rounded-2xl border border-emerald-500/30 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-100">
                    {successMsg}
                  </div>
                ) : null}

                <div className="mt-6 space-y-4">
                  <label className="block text-sm text-slate-200">
                    Nome da insignia
                    <input
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/50"
                      value={form.name}
                      onChange={(event) => updateForm("name", event.target.value)}
                      placeholder="Ex.: Insignia da Mare"
                    />
                  </label>

                  <label className="block text-sm text-slate-200">
                    ID da insignia
                    <input
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/50"
                      value={form.badgeId}
                      onChange={(event) => updateForm("badgeId", event.target.value)}
                      placeholder="Gerado automaticamente se vazio"
                    />
                  </label>

                  <label className="block text-sm text-slate-200">
                    Descricao
                    <textarea
                      className="mt-2 min-h-28 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/50"
                      value={form.description}
                      onChange={(event) => updateForm("description", event.target.value)}
                      placeholder="Explique o efeito principal dessa insignia."
                    />
                  </label>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="block text-sm text-slate-200">
                      Tipo de bonus
                      <select
                        className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/50"
                        value={form.bonusType}
                        onChange={(event) => updateForm("bonusType", event.target.value as BadgeBonusType)}
                      >
                        {BADGE_BONUS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block text-sm text-slate-200">
                      Valor do bonus
                      <input
                        type="number"
                        min="1"
                        step="1"
                        className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/50"
                        value={form.bonusValue}
                        onChange={(event) => updateForm("bonusValue", event.target.value)}
                        placeholder="Ex.: 5"
                      />
                    </label>
                  </div>

                  <p className="rounded-2xl border border-cyan-400/20 bg-cyan-950/20 px-4 py-3 text-xs leading-5 text-cyan-100">
                    {currentBonusHelper}
                  </p>

                  <div className="rounded-[24px] border border-white/10 bg-slate-950/60 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">Insignia ativa</p>
                        <p className="mt-1 text-xs text-slate-400">Somente insignias ativas podem ser vinculadas a novos GYMs.</p>
                      </div>
                      <Toggle checked={form.isActive} onChange={(value) => updateForm("isActive", value)} />
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-white/10 bg-slate-950/60 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">Icone</p>
                        <p className="mt-1 text-xs text-slate-400">Envie a imagem principal da insignia.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="rounded-2xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300/60 hover:bg-cyan-500/20"
                      >
                        Upload
                      </button>
                    </div>
                    <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImagePick} />
                    {previewUrl ? (
                      <div className="mt-4 overflow-hidden rounded-3xl border border-white/10 bg-slate-900/70 p-4">
                        <div className="relative h-40 w-full overflow-hidden rounded-2xl bg-slate-950">
                          <Image src={previewUrl} alt={form.name || "Preview"} fill className="object-contain" unoptimized />
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {linkedGyms.length > 0 ? (
                    <div className="rounded-2xl border border-amber-400/20 bg-amber-950/20 px-4 py-3 text-xs leading-5 text-amber-100">
                      Vinculada aos GYMs: {linkedGyms.join(", ")}
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={handleSubmit}
                      disabled={saving}
                      className="rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {saving ? "Salvando..." : editingId ? "Salvar alteracoes" : "Criar insignia"}
                    </button>
                    <button
                      type="button"
                      onClick={resetForm}
                      className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                    >
                      Limpar
                    </button>
                  </div>
                </div>
              </div>

              <div className="rounded-[28px] border border-white/10 bg-slate-900/70 p-6 shadow-2xl shadow-black/20 backdrop-blur">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300">Listagem</p>
                    <h2 className="mt-2 text-2xl font-black text-white">Insignias cadastradas</h2>
                  </div>
                  <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-300">
                    {items.length} total
                  </div>
                </div>

                {loading ? (
                  <div className="mt-6 rounded-3xl border border-white/10 bg-slate-950/70 px-4 py-10 text-center text-sm text-slate-400">
                    Carregando insignias...
                  </div>
                ) : items.length === 0 ? (
                  <div className="mt-6 rounded-3xl border border-white/10 bg-slate-950/70 px-4 py-10 text-center text-sm text-slate-400">
                    Nenhuma insignia cadastrada ainda.
                  </div>
                ) : (
                  <div className="mt-6 grid gap-4 md:grid-cols-2">
                    {items.map((item) => {
                      const linked = gymUsage[item.id] || [];
                      return (
                        <article key={item.id} className="rounded-[26px] border border-white/10 bg-slate-950/70 p-4">
                          <div className="flex gap-4">
                            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-slate-900">
                              {item.imageUrl ? (
                                <Image src={item.imageUrl} alt={item.name} fill className="object-contain" unoptimized />
                              ) : null}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <h3 className="text-lg font-black text-white">{item.name}</h3>
                                  <p className="mt-1 text-xs uppercase tracking-[0.28em] text-cyan-300">{item.bonusType}</p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleToggle(item, !item.isActive)}
                                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                    item.isActive
                                      ? "border border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                                      : "border border-slate-700 bg-slate-800 text-slate-300"
                                  }`}
                                >
                                  {item.isActive ? "Ativa" : "Inativa"}
                                </button>
                              </div>
                              <p className="mt-3 text-sm leading-6 text-slate-300">{item.description}</p>
                              <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200">
                                Bonus: {item.bonusValue}%
                              </div>
                              {linked.length > 0 ? (
                                <p className="mt-3 text-xs text-amber-200">GYMs vinculados: {linked.join(", ")}</p>
                              ) : (
                                <p className="mt-3 text-xs text-slate-500">Sem vinculos com GYMs.</p>
                              )}
                            </div>
                          </div>

                          <div className="mt-4 flex flex-wrap gap-3">
                            <button
                              type="button"
                              onClick={() => startEdit(item)}
                              className="rounded-2xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300/60 hover:bg-cyan-500/20"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemove(item)}
                              className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-100 transition hover:bg-red-500/20"
                            >
                              Remover
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </section>
        </main>
      </div>
    </RequireAuth>
  );
}
