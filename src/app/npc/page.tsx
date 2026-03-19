"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";

import RequireAuth from "@/components/RequireAuth";
import Sidebar from "@/components/Sidebar";
import { db, storage } from "@/lib/firebase";

type NpcRole = "enfermeiro" | "policial" | "criador" | "especialista" | "remember" | "ladrao";

type NpcRecord = {
  id: string;
  nome: string;
  role: NpcRole;
  imageUrl: string;
  appearanceRate: number | null;
  isCommercialized: boolean;
  ecoinPrice: number | null;
  rpgTeam: NpcTeamMember[];
  createdAt?: unknown;
  updatedAt?: unknown;
};

type CatalogSpeciesOption = {
  id: number;
  label: string;
};

type CatalogMoveOption = {
  id: string;
  label: string;
};

type NpcTeamMove = {
  id: string;
  label: string;
};

type NpcTeamMember = {
  slotId: string;
  speciesId: number | null;
  speciesLabel: string;
  level: string;
  moves: NpcTeamMove[];
  pokemonSearch: string;
  moveSearch: string;
};

type NpcFormState = {
  nome: string;
  role: NpcRole;
  imageUrl: string;
  appearanceRate: string;
  isCommercialized: boolean;
  ecoinPrice: string;
  rpgTeam: NpcTeamMember[];
};

const ROLE_OPTIONS: Array<{ value: NpcRole; label: string }> = [
  { value: "enfermeiro", label: "Enfermeiro" },
  { value: "policial", label: "Policial" },
  { value: "criador", label: "Criador" },
  { value: "especialista", label: "Especialista" },
  { value: "remember", label: "Remember" },
  { value: "ladrao", label: "Ladrao" },
];

const emptyForm: NpcFormState = {
  nome: "",
  role: "enfermeiro",
  imageUrl: "",
  appearanceRate: "",
  isCommercialized: false,
  ecoinPrice: "",
  rpgTeam: [],
};

function createEmptyTeamMember(index = 1): NpcTeamMember {
  return {
    slotId: `slot-${Date.now()}-${index}`,
    speciesId: null,
    speciesLabel: "",
    level: "1",
    moves: [],
    pokemonSearch: "",
    moveSearch: "",
  };
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .trim();
}

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
        checked
          ? "border-emerald-400/60 bg-emerald-500/30"
          : "border-slate-700 bg-slate-800"
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

