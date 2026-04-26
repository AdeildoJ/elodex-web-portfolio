"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs, orderBy, query } from "firebase/firestore";

import { db } from "@/lib/firebase";
import pokemonSpeciesJson from "@/data/pokemon/pokemonSpecies.json";
import { imageFileToStorableDataUrl } from "@/lib/imageProcessing";
import {
  evolutionTargetsForSpecies,
  isValidEvolutionPair,
  loadBiomeEvolutionPairs,
  type BiomeEvolutionPair,
} from "@/lib/biomeEvolutionSync";
import {
  adminNpcRoleToBiomeRole,
  BIOME_GAME_VERSION,
  getNextBiomeOrder,
  loadBiomeCadastroDraft,
  saveBiomeCadastro,
  type BiomeCadastroPayload,
  type BiomeNpcFirestore,
} from "@/lib/biomeCadastroSave";
import { FilteredMultiNumber, FilteredMultiString, type CatalogSpeciesOption } from "@/components/biomas/CatalogMultiPickers";
import { normalizeScenarioRecord, SCENARIO_WEATHER_OPTIONS, type ScenarioRecord } from "@/lib/scenarioCatalog";

type NpcRow = { id: string; nome: string; role: string; imageUrl: string };
type CaptureGroupRow = { id: string; name: string };

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
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2">
      <span className="text-xs font-medium text-slate-300">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition ${
          checked ? "border-emerald-400/60 bg-emerald-500/30" : "border-slate-700 bg-slate-800"
        } ${disabled ? "cursor-not-allowed opacity-45" : ""}`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40">
      <div className="border-b border-slate-800 px-4 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</h3>
      </div>
      <div className="space-y-4 p-4">{children}</div>
    </section>
  );
}

const emptyPair = (): { key: string; from: number | null; to: number | null } => ({
  key: `p-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  from: null,
  to: null,
});

export type BiomeCadastroModalProps = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  editingBiomeId: string | null;
};