export default function NpcPage() {
  const [npcs, setNpcs] = useState<NpcRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<NpcFormState>(emptyForm);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [speciesOptions, setSpeciesOptions] = useState<CatalogSpeciesOption[]>([]);
  const [moveOptions, setMoveOptions] = useState<CatalogMoveOption[]>([]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const shouldShowAppearanceRate = form.role === "ladrao" || form.role === "policial";
  const shouldShowPoliceTeam = form.role === "policial";

  const formPreviewTitle = useMemo(() => {
    const roleLabel = ROLE_OPTIONS.find((item) => item.value === form.role)?.label ?? "NPC";
    return form.nome.trim() || roleLabel;
  }, [form.nome, form.role]);

  useEffect(() => {
    void loadNpcs();
    void loadCatalogOptions();
  }, []);

  async function loadCatalogOptions() {
    try {
      const response = await fetch("/api/catalog/options", { cache: "no-store" });
      if (!response.ok) throw new Error(`catalog-options-http-${response.status}`);
      const data = (await response.json()) as {
        species?: CatalogSpeciesOption[];
        moves?: CatalogMoveOption[];
      };
      setSpeciesOptions(Array.isArray(data.species) ? data.species : []);
      setMoveOptions(Array.isArray(data.moves) ? data.moves : []);
    } catch (error) {
      console.error("[NpcPage] catalog load error", error);
      setSpeciesOptions([]);
      setMoveOptions([]);
    }
  }

  async function loadNpcs() {
    setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, "npcs"), orderBy("nome", "asc")));
      const rows: NpcRecord[] = snap.docs.map((item) => {
        const data = item.data() as Partial<NpcRecord>;
        return {
          id: item.id,
          nome: String(data.nome || item.id),
          role: (String(data.role || "enfermeiro").toLowerCase() as NpcRole) || "enfermeiro",
          imageUrl: String(data.imageUrl || ""),
          appearanceRate:
            typeof data.appearanceRate === "number" && Number.isFinite(data.appearanceRate)
              ? data.appearanceRate
              : null,
          isCommercialized: Boolean(data.isCommercialized),
          ecoinPrice:
            typeof data.ecoinPrice === "number" && Number.isFinite(data.ecoinPrice)
              ? data.ecoinPrice
              : null,
          rpgTeam: Array.isArray(data.rpgTeam)
            ? data.rpgTeam
                .map((raw, index) => {
                  if (!raw || typeof raw !== "object") return null;
                  const row = raw as Record<string, unknown>;
                  const speciesId = Number(row.speciesId ?? null);
                  const moves = Array.isArray(row.moves)
                    ? row.moves
                        .map((move) => {
                          if (!move || typeof move !== "object") return null;
                          const moveRow = move as Record<string, unknown>;
                          const id = String(moveRow.id || "").trim();
                          const label = String(moveRow.label || id).trim();
                          if (!id) return null;
                          return { id, label };
                        })
                        .filter((move): move is NpcTeamMove => Boolean(move))
                    : [];
                  return {
                    slotId: String(row.slotId || `slot-${index + 1}`),
                    speciesId: Number.isFinite(speciesId) && speciesId > 0 ? speciesId : null,
                    speciesLabel: String(row.speciesLabel || ""),
                    level: String(row.level || "1"),
                    moves,
                    pokemonSearch: "",
                    moveSearch: "",
                  };
                })
                .filter((row): row is NpcTeamMember => Boolean(row))
            : [],
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        };
      });
      setNpcs(rows);
    } catch (error) {
      console.error("[NpcPage] load error", error);
      setErrorMsg("Nao foi possivel carregar os NPCs cadastrados.");
    } finally {
      setLoading(false);
    }
  }

  function openNewModal() {
    setForm(emptyForm);
    setSelectedImageFile(null);
    setErrorMsg(null);
    setFeedbackMsg(null);
    setModalOpen(true);
  }

  function closeModal() {
    if (saving) return;
    setModalOpen(false);
    setForm(emptyForm);
    setSelectedImageFile(null);
    setErrorMsg(null);
  }

  function updateForm<K extends keyof NpcFormState>(field: K, value: NpcFormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function addPolicePokemon() {
    setForm((current) => {
      if (current.rpgTeam.length >= 6) return current;
      return { ...current, rpgTeam: [...current.rpgTeam, createEmptyTeamMember(current.rpgTeam.length + 1)] };
    });
  }

  function removePolicePokemon(slotId: string) {
    setForm((current) => ({ ...current, rpgTeam: current.rpgTeam.filter((member) => member.slotId !== slotId) }));
  }

  function updatePolicePokemon(slotId: string, patch: Partial<NpcTeamMember>) {
    setForm((current) => ({
      ...current,
      rpgTeam: current.rpgTeam.map((member) => (member.slotId === slotId ? { ...member, ...patch } : member)),
    }));
  }

  function togglePoliceMove(slotId: string, move: CatalogMoveOption) {
    setForm((current) => ({
      ...current,
      rpgTeam: current.rpgTeam.map((member) => {
        if (member.slotId !== slotId) return member;
        const exists = member.moves.some((entry) => entry.id === move.id);
        if (exists) {
          return { ...member, moves: member.moves.filter((entry) => entry.id !== move.id) };
        }
        if (member.moves.length >= 4) return member;
        return { ...member, moves: [...member.moves, { id: move.id, label: move.label }] };
      }),
    }));
  }

  function handleImagePick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;
    setSelectedImageFile(file);

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      setForm((current) => ({ ...current, imageUrl: result }));
    };
    reader.onerror = () => {
      setErrorMsg("Nao foi possivel processar a imagem selecionada.");
    };
    reader.readAsDataURL(file);
  }

  async function handleSave() {
    setErrorMsg(null);
    setFeedbackMsg(null);

    const nome = form.nome.trim();
    const appearanceRateValue = form.appearanceRate.trim();
    const ecoinPriceValue = form.ecoinPrice.trim();

    if (!form.imageUrl.trim() && !selectedImageFile) {
      setErrorMsg("Adicione a foto do NPC.");
      return;
    }
    if (nome.length < 3) {
      setErrorMsg("Informe o nome do NPC com pelo menos 3 caracteres.");
      return;
    }

    let appearanceRate: number | null = null;
    if (shouldShowAppearanceRate) {
      const numericRate = Number(appearanceRateValue);
      if (!Number.isFinite(numericRate) || numericRate < 0 || numericRate > 100) {
        setErrorMsg("A taxa de aparicao deve ser um numero entre 0 e 100.");
        return;
      }
      appearanceRate = numericRate;
    }

    let ecoinPrice: number | null = null;
    if (form.isCommercialized) {
      const numericPrice = Number(ecoinPriceValue);
      if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
        setErrorMsg("Informe um valor valido em Ecoins.");
        return;
      }
      ecoinPrice = numericPrice;
    }

    let rpgTeam: NpcTeamMember[] = [];
    if (shouldShowPoliceTeam) {
      if (form.rpgTeam.length === 0) {
        setErrorMsg("Cadastre de 1 a 6 Pokemon para o NPC policial.");
        return;
      }
      if (form.rpgTeam.length > 6) {
        setErrorMsg("O NPC policial pode ter no maximo 6 Pokemon.");
        return;
      }
      const normalizedTeam: NpcTeamMember[] = [];
      for (const member of form.rpgTeam) {
        if (!member.speciesId || !member.speciesLabel.trim()) {
          setErrorMsg("Selecione o Pokemon de cada slot do time policial.");
          return;
        }
        const level = Number(member.level);
        if (!Number.isFinite(level) || level < 1 || level > 100) {
          setErrorMsg("O nivel dos Pokemon do policial deve ficar entre 1 e 100.");
          return;
        }
        if (member.moves.length === 0) {
          setErrorMsg("Escolha pelo menos 1 movimento para cada Pokemon do policial.");
          return;
        }
        normalizedTeam.push({
          slotId: member.slotId,
          speciesId: member.speciesId,
          speciesLabel: member.speciesLabel.trim(),
          level: String(Math.trunc(level)),
          moves: member.moves.slice(0, 4),
          pokemonSearch: "",
          moveSearch: "",
        });
      }
      rpgTeam = normalizedTeam;
    }

    const id = slugify(`${form.role}-${nome}`) || `npc-${Date.now()}`;

    setSaving(true);
    try {
      let imageUrl = form.imageUrl.trim();
      if (selectedImageFile) {
        const safeName = selectedImageFile.name.replace(/\s+/g, "_");
        const storagePath = `npcs/${id}/${Date.now()}_${safeName}`;
        const storageRef = ref(storage, storagePath);
        await uploadBytes(storageRef, selectedImageFile);
        imageUrl = await getDownloadURL(storageRef);
      }

      await setDoc(
        doc(db, "npcs", id),
        {
          id,
          nome,
          role: form.role,
          imageUrl,
          appearanceRate,
          isCommercialized: form.isCommercialized,
          ecoinPrice,
          rpgTeam,
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );

      await loadNpcs();
      setModalOpen(false);
      setForm(emptyForm);
      setSelectedImageFile(null);
      setFeedbackMsg("NPC cadastrado com sucesso.");
    } catch (error) {
      console.error("[NpcPage] save error", error);
      setErrorMsg("Falha ao salvar NPC. Verifique upload da imagem, permissoes e tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(npc: NpcRecord) {
    const confirmed = confirm(`Excluir o NPC "${npc.nome}"?`);
    if (!confirmed) return;

    setDeletingId(npc.id);
    setFeedbackMsg(null);
    setErrorMsg(null);
    try {
      await deleteDoc(doc(db, "npcs", npc.id));
      await loadNpcs();
      setFeedbackMsg(`NPC "${npc.nome}" removido com sucesso.`);
    } catch (error) {
      console.error("[NpcPage] delete error", error);
      setErrorMsg("Nao foi possivel excluir o NPC selecionado.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <RequireAuth>
      <div className="flex min-h-screen bg-slate-950 text-slate-100">
        <Sidebar />

        <main className="flex-1 px-4 py-6 md:px-6">
          <header className="mb-6 flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-5 shadow-2xl shadow-cyan-950/10 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-cyan-300">Cadastros</p>
              <h1 className="mt-2 text-2xl font-black tracking-tight md:text-3xl">Cadastro de NPCs</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-300">
                Cadastre NPCs com foto, funcao, taxa de aparicao e configuracao de comercializacao em Ecoins.
              </p>
            </div>

            <button
              type="button"
              onClick={openNewModal}
              className="inline-flex items-center justify-center rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-black uppercase tracking-[0.2em] text-slate-950 transition hover:bg-cyan-300"
            >
              Novo NPC
            </button>
          </header>

          {feedbackMsg ? (
            <div className="mb-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              {feedbackMsg}
            </div>
          ) : null}

          {errorMsg && !modalOpen ? (
            <div className="mb-4 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {errorMsg}
            </div>
          ) : null}

          <section className="rounded-3xl border border-slate-800 bg-slate-900/55 p-4 md:p-5">
            {loading ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-950 px-4 py-10 text-center text-sm text-slate-400">
                Carregando NPCs...
              </div>
            ) : npcs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/70 px-4 py-10 text-center text-sm text-slate-400">
                Nenhum NPC cadastrado ainda. Clique em <b>Novo NPC</b> para criar o primeiro.
              </div>
            ) : (
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
                {npcs.map((npc) => {
                  const roleLabel = ROLE_OPTIONS.find((item) => item.value === npc.role)?.label ?? npc.role;
                  return (
                    <article
                      key={npc.id}
                      className="max-w-[240px] overflow-hidden rounded-2xl border border-white/10 bg-slate-950/80 shadow-lg shadow-black/20"
                    >
                      <div className="h-28 w-full overflow-hidden bg-slate-900">
                        {npc.imageUrl ? (
                          <img src={npc.imageUrl} alt={npc.nome} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-sm text-slate-500">Sem foto</div>
                        )}
                      </div>

                      <div className="space-y-3 p-3">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-300">{roleLabel}</div>
                          <h2 className="mt-1 text-lg font-black text-white">{npc.nome}</h2>
                        </div>

                        <div className="grid gap-2 text-sm text-slate-300">
                          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/5 px-3 py-2">
                            <span>Comercializado</span>
                            <span className={npc.isCommercialized ? "font-bold text-emerald-300" : "font-bold text-slate-400"}>
                              {npc.isCommercialized ? "Sim" : "Nao"}
                            </span>
                          </div>

                          {(npc.role === "ladrao" || npc.role === "policial") && (
                            <div className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/5 px-3 py-2">
                              <span>Taxa de aparicao</span>
                              <span className="font-bold text-cyan-200">
                                {npc.appearanceRate !== null ? `${npc.appearanceRate}%` : "-"}
                              </span>
                            </div>
                          )}

                          {npc.isCommercialized && (
                            <div className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/5 px-3 py-2">
                              <span>Valor em Ecoins</span>
                              <span className="font-bold text-amber-300">
                                {npc.ecoinPrice !== null ? npc.ecoinPrice : "-"}
                              </span>
                            </div>
                          )}

                          {npc.role === "policial" && (
                            <div className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/5 px-3 py-2">
                              <span>Time RPG</span>
                              <span className="font-bold text-violet-300">{npc.rpgTeam.length} Pokemon</span>
                            </div>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => void handleDelete(npc)}
                          disabled={deletingId === npc.id}
                          className="w-full rounded-xl border border-red-400/25 bg-red-500/10 px-3 py-2 text-sm font-bold text-red-200 transition hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {deletingId === npc.id ? "Excluindo..." : "Excluir NPC"}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {modalOpen && (
            <div
              className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 p-4 backdrop-blur-sm"
              onClick={closeModal}
            >
              <div className="flex min-h-full items-start justify-center py-4">
                <div
                  className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-[32px] border border-white/10 bg-slate-950 shadow-2xl shadow-black/40"
                  onClick={(event) => event.stopPropagation()}
                >
                <div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-5 py-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-cyan-300">Novo NPC</p>
                    <h2 className="mt-1 text-xl font-black text-white">Cadastro de NPC</h2>
                  </div>

                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
                  >
                    Fechar
                  </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto">
                  <div
                    className={`grid gap-6 p-5 ${
                      shouldShowPoliceTeam
                        ? "xl:grid-cols-[260px_minmax(0,1fr)_minmax(380px,460px)]"
                        : "md:grid-cols-[260px_minmax(0,1fr)]"
                    }`}
                  >
                  <div className="space-y-4">
                    <div className="overflow-hidden rounded-[28px] border border-white/10 bg-slate-900">
                      <div className="aspect-[4/5] w-full bg-slate-950">
                        {form.imageUrl ? (
                          <img src={form.imageUrl} alt={formPreviewTitle} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500">
                            Adicione a foto do NPC para visualizar o preview.
                          </div>
                        )}
                      </div>
                      <div className="border-t border-white/10 px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Preview</p>
                        <p className="mt-2 text-lg font-black text-white">{formPreviewTitle}</p>
                      </div>
                    </div>

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
                      disabled={saving}
                      className="w-full rounded-2xl border border-dashed border-cyan-300/40 bg-cyan-400/10 px-4 py-3 text-sm font-bold text-cyan-200 transition hover:bg-cyan-400/15"
                    >
                      {selectedImageFile ? "Trocar foto do NPC" : "Foto do NPC"}
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                        Nome do NPC
                      </label>
                      <input
                        value={form.nome}
                        onChange={(event) => updateForm("nome", event.target.value)}
                        className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/50"
                        placeholder="Ex: Enfermeira Joy"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                        Funcao do NPC
                      </label>
                      <select
                        value={form.role}
                        onChange={(event) => updateForm("role", event.target.value as NpcRole)}
                        className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/50"
                      >
                        {ROLE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value} className="bg-slate-950">
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {shouldShowAppearanceRate && (
                      <div>
                        <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                          Taxa de aparicao
                        </label>
                        <input
                          value={form.appearanceRate}
                          onChange={(event) => updateForm("appearanceRate", event.target.value)}
                          className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/50"
                          placeholder="Informe um valor entre 0 e 100"
                          inputMode="numeric"
                        />
                        <p className="mt-2 text-xs text-slate-500">Campo exibido apenas para Ladrao e Policial.</p>
                      </div>
                    )}

                    <div className="rounded-[28px] border border-white/10 bg-white/5 p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-bold text-white">Comercializar este NPC</p>
                          <p className="mt-1 text-xs text-slate-400">
                            Ative se esse NPC deve ser vendido no jogo.
                          </p>
                        </div>

                        <Toggle
                          checked={form.isCommercialized}
                          onChange={(value) => updateForm("isCommercialized", value)}
                          disabled={saving}
                        />
                      </div>

                      {form.isCommercialized && (
                        <div className="mt-4">
                          <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                            Valor em Ecoins
                          </label>
                          <input
                            value={form.ecoinPrice}
                            onChange={(event) => updateForm("ecoinPrice", event.target.value)}
                            className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/50"
                            placeholder="Ex: 350"
                            inputMode="numeric"
                          />
                        </div>
                      )}
                    </div>

                    {errorMsg ? (
                      <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                        {errorMsg}
                      </div>
                    ) : null}

                    <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end">
                      <button
                        type="button"
                        onClick={closeModal}
                        className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-bold text-slate-200 transition hover:bg-white/10"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSave()}
                        disabled={saving}
                        className="rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-black uppercase tracking-[0.2em] text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {saving ? "Salvando..." : "Salvar NPC"}
                      </button>
                    </div>
                  </div>

                  {shouldShowPoliceTeam && (
                    <div className="rounded-[28px] border border-white/10 bg-white/5 p-4 xl:max-h-[calc(92vh-120px)] xl:overflow-y-auto">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-bold text-white">Time do RPG</p>
                            <p className="mt-1 text-xs text-slate-400">
                              O policial pode ter de 1 a 6 Pokemon, com nivel e ate 4 movimentos.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={addPolicePokemon}
                            disabled={form.rpgTeam.length >= 6 || saving}
                            className="rounded-xl border border-cyan-300/30 bg-cyan-400/10 px-3 py-2 text-xs font-bold text-cyan-200 transition hover:bg-cyan-400/15 disabled:opacity-40"
                          >
                            + Pokemon
                          </button>
                        </div>

                        <div className="mt-4 space-y-4">
                          {form.rpgTeam.length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-slate-700 px-4 py-4 text-xs text-slate-400">
                              Nenhum Pokemon adicionado ainda.
                            </div>
                          ) : (
                            form.rpgTeam.map((member, index) => (
                              <div key={member.slotId} className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                                <div className="mb-3 flex items-center justify-between gap-3">
                                  <p className="text-sm font-bold text-white">Pokemon {index + 1}</p>
                                  <button
                                    type="button"
                                    onClick={() => removePolicePokemon(member.slotId)}
                                    className="rounded-lg border border-red-400/25 bg-red-500/10 px-2 py-1 text-[11px] font-bold text-red-200 hover:bg-red-500/15"
                                  >
                                    Remover
                                  </button>
                                </div>

                                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px]">
                                  <div>
                                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                                      Pokemon
                                    </label>
                                    <input
                                      value={member.pokemonSearch}
                                      onChange={(event) =>
                                        updatePolicePokemon(member.slotId, { pokemonSearch: event.target.value })
                                      }
                                      className="mb-2 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/50"
                                      placeholder="Buscar Pokemon..."
                                    />
                                    <select
                                      value={member.speciesId ?? ""}
                                      onChange={(event) => {
                                        const speciesId = Number(event.target.value || 0);
                                        const species = speciesOptions.find((row) => row.id === speciesId) ?? null;
                                        updatePolicePokemon(member.slotId, {
                                          speciesId: species ? species.id : null,
                                          speciesLabel: species ? species.label : "",
                                        });
                                      }}
                                      className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/50"
                                    >
                                      <option value="" className="bg-slate-950">
                                        Selecione um Pokemon
                                      </option>
                                      {speciesOptions
                                        .filter((species) => {
                                          const q = member.pokemonSearch.trim().toLowerCase();
                                          if (!q) return true;
                                          return species.label.toLowerCase().includes(q) || String(species.id).includes(q);
                                        })
                                        .map((species) => (
                                        <option key={species.id} value={species.id} className="bg-slate-950">
                                          {species.label}
                                        </option>
                                        ))}
                                    </select>
                                  </div>

                                  <div>
                                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                                      Nivel
                                    </label>
                                    <input
                                      value={member.level}
                                      onChange={(event) => updatePolicePokemon(member.slotId, { level: event.target.value })}
                                      className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/50"
                                      inputMode="numeric"
                                      placeholder="1-100"
                                    />
                                  </div>
                                </div>

                                <div className="mt-3">
                                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                                    Movimentos
                                  </label>
                                  <input
                                    value={member.moveSearch}
                                    onChange={(event) =>
                                      updatePolicePokemon(member.slotId, { moveSearch: event.target.value })
                                    }
                                    className="mb-2 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/50"
                                    placeholder="Buscar movimento..."
                                  />
                                  <div className="max-h-36 overflow-y-auto rounded-2xl border border-white/10 bg-white/5 p-3">
                                    <div className="grid gap-2 md:grid-cols-2">
                                      {moveOptions
                                        .filter((move) => {
                                          const q = member.moveSearch.trim().toLowerCase();
                                          if (!q) return true;
                                          return move.label.toLowerCase().includes(q) || move.id.toLowerCase().includes(q);
                                        })
                                        .map((move) => {
                                        const checked = member.moves.some((entry) => entry.id === move.id);
                                        return (
                                          <label key={`${member.slotId}-${move.id}`} className="flex items-center gap-2 text-xs text-slate-200">
                                            <input
                                              type="checkbox"
                                              checked={checked}
                                              onChange={() => togglePoliceMove(member.slotId, move)}
                                            />
                                            <span>{move.label}</span>
                                          </label>
                                        );
                                      })}
                                    </div>
                                  </div>
                                  <p className="mt-2 text-[11px] text-slate-500">
                                    Selecione ate 4 movimentos por Pokemon.
                                  </p>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </RequireAuth>
  );
}