export default function BiomeCadastroModal({
  open,
  onClose,
  onSaved,
  editingBiomeId,
}: BiomeCadastroModalProps) {
  const isEdit = Boolean(editingBiomeId);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [imageDataUrl, setImageDataUrl] = useState("");
  const [order, setOrder] = useState(1);
  const [allowsFishing, setAllowsFishing] = useState(false);
  const [allowsSafari, setAllowsSafari] = useState(false);
  const [acceptsGym, setAcceptsGym] = useState(false);
  const [evolutionEnabled, setEvolutionEnabled] = useState(false);
  const [evolutionRows, setEvolutionRows] = useState(() => [emptyPair()]);
  const [npcEnabled, setNpcEnabled] = useState(false);
  const [selectedNpcIds, setSelectedNpcIds] = useState<string[]>([]);
  const [battleScenarioId, setBattleScenarioId] = useState("");
  const [battleWeather, setBattleWeather] = useState<string>("clear");

  const [captureNormalGroupIds, setCaptureNormalGroupIds] = useState<string[]>([]);
  const [captureNormalSpeciesIds, setCaptureNormalSpeciesIds] = useState<number[]>([]);
  const [captureSafariGroupIds, setCaptureSafariGroupIds] = useState<string[]>([]);
  const [captureSafariSpeciesIds, setCaptureSafariSpeciesIds] = useState<number[]>([]);

  const [biomeStatus, setBiomeStatus] = useState<"active" | "inactive">("active");
  const [visibleOnMap, setVisibleOnMap] = useState(true);
  const [isStartBiome, setIsStartBiome] = useState(false);
  const [draftMapPosition, setDraftMapPosition] = useState<{ x: number; y: number } | null>(null);
  const [draftIsPlacedOnMap, setDraftIsPlacedOnMap] = useState(false);

  const [scenarios, setScenarios] = useState<ScenarioRecord[]>([]);
  const [npcRows, setNpcRows] = useState<NpcRow[]>([]);
  const [captureGroups, setCaptureGroups] = useState<CaptureGroupRow[]>([]);
  /** Espécies com `pokedexConfig` em modo individual (mesma tela de grupos na Pokédex). */
  const [individualCaptureSpeciesIds, setIndividualCaptureSpeciesIds] = useState<number[]>([]);
  const [evolutionSpeciesSearch, setEvolutionSpeciesSearch] = useState("");

  const speciesOptions = useMemo((): CatalogSpeciesOption[] => {
    const root = pokemonSpeciesJson as Record<string, { id?: number; name?: string }>;
    return Object.values(root)
      .map((row) => {
        const id = Number(row.id || 0);
        const name = String(row.name || "").trim();
        if (!id || !name) return null;
        return { id, label: `#${id} ${name}` };
      })
      .filter((v): v is CatalogSpeciesOption => v != null)
      .sort((a, b) => a.id - b.id);
  }, []);

  const computedBiomeId = useMemo(() => {
    if (isEdit && editingBiomeId) return editingBiomeId.trim().toLowerCase();
    const s = slugify(name);
    return s || "";
  }, [isEdit, editingBiomeId, name]);

  const evolutionSpeciesChoices = useMemo(() => {
    const q = evolutionSpeciesSearch.trim().toLowerCase();
    if (!q) return speciesOptions.slice(0, 100);
    return speciesOptions
      .filter((s) => s.label.toLowerCase().includes(q) || String(s.id).includes(q))
      .slice(0, 350);
  }, [speciesOptions, evolutionSpeciesSearch]);

  const captureIndividualSpeciesOptions = useMemo(() => {
    const allowed = new Set(individualCaptureSpeciesIds);
    return speciesOptions.filter((s) => allowed.has(s.id));
  }, [speciesOptions, individualCaptureSpeciesIds]);

  const resetCreateForm = useCallback(() => {
    setName("");
    setDescription("");
    setImageDataUrl("");
    setOrder(1);
    setAllowsFishing(false);
    setAllowsSafari(false);
    setAcceptsGym(false);
    setEvolutionEnabled(false);
    setEvolutionRows([emptyPair()]);
    setNpcEnabled(false);
    setSelectedNpcIds([]);
    setBattleScenarioId("");
    setBattleWeather("clear");
    setCaptureNormalGroupIds([]);
    setCaptureNormalSpeciesIds([]);
    setCaptureSafariGroupIds([]);
    setCaptureSafariSpeciesIds([]);
    setBiomeStatus("active");
    setVisibleOnMap(true);
    setIsStartBiome(false);
    setDraftMapPosition(null);
    setDraftIsPlacedOnMap(false);
    setEvolutionSpeciesSearch("");
    setError(null);
  }, []);

  const loadCatalogs = useCallback(async () => {
    try {
      const [scenSnap, npcSnap, grpSnap, pokedexSnap] = await Promise.all([
        getDocs(collection(db, "scenarios")),
        getDocs(query(collection(db, "npcs"), orderBy("nome", "asc"))),
        getDocs(collection(db, "captureConfigGroups")),
        getDocs(collection(db, "pokedexConfig")),
      ]);

      const scenRows: ScenarioRecord[] = [];
      scenSnap.forEach((d) => {
        scenRows.push(normalizeScenarioRecord(d.id, d.data()));
      });
      scenRows.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
      setScenarios(scenRows.filter((s) => s.isActive !== false));

      const npcList: NpcRow[] = [];
      npcSnap.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        npcList.push({
          id: d.id,
          nome: String(data.nome || d.id),
          role: String(data.role || ""),
          imageUrl: String(data.imageUrl || ""),
        });
      });
      setNpcRows(npcList);

      const gr: CaptureGroupRow[] = [];
      grpSnap.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        gr.push({ id: d.id, name: String(data.name || d.id) });
      });
      gr.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
      setCaptureGroups(gr);

      const prefix = `${BIOME_GAME_VERSION}_`;
      const ind = new Set<number>();
      pokedexSnap.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        if (String(data.configMode || "") !== "individual") return;
        const ver = String(data.versionId || BIOME_GAME_VERSION);
        if (ver !== BIOME_GAME_VERSION) return;
        let sid = Math.trunc(Number(data.speciesId ?? 0));
        if (!sid && d.id.startsWith(prefix)) {
          sid = Math.trunc(Number(d.id.slice(prefix.length)));
        }
        if (sid > 0) ind.add(sid);
      });
      setIndividualCaptureSpeciesIds(Array.from(ind).sort((a, b) => a - b));
    } catch (e) {
      console.error("[BiomeCadastroModal] catalog load", e);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadCatalogs();
  }, [open, loadCatalogs]);

  useEffect(() => {
    if (!open) return;
    if (!isEdit) {
      resetCreateForm();
      let aliveNext = true;
      void (async () => {
        try {
          const next = await getNextBiomeOrder(db);
          if (aliveNext) setOrder(next);
        } catch (e) {
          console.error("[BiomeCadastroModal] next order", e);
        }
      })();
      return () => {
        aliveNext = false;
      };
    }
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const draft = await loadBiomeCadastroDraft(db, editingBiomeId!, (id) => loadBiomeEvolutionPairs(db, id));
        if (!alive || !draft?.biomeId) {
          setError("Bioma não encontrado.");
          return;
        }
        setName(draft.name ?? "");
        setDescription(draft.description ?? "");
        setImageDataUrl(draft.imageDataUrl ?? "");
        setOrder(Math.max(0, Math.trunc(Number(draft.order ?? 0))) || 1);
        setAllowsFishing(!!draft.allowsFishing);
        setAllowsSafari(!!draft.allowsSafari);
        setAcceptsGym(!!draft.acceptsGym);
        setEvolutionEnabled(!!draft.evolutionEnabled);
        const pairs = draft.evolutionPairs ?? [];
        if (pairs.length) {
          setEvolutionRows(
            pairs.map((pr) => ({
              key: `p-${pr.fromSpeciesId}-${pr.toSpeciesId}`,
              from: pr.fromSpeciesId,
              to: pr.toSpeciesId,
            }))
          );
        } else {
          setEvolutionRows([emptyPair()]);
        }
        setNpcEnabled(!!draft.npcEnabled);
        setSelectedNpcIds((draft.npcs ?? []).map((n) => n.id));
        setBattleScenarioId(draft.battleScenarioId ?? "");
        setBattleWeather(draft.battleWeather ?? "clear");
        setCaptureNormalGroupIds(draft.captureNormalGroupIds ?? []);
        setCaptureNormalSpeciesIds(draft.captureNormalSpeciesIds ?? []);
        setCaptureSafariGroupIds(draft.captureSafariGroupIds ?? []);
        setCaptureSafariSpeciesIds(draft.captureSafariSpeciesIds ?? []);
        setBiomeStatus(draft.biomeStatus ?? "active");
        setVisibleOnMap(draft.visibleOnMap !== false);
        setIsStartBiome(!!draft.isStartBiome);
        setDraftMapPosition(draft.mapPosition ?? null);
        setDraftIsPlacedOnMap(!!draft.isPlacedOnMap);
      } catch (e) {
        console.error(e);
        setError("Não foi possível carregar o bioma.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, isEdit, editingBiomeId, resetCreateForm]);

  useEffect(() => {
    if (!allowsSafari) {
      setCaptureSafariGroupIds([]);
      setCaptureSafariSpeciesIds([]);
    }
  }, [allowsSafari]);

  useEffect(() => {
    if (!evolutionEnabled) {
      setEvolutionRows([emptyPair()]);
    }
  }, [evolutionEnabled]);

  useEffect(() => {
    if (!npcEnabled) setSelectedNpcIds([]);
  }, [npcEnabled]);

  async function onPickImage(file: File | null) {
    if (!file) return;
    try {
      const url = await imageFileToStorableDataUrl(file, 1280, 0.78);
      setImageDataUrl(url);
    } catch (e) {
      console.error(e);
      setError("Falha ao processar a imagem.");
    }
  }

  function validate(): string | null {
    if (!String(name || "").trim()) return "Informe o nome do bioma.";
    if (!isEdit && !computedBiomeId) return "Nome inválido para gerar o identificador do bioma.";
    if (!imageDataUrl.trim()) return "Adicione a imagem do bioma.";
    if (!battleScenarioId.trim()) return "Selecione o cenário de batalha (Battle Scene).";
    if (evolutionEnabled) {
      const filled = evolutionRows.filter((r) => r.from != null && r.to != null) as Array<{
        from: number;
        to: number;
      }>;
      if (!filled.length) {
        return "Informe ao menos um par Pokémon → Evolução, ou desative a evolução.";
      }
      for (const row of filled) {
        if (!isValidEvolutionPair(row.from, row.to)) {
          return `Evolução inválida para o Pokémon #${row.from}.`;
        }
      }
    }
    return null;
  }

  async function handleSave() {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const bid = (isEdit ? editingBiomeId! : computedBiomeId).trim().toLowerCase();
      if (!isEdit) {
        const snap = await getDoc(doc(db, "biomes", bid));
        if (snap.exists()) {
          setError(`Já existe bioma com o id "${bid}". Altere o nome.`);
          setSaving(false);
          return;
        }
      }

      const npcs: BiomeNpcFirestore[] = [];
      if (npcEnabled) {
        for (const nid of selectedNpcIds) {
          const row = npcRows.find((n) => n.id === nid);
          if (!row) continue;
          const role = adminNpcRoleToBiomeRole(row.role);
          npcs.push({
            id: row.id,
            role,
            name: row.nome,
            imageUrl: row.imageUrl,
            specialistType: null,
          });
        }
      }

      const evolutionPairs: BiomeEvolutionPair[] = evolutionEnabled
        ? evolutionRows
            .filter((r): r is { key: string; from: number; to: number } => r.from != null && r.to != null)
            .map((r) => ({ fromSpeciesId: r.from, toSpeciesId: r.to }))
        : [];

      const payload: BiomeCadastroPayload = {
        biomeId: bid,
        name: name.trim(),
        description: description.trim(),
        imageDataUrl,
        order: Math.max(0, Math.trunc(order) || 0),
        allowsFishing,
        allowsSafari,
        acceptsGym,
        evolutionEnabled,
        evolutionPairs,
        npcEnabled,
        npcs,
        battleScenarioId,
        battleWeather,
        captureNormalGroupIds,
        captureNormalSpeciesIds,
        captureSafariGroupIds: allowsSafari ? captureSafariGroupIds : [],
        captureSafariSpeciesIds: allowsSafari ? captureSafariSpeciesIds : [],
        biomeStatus,
        visibleOnMap,
        isStartBiome,
        mapPosition: draftMapPosition,
        isPlacedOnMap: draftIsPlacedOnMap,
      };

      await saveBiomeCadastro(db, payload);
      onSaved();
      onClose();
      if (!isEdit) resetCreateForm();
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const groupOptions = captureGroups.map((g) => ({ id: g.id, label: `${g.name} (${g.id})` }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-3 py-6">
      <div
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="biome-modal-title"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-800 px-5 py-4">
          <div>
            <h2 id="biome-modal-title" className="text-lg font-semibold text-white">
              {isEdit ? "Editar Bioma" : "Novo Bioma"}
            </h2>
            <p className="text-[11px] text-slate-500">
              Identificador: <span className="font-mono text-slate-300">{computedBiomeId || "—"}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
            aria-label="Fechar"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading && <p className="text-sm text-slate-400">Carregando…</p>}
          {!loading && error && (
            <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>
          )}

          {!loading && (
            <div className="space-y-6">
              <SectionCard title="1. Informações do Bioma">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="md:col-span-2 space-y-2">
                    <label className="text-xs font-medium text-slate-400">
                      Adicionar imagem <span className="text-red-400">*</span>
                    </label>
                    <div className="flex flex-wrap items-start gap-4">
                      <label className="cursor-pointer rounded-lg border border-dashed border-slate-600 bg-slate-900 px-4 py-3 text-sm text-cyan-300 hover:border-cyan-500/50">
                        Adicionar imagem
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => void onPickImage(e.target.files?.[0] ?? null)}
                        />
                      </label>
                      {imageDataUrl ? (
                        <img src={imageDataUrl} alt="" className="h-24 w-40 rounded-lg border border-slate-700 object-cover" />
                      ) : (
                        <span className="text-xs text-slate-500">Nenhuma imagem selecionada.</span>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-400">
                      Nome <span className="text-red-400">*</span>
                    </label>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    />
                    {isEdit && (
                      <p className="text-[10px] text-slate-500">
                        O id do documento permanece <span className="font-mono text-slate-400">{editingBiomeId}</span>.
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-400">
                      Ordem <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={order}
                      onChange={(e) => setOrder(Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    />
                    <p className="text-[10px] text-slate-500">Novos biomas sugerem a próxima ordem livre; você pode ajustar.</p>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <label className="text-xs font-medium text-slate-400">Descrição</label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={3}
                      className="w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <Toggle label="Pesca" checked={allowsFishing} onChange={setAllowsFishing} />
                  <Toggle label="Safari" checked={allowsSafari} onChange={setAllowsSafari} />
                  <Toggle label="GYM" checked={acceptsGym} onChange={setAcceptsGym} />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-400">
                      Battle Scene <span className="text-red-400">*</span>
                    </label>
                    <select
                      value={battleScenarioId}
                      onChange={(e) => setBattleScenarioId(e.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    >
                      <option value="">Selecione…</option>
                      {scenarios.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-400">Clima especial</label>
                    <select
                      value={battleWeather}
                      onChange={(e) => setBattleWeather(e.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    >
                      {SCENARIO_WEATHER_OPTIONS.map((w) => (
                        <option key={w.value} value={w.value}>
                          {w.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-3">
                  <Toggle label="Evolução" checked={evolutionEnabled} onChange={setEvolutionEnabled} />
                  {evolutionEnabled && (
                    <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                      <p className="text-[11px] text-slate-500">
                        A lista de evolução filtra com base no Pokémon escolhido (dados em{" "}
                        <code className="text-slate-400">src/data/evolutionTargetsBySpecies.json</code>, gerados no{" "}
                        <code className="text-slate-400">npm run dev</code> / build).
                      </p>
                      <input
                        value={evolutionSpeciesSearch}
                        onChange={(e) => setEvolutionSpeciesSearch(e.target.value)}
                        placeholder="Buscar Pokémon (nome ou número)…"
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder:text-slate-600"
                      />
                      {evolutionRows.map((row, idx) => {
                        const targets =
                          row.from != null && row.from > 0 ? evolutionTargetsForSpecies(row.from) : [];
                        const targetOptions = speciesOptions.filter((s) => targets.includes(s.id));
                        return (
                          <div key={row.key} className="grid gap-2 rounded-lg border border-slate-800/80 p-3 md:grid-cols-2">
                            <div className="space-y-1">
                              <label className="text-[11px] text-slate-400">
                                Pokémon <span className="text-red-400">*</span>
                              </label>
                              <select
                                value={row.from ?? ""}
                                onChange={(e) => {
                                  const v = e.target.value ? Number(e.target.value) : null;
                                  setEvolutionRows((prev) =>
                                    prev.map((r, i) => (i === idx ? { ...r, from: v, to: null } : r))
                                  );
                                }}
                                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-white"
                              >
                                <option value="">Selecione…</option>
                                {evolutionSpeciesChoices.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-1">
                              <label className="text-[11px] text-slate-400">
                                Evolução <span className="text-red-400">*</span>
                              </label>
                              <select
                                value={row.to ?? ""}
                                onChange={(e) => {
                                  const v = e.target.value ? Number(e.target.value) : null;
                                  setEvolutionRows((prev) => prev.map((r, i) => (i === idx ? { ...r, to: v } : r)));
                                }}
                                disabled={!row.from}
                                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-white disabled:opacity-50"
                              >
                                <option value="">{row.from ? "Selecione…" : "Escolha o Pokémon primeiro"}</option>
                                {targetOptions.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            {evolutionRows.length > 1 && (
                              <button
                                type="button"
                                className="text-xs text-red-400 hover:underline md:col-span-2"
                                onClick={() => setEvolutionRows((prev) => prev.filter((_, i) => i !== idx))}
                              >
                                Remover par
                              </button>
                            )}
                          </div>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => setEvolutionRows((prev) => [...prev, emptyPair()])}
                        className="text-xs font-medium text-cyan-400 hover:underline"
                      >
                        + Adicionar par
                      </button>
                    </div>
                  )}
                </div>

                <Toggle label="NPC" checked={npcEnabled} onChange={setNpcEnabled} />
                {npcEnabled && (
                  <FilteredMultiString
                    label="NPCs do Bioma"
                    options={npcRows.map((n) => ({ id: n.id, label: `${n.nome} (${n.id})` }))}
                    values={selectedNpcIds}
                    onChange={setSelectedNpcIds}
                  />
                )}
              </SectionCard>

              <SectionCard title="2. Informações de Captura">
                <div className="space-y-4">
                  <p className="text-xs font-medium text-slate-300">Captura normal</p>
                  <div className="grid gap-4 md:grid-cols-2">
                    <FilteredMultiString
                      label="Grupos"
                      options={groupOptions}
                      values={captureNormalGroupIds}
                      onChange={setCaptureNormalGroupIds}
                    />
                    <FilteredMultiNumber
                      label="Pokémon individuais"
                      options={captureIndividualSpeciesOptions}
                      values={captureNormalSpeciesIds}
                      onChange={setCaptureNormalSpeciesIds}
                      hint="Só aparecem espécies já configuradas como captura individual em Configurar captura na Pokédex."
                    />
                  </div>
                </div>

                {allowsSafari && (
                  <>
                    <div className="border-t border-slate-800 pt-4">
                      <p className="mb-3 text-xs font-medium text-amber-200/90">Captura Safari</p>
                      <div className="grid gap-4 md:grid-cols-2">
                        <FilteredMultiString
                          label="Grupos (Safari)"
                          options={groupOptions}
                          values={captureSafariGroupIds}
                          onChange={setCaptureSafariGroupIds}
                        />
                        <FilteredMultiNumber
                          label="Pokémon (Safari, individual na Pokédex)"
                          options={captureIndividualSpeciesOptions}
                          values={captureSafariSpeciesIds}
                          onChange={setCaptureSafariSpeciesIds}
                          hint="Mesma lista de Pokémon com configuração individual na Pokédex."
                        />
                      </div>
                    </div>
                  </>
                )}
              </SectionCard>

              <SectionCard title="3. Configurações Especiais">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-slate-400">
                      Status do Bioma <span className="text-red-400">*</span>
                    </label>
                    <select
                      value={biomeStatus}
                      onChange={(e) => setBiomeStatus(e.target.value === "inactive" ? "inactive" : "active")}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    >
                      <option value="active">Ativo</option>
                      <option value="inactive">Inativo</option>
                    </select>
                    <p className="text-[10px] text-slate-500">Bioma inativo não deve aparecer para o jogador.</p>
                  </div>
                  <div className="space-y-3 md:col-span-2">
                    <Toggle label="Visível no Mapa" checked={visibleOnMap} onChange={setVisibleOnMap} />
                    <Toggle label="Bioma inicial" checked={isStartBiome} onChange={setIsStartBiome} />
                    <p className="text-[10px] text-slate-500">
                      Ao marcar um bioma como inicial, os demais deixam de ser iniciais. KM, ticket, itens, movimentos e Pokémon
                      necessários para viajar ficam no editor <span className="text-slate-400">Mapa de Biomas</span> (rotas).
                    </p>
                  </div>
                </div>
              </SectionCard>
            </div>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-800 bg-slate-950/95 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving || loading}
            onClick={() => void handleSave()}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
