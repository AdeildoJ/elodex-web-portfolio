"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

import { db } from "@/lib/firebase";
import {
  DEFAULT_ADMIN_BIOMES,
  type AdminBiome,
  type BiomeNpcConfig,
  type BiomeNpcRole,
} from "@/data/biomes";

type BiomeDoc = AdminBiome & {
  npcs?: BiomeNpcConfig[];
  unlockRules?: unknown;
  battleAssets?: unknown;
  battleScenarios?: string[];
  updatedAt?: unknown;
  createdAt?: unknown;
};

type UnlockType = "km" | "mission" | "party" | "move";

type BiomeForm = {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  npcs: BiomeNpcConfig[];
  unlockType: UnlockType;
  kmRequired: string;
  missionId: string;
  partySpeciesIds: number[];
  requiredMoveIds: string[];
  battleAssets: BiomeBattleAssets;
  battleScenarios: string[];
};

type BiomeBattleAssetKey =
  | "skyDay"
  | "skyNight"
  | "sky"
  | "background"
  | "backgroundDay"
  | "backgroundNight"
  | "groundDay"
  | "groundNight"
  | "ground"
  | "overlayRain"
  | "overlaySnow"
  | "overlaySandstorm"
  | "overlaySunny"
  | "backgroundRain"
  | "backgroundSunny"
  | "backgroundSandstorm"
  | "backgroundSnow"
  | "platformPlayer"
  | "platformEnemy";

type BiomeBattleAssets = Record<BiomeBattleAssetKey, string>;

type NpcDraft = {
  role: BiomeNpcRole;
  name: string;
  imageUrl: string;
  specialistType: string;
};

type MissionOption = {
  id: string;
  title: string;
};

type SpeciesOption = {
  id: number;
  label: string;
};

type MoveOption = {
  id: string;
  label: string;
};

function slugify(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const emptyForm: BiomeForm = {
  id: "",
  name: "",
  description: "",
  imageUrl: "",
  npcs: [],
  unlockType: "km",
  kmRequired: "0",
  missionId: "",
  partySpeciesIds: [],
  requiredMoveIds: [],
  battleAssets: {
    skyDay: "",
    skyNight: "",
    sky: "",
    background: "",
    backgroundDay: "",
    backgroundNight: "",
    groundDay: "",
    groundNight: "",
    ground: "",
    overlayRain: "",
    overlaySnow: "",
    overlaySandstorm: "",
    overlaySunny: "",
    backgroundRain: "",
    backgroundSunny: "",
    backgroundSandstorm: "",
    backgroundSnow: "",
    platformPlayer: "",
    platformEnemy: "",
  },
  battleScenarios: [],
};

const BATTLE_ASSET_FIELDS: Array<{
  key: BiomeBattleAssetKey;
  label: string;
  helper: string;
}> = [
    { key: "skyDay", label: "Sky dia", helper: "Ceu/fundo distante em periodo diurno." },
    { key: "skyNight", label: "Sky noite", helper: "Ceu/fundo distante em periodo noturno." },
    { key: "sky", label: "Sky base", helper: "Fallback geral quando dia/noite nao existirem." },
    { key: "background", label: "Background base", helper: "Camada intermediaria principal do bioma." },
    { key: "backgroundDay", label: "Fundo dia (padrao)", helper: "Clima normal / clear." },
    { key: "backgroundNight", label: "Fundo noite", helper: "Batalhas noturnas." },
    { key: "groundDay", label: "Ground dia", helper: "Terreno/chao de batalha (dia)." },
    { key: "groundNight", label: "Ground noite", helper: "Terreno/chao de batalha (noite)." },
    { key: "ground", label: "Ground base", helper: "Fallback de terreno/chao." },
    { key: "overlayRain", label: "Overlay chuva", helper: "Camada visual de chuva." },
    { key: "overlaySnow", label: "Overlay neve", helper: "Camada visual de neve/granizo." },
    { key: "overlaySandstorm", label: "Overlay areia", helper: "Camada visual de tempestade de areia." },
    { key: "overlaySunny", label: "Overlay ensolarado", helper: "Camada visual de sol intenso." },
    { key: "backgroundRain", label: "Fundo chuva", helper: "Clima Rain." },
    { key: "backgroundSunny", label: "Fundo ensolarado", helper: "Clima Sunny Day." },
    { key: "backgroundSandstorm", label: "Fundo areia", helper: "Clima Sandstorm." },
    { key: "backgroundSnow", label: "Fundo neve", helper: "Clima Snow/Hail." },
    { key: "platformPlayer", label: "Plataforma jogador", helper: "Base/chao do lado do jogador." },
    { key: "platformEnemy", label: "Plataforma inimigo", helper: "Base/chao do lado inimigo." },
  ];

const POKEMON_TYPES = [
  "normal",
  "fire",
  "water",
  "electric",
  "grass",
  "ice",
  "fighting",
  "poison",
  "ground",
  "flying",
  "psychic",
  "bug",
  "rock",
  "ghost",
  "dragon",
  "dark",
  "steel",
  "fairy",
] as const;

const AVAILABLE_SCENARIOS = [
  "beach",
  "cave",
  "city",
  "desert",
  "dojo",
  "forest",
  "grassland",
  "lake",
  "mountain",
  "river",
  "ruins",
  "snow",
  "swamp",
  "vocanion",
];

const NPC_ROLE_LABEL: Record<BiomeNpcRole, string> = {
  nurse: "Enfermeira",
  breeder: "Criador",
  specialist: "Especialista",
  remember: "Remember",
};

const emptyNpcDraft: NpcDraft = {
  role: "nurse",
  name: "",
  imageUrl: "",
  specialistType: "normal",
};

function toInt(value: string, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.trunc(n));
}

function parseUnlockRules(
  unlockRules: unknown
): Pick<
  BiomeForm,
  "unlockType" | "kmRequired" | "missionId" | "partySpeciesIds" | "requiredMoveIds"
> {
  const base = {
    unlockType: "km" as UnlockType,
    kmRequired: "0",
    missionId: "",
    partySpeciesIds: [] as number[],
    requiredMoveIds: [] as string[],
  };
  if (!unlockRules || typeof unlockRules !== "object") return base;

  const root = unlockRules as Record<string, unknown>;
  const rules = Array.isArray(root.rules) ? root.rules : [];
  if (!rules.length) return base;

  const isAllMoves = rules.every((rule) => {
    if (!rule || typeof rule !== "object") return false;
    return String((rule as Record<string, unknown>).type || "") === "move";
  });

  if (isAllMoves) {
    return {
      ...base,
      unlockType: "move",
      requiredMoveIds: rules
        .map((rule) =>
          String((rule as Record<string, unknown>).moveId || "")
            .trim()
            .toLowerCase()
        )
        .filter(Boolean),
    };
  }

  const first = rules[0];
  if (!first || typeof first !== "object") return base;
  const row = first as Record<string, unknown>;
  const type = String(row.type || "");

  if (type === "km") {
    return {
      ...base,
      unlockType: "km",
      kmRequired: String(toInt(String(row.minKm || "0"), 0)),
    };
  }
  if (type === "missionCompleted") {
    const ids = Array.isArray(row.missionIds)
      ? row.missionIds.map((x) => String(x || "").trim()).filter(Boolean)
      : [];
    return { ...base, unlockType: "mission", missionId: ids[0] || "" };
  }
  if (type === "speciesInParty") {
    const ids = Array.isArray(row.speciesIds)
      ? row.speciesIds
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x))
        .map((x) => Math.trunc(x))
        .filter((x) => x > 0)
      : [];
    return { ...base, unlockType: "party", partySpeciesIds: ids.slice(0, 2) };
  }

  return base;
}

function buildUnlockRules(form: BiomeForm): unknown {
  if (form.unlockType === "km") {
    return { op: "OR", rules: [{ type: "km", minKm: toInt(form.kmRequired, 0) }] };
  }
  if (form.unlockType === "mission") {
    return {
      op: "OR",
      rules: [{ type: "missionCompleted", missionIds: [form.missionId], match: "any" }],
    };
  }
  if (form.unlockType === "party") {
    return {
      op: "OR",
      rules: [
        {
          type: "speciesInParty",
          speciesIds: form.partySpeciesIds.slice(0, 2),
          match: "all",
        },
      ],
    };
  }
  return {
    op: "AND",
    rules: form.requiredMoveIds.map((moveId) => ({ type: "move", moveId })),
  };
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl) {
        reject(new Error("data-url-empty"));
        return;
      }
      resolve(dataUrl);
    };
    reader.onerror = () => reject(new Error("data-url-read-error"));
    reader.readAsDataURL(file);
  });
}

async function compressImageToDataUrl(
  file: File,
  maxSide: number,
  quality = 0.72
): Promise<string> {
  const src = await fileToDataUrl(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new window.Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("image-load-error"));
    el.src = src;
  });

  const w = img.width || maxSide;
  const h = img.height || maxSide;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext("2d");
  if (!ctx) return src;
  ctx.drawImage(img, 0, 0, tw, th);
  return canvas.toDataURL("image/jpeg", quality);
}

async function imageFileToStorableDataUrl(
  file: File,
  maxSide: number,
  quality = 0.72
): Promise<string> {
  const mime = String(file.type || "").toLowerCase();
  if (mime.includes("gif")) return fileToDataUrl(file);
  return compressImageToDataUrl(file, maxSide, quality);
}

function parseBattleAssets(raw: unknown): BiomeBattleAssets {
  const base: BiomeBattleAssets = { ...emptyForm.battleAssets };
  if (!raw || typeof raw !== "object") return base;
  const data = raw as Record<string, unknown>;
  BATTLE_ASSET_FIELDS.forEach((field) => {
    base[field.key] = String(data[field.key] || "").trim();
  });
  return base;
}

function buildBattleAssets(assets: BiomeBattleAssets): BiomeBattleAssets {
  const out: BiomeBattleAssets = { ...emptyForm.battleAssets };
  BATTLE_ASSET_FIELDS.forEach((field) => {
    out[field.key] = String(assets[field.key] || "").trim();
  });
  return out;
}

function normalizeNpcList(raw: unknown): BiomeNpcConfig[] {
  if (!Array.isArray(raw)) return [];
  const out: BiomeNpcConfig[] = [];

  raw.forEach((row, index) => {
    if (typeof row === "string") {
      const value = row.trim();
      if (!value) return;
      out.push({
        id: slugify(`${value}-${index + 1}`),
        role: "remember",
        name: value,
        imageUrl: "",
        specialistType: null,
      });
      return;
    }

    if (!row || typeof row !== "object") return;
    const data = row as Record<string, unknown>;
    const roleRaw = String(data.role || "").trim().toLowerCase();
    const role: BiomeNpcRole =
      roleRaw === "nurse" || roleRaw === "breeder" || roleRaw === "specialist" || roleRaw === "remember"
        ? (roleRaw as BiomeNpcRole)
        : "remember";
    const name = String(data.name || "").trim();
    if (!name) return;
    const imageUrl = String(data.imageUrl || "").trim();
    const specialistType =
      role === "specialist" ? String(data.specialistType || "normal").trim().toLowerCase() : null;

    out.push({
      id: slugify(String(data.id || `${name}-${index + 1}`)),
      role,
      name,
      imageUrl,
      specialistType,
    });
  });

  return out;
}

export default function BiomesPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<BiomeDoc[]>([]);
  const [missions, setMissions] = useState<MissionOption[]>([]);
  const [speciesOptions, setSpeciesOptions] = useState<SpeciesOption[]>([]);
  const [moveOptions, setMoveOptions] = useState<MoveOption[]>([]);
  const [form, setForm] = useState<BiomeForm>(emptyForm);
  const [npcDraft, setNpcDraft] = useState<NpcDraft>(emptyNpcDraft);
  const [partySearch, setPartySearch] = useState("");
  const [moveSearch, setMoveSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const npcImageInputRef = useRef<HTMLInputElement | null>(null);

  const filteredSpeciesOptions = useMemo(() => {
    const q = partySearch.trim().toLowerCase();
    if (!q) return speciesOptions;
    return speciesOptions.filter((row) => row.label.toLowerCase().includes(q));
  }, [partySearch, speciesOptions]);

  const filteredMoveOptions = useMemo(() => {
    const q = moveSearch.trim().toLowerCase();
    if (!q) return moveOptions;
    return moveOptions.filter(
      (row) =>
        row.label.toLowerCase().includes(q) || row.id.toLowerCase().includes(q)
    );
  }, [moveOptions, moveSearch]);

  async function loadBiomes() {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, "biomes"));
      const rows: BiomeDoc[] = [];
      snap.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        rows.push({
          id: String(data.id || d.id),
          name: String(data.name || d.id),
          description: String(data.description || ""),
          imageUrl: String(data.imageUrl || ""),
          npcs: normalizeNpcList(data.npcs),
          unlockRules: data.unlockRules ?? null,
          battleAssets: parseBattleAssets(data.battleAssets),
          battleScenarios: Array.isArray(data.battleScenarios)
            ? data.battleScenarios.map(String)
            : [],
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        });
      });

      const merged = new Map<string, BiomeDoc>();

      for (const biome of DEFAULT_ADMIN_BIOMES) {
        merged.set(biome.id, {
          ...biome,
          description: biome.description || "",
          imageUrl: biome.imageUrl || "",
          npcs: [],
          unlockRules: null,
          battleAssets: { ...emptyForm.battleAssets },
          battleScenarios: [],
        });
      }

      for (const biome of rows) {
        merged.set(biome.id, biome);
      }

      const result = Array.from(merged.values()).sort((a, b) =>
        a.name.localeCompare(b.name, "pt-BR")
      );
      setItems(result);
    } finally {
      setLoading(false);
    }
  }

  async function loadMissions() {
    const snap = await getDocs(collection(db, "missionsEvents"));
    const rows: MissionOption[] = snap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      return {
        id: d.id,
        title: String(data.titulo || d.id),
      };
    });
    rows.sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));
    setMissions(rows);
  }

  async function loadCatalogOptions() {
    const response = await fetch("/api/catalog/options", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`catalog-options-http-${response.status}`);
    }
    const data = (await response.json()) as {
      species?: SpeciesOption[];
      moves?: MoveOption[];
    };
    setSpeciesOptions(Array.isArray(data.species) ? data.species : []);
    setMoveOptions(Array.isArray(data.moves) ? data.moves : []);
  }

  useEffect(() => {
    loadBiomes();
    loadMissions();
    loadCatalogOptions().catch(() => {
      setSpeciesOptions([]);
      setMoveOptions([]);
    });
  }, []);

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setNpcDraft(emptyNpcDraft);
  }

  function startEdit(item: BiomeDoc) {
    const parsedUnlock = parseUnlockRules(item.unlockRules);
    setEditingId(item.id);
    setForm({
      id: item.id,
      name: item.name,
      description: item.description || "",
      imageUrl: item.imageUrl || "",
      npcs: item.npcs || [],
      unlockType: parsedUnlock.unlockType,
      kmRequired: parsedUnlock.kmRequired,
      missionId: parsedUnlock.missionId,
      partySpeciesIds: parsedUnlock.partySpeciesIds,
      requiredMoveIds: parsedUnlock.requiredMoveIds,
      battleAssets: parseBattleAssets(item.battleAssets),
      battleScenarios: item.battleScenarios || [],
    });
    setNpcDraft(emptyNpcDraft);
  }

  function addNpc() {
    const name = npcDraft.name.trim();
    if (!name) {
      alert("Informe o nome do NPC.");
      return;
    }
    if (!npcDraft.imageUrl.trim()) {
      alert("Adicione a foto do NPC.");
      return;
    }
    if (npcDraft.role === "specialist" && !npcDraft.specialistType.trim()) {
      alert("Selecione o tipo do Especialista.");
      return;
    }

    const idBase = slugify(`${npcDraft.role}-${name}`) || `npc-${Date.now()}`;
    const payload: BiomeNpcConfig = {
      id: `${idBase}-${Date.now()}`,
      role: npcDraft.role,
      name,
      imageUrl: npcDraft.imageUrl.trim(),
      specialistType:
        npcDraft.role === "specialist"
          ? npcDraft.specialistType.trim().toLowerCase()
          : null,
    };

    setForm((prev) => {
      const duplicate = prev.npcs.some(
        (npc) =>
          npc.role === payload.role &&
          npc.name.trim().toLowerCase() === payload.name.trim().toLowerCase()
      );
      if (duplicate) return prev;
      return { ...prev, npcs: [...prev.npcs, payload] };
    });
    setNpcDraft(emptyNpcDraft);
  }

  function removeNpc(id: string) {
    setForm((prev) => ({ ...prev, npcs: prev.npcs.filter((npc) => npc.id !== id) }));
  }

  function togglePartyPokemon(speciesId: number) {
    setForm((prev) => {
      const exists = prev.partySpeciesIds.includes(speciesId);
      if (exists) {
        return {
          ...prev,
          partySpeciesIds: prev.partySpeciesIds.filter((id) => id !== speciesId),
        };
      }
      if (prev.partySpeciesIds.length >= 2) return prev;
      return { ...prev, partySpeciesIds: [...prev.partySpeciesIds, speciesId] };
    });
  }

  function toggleMove(moveId: string) {
    setForm((prev) => {
      const exists = prev.requiredMoveIds.includes(moveId);
      if (exists) {
        return {
          ...prev,
          requiredMoveIds: prev.requiredMoveIds.filter((id) => id !== moveId),
        };
      }
      return { ...prev, requiredMoveIds: [...prev.requiredMoveIds, moveId] };
    });
  }

  function toggleScenario(scenarioId: string) {
    setForm((prev) => {
      const exists = prev.battleScenarios.includes(scenarioId);
      if (exists) {
        return {
          ...prev,
          battleScenarios: prev.battleScenarios.filter((id) => id !== scenarioId),
        };
      }
      return { ...prev, battleScenarios: [...prev.battleScenarios, scenarioId] };
    });
  }

  async function onPickImage(file: File | null) {
    if (!file) return;
    try {
      const dataUrl = await imageFileToStorableDataUrl(file, 640, 0.74);
      setForm((prev) => ({ ...prev, imageUrl: dataUrl }));
    } catch {
      alert("Nao foi possivel processar a imagem do bioma.");
    }
  }

  async function onPickNpcImage(file: File | null) {
    if (!file) return;
    try {
      const dataUrl = await imageFileToStorableDataUrl(file, 160, 0.72);
      setNpcDraft((prev) => ({ ...prev, imageUrl: dataUrl }));
    } catch {
      alert("Nao foi possivel processar a imagem do NPC.");
    }
  }

  async function onPickBattleAsset(key: BiomeBattleAssetKey, file: File | null) {
    if (!file) return;
    try {
      const dataUrl = await imageFileToStorableDataUrl(file, 1280, 0.8);
      setForm((prev) => ({
        ...prev,
        battleAssets: { ...prev.battleAssets, [key]: dataUrl },
      }));
    } catch {
      alert("Nao foi possivel processar o asset de batalha.");
    }
  }

  function getUnlockSummary(unlockRules: unknown): string {
    const parsed = parseUnlockRules(unlockRules);
    if (parsed.unlockType === "km") return `KM: ${parsed.kmRequired}`;
    if (parsed.unlockType === "mission") return `Missao: ${parsed.missionId || "-"}`;
    if (parsed.unlockType === "party") {
      return `Party: ${parsed.partySpeciesIds.join(", ") || "-"}`;
    }
    return `Movimentos: ${parsed.requiredMoveIds.length}`;
  }

  async function save() {
    const id = slugify(form.id || form.name);
    const name = String(form.name || "").trim();
    if (!id || !name) {
      alert("Preencha ao menos ID ou nome do bioma.");
      return;
    }

    if (form.unlockType === "mission" && !form.missionId) {
      alert("Selecione uma missao para o desbloqueio.");
      return;
    }
    if (form.unlockType === "party" && form.partySpeciesIds.length === 0) {
      alert("Selecione ao menos um Pokemon para desbloqueio por party.");
      return;
    }
    if (form.unlockType === "move" && form.requiredMoveIds.length === 0) {
      alert("Selecione ao menos um movimento para desbloqueio.");
      return;
    }

    setSaving(true);
    try {
      const ref = doc(db, "biomes", id);
      const payload = {
        id,
        name,
        description: String(form.description || ""),
        imageUrl: String(form.imageUrl || ""),
        npcs: form.npcs.map((npc) => ({
          id: npc.id,
          role: npc.role,
          name: npc.name,
          imageUrl: npc.imageUrl,
          specialistType: npc.role === "specialist" ? npc.specialistType || "normal" : null,
        })),
        unlockRules: buildUnlockRules(form),
        battleAssets: buildBattleAssets(form.battleAssets),
        battleScenarios: form.battleScenarios,
        updatedAt: serverTimestamp(),
        ...(editingId ? {} : { createdAt: serverTimestamp() }),
      };
      await setDoc(ref, payload, { merge: true });
      await loadBiomes();
      setEditingId(null);
      setForm(emptyForm);
      setNpcDraft(emptyNpcDraft);
      alert("Bioma salvo com sucesso.");
    } catch (e) {
      console.error("[BiomesPage] save error", e);
      alert("Falha ao salvar bioma. Verifique tamanho da imagem/permissoes.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(itemId: string) {
    const ok = confirm(`Excluir bioma "${itemId}"?`);
    if (!ok) return;
    await deleteDoc(doc(db, "biomes", itemId));
    await loadBiomes();
    if (editingId === itemId) startCreate();
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-100">Catalogo de Biomas</p>
            <p className="text-xs text-slate-300">
              Total: <b>{items.length}</b>
            </p>
          </div>
          <button
            type="button"
            onClick={startCreate}
            className="rounded-md bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-900 hover:bg-white"
          >
            + Novo bioma
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
        <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <h2 className="text-sm font-semibold text-slate-100">
            {editingId ? "Editar bioma" : "Novo bioma"}
          </h2>
          <div className="mt-3 space-y-2">
            <input
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              placeholder="ID (slug) - opcional"
              value={form.id}
              onChange={(e) => setForm((p) => ({ ...p, id: e.target.value }))}
            />
            <input
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              placeholder="Nome do bioma"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            />
            <textarea
              className="min-h-20 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              placeholder="Descricao"
              value={form.description || ""}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
            />

            <div className="rounded-md border border-slate-700 bg-slate-950/50 p-3">
              <p className="text-xs font-semibold text-slate-200">
                1 PARTE: INFORMACOES DO BIOMA
              </p>
              <div className="mt-2 space-y-2">
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*,.gif"
                  className="hidden"
                  onChange={(e) => onPickImage(e.target.files?.[0] || null)}
                />
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  className="rounded-md border border-slate-600 px-3 py-2 text-xs text-slate-100 hover:bg-slate-800"
                >
                  Adicionar Foto
                </button>
                {form.imageUrl ? (
                  <div className="space-y-1">
                    <img
                      src={form.imageUrl}
                      alt={form.name || "Biome"}
                      className="h-12 w-12 rounded object-cover border border-slate-700"
                    />
                    <button
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, imageUrl: "" }))}
                      className="rounded border border-red-500/40 px-2 py-1 text-[11px] text-red-200 hover:bg-red-500/20"
                    >
                      Remover foto
                    </button>
                  </div>
                ) : null}

                <div className="rounded border border-slate-700 bg-slate-950/60 p-2 space-y-2">
                  <select
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-2 text-xs"
                    value={npcDraft.role}
                    onChange={(e) =>
                      setNpcDraft((prev) => ({
                        ...prev,
                        role: (e.target.value as BiomeNpcRole) || "nurse",
                      }))
                    }
                  >
                    <option value="nurse">Enfermeira</option>
                    <option value="breeder">Criador</option>
                    <option value="specialist">Especialista</option>
                    <option value="remember">Remember</option>
                  </select>

                  {npcDraft.role === "specialist" && (
                    <select
                      className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-2 text-xs"
                      value={npcDraft.specialistType}
                      onChange={(e) =>
                        setNpcDraft((prev) => ({ ...prev, specialistType: e.target.value }))
                      }
                    >
                      {POKEMON_TYPES.map((tp) => (
                        <option key={tp} value={tp}>
                          {tp}
                        </option>
                      ))}
                    </select>
                  )}

                  <input
                    className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                    placeholder="Nome do NPC"
                    value={npcDraft.name}
                    onChange={(e) => setNpcDraft((prev) => ({ ...prev, name: e.target.value }))}
                  />

                  <input
                    ref={npcImageInputRef}
                    type="file"
                    accept="image/*,.gif"
                    className="hidden"
                    onChange={(e) => onPickNpcImage(e.target.files?.[0] || null)}
                  />
                  <button
                    type="button"
                    onClick={() => npcImageInputRef.current?.click()}
                    className="rounded-md border border-slate-600 px-3 py-2 text-xs text-slate-100 hover:bg-slate-800"
                  >
                    Adicionar Foto do NPC
                  </button>
                  {npcDraft.imageUrl ? (
                    <img
                      src={npcDraft.imageUrl}
                      alt={npcDraft.name || "NPC"}
                      className="h-12 w-12 rounded object-cover border border-slate-700"
                    />
                  ) : null}

                  <button
                    type="button"
                    onClick={addNpc}
                    className="rounded-md border border-slate-600 px-3 py-2 text-xs text-slate-100 hover:bg-slate-800"
                  >
                    Adicionar NPC
                  </button>
                </div>
                {form.npcs.length ? (
                  <div className="grid gap-2">
                    {form.npcs.map((npc) => (
                      <div key={npc.id} className="flex items-center gap-2 rounded border border-slate-700 bg-slate-900/60 p-2">
                        {npc.imageUrl ? (
                          <img src={npc.imageUrl} alt={npc.name} className="h-8 w-8 rounded object-cover" />
                        ) : (
                          <div className="h-8 w-8 rounded bg-slate-800" />
                        )}
                        <div className="flex-1">
                          <p className="text-xs font-semibold text-slate-100">{npc.name}</p>
                          <p className="text-[11px] text-slate-400">
                            {NPC_ROLE_LABEL[npc.role]}
                            {npc.role === "specialist" && npc.specialistType ? ` | ${npc.specialistType}` : ""}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeNpc(npc.id)}
                          className="rounded border border-red-500/40 px-2 py-1 text-[11px] text-red-200 hover:bg-red-500/20"
                        >
                          Remover
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-md border border-slate-700 bg-slate-950/50 p-3">
              <p className="text-xs font-semibold text-slate-200">
                2 PARTE: FORMA DE DESBLOQUEIO
              </p>
              <div className="mt-2 space-y-2">
                <select
                  className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-2 text-xs"
                  value={form.unlockType}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      unlockType: (e.target.value as UnlockType) || "km",
                    }))
                  }
                >
                  <option value="km">KM</option>
                  <option value="mission">MISSAO</option>
                  <option value="party">POKEMON EM PARTY</option>
                  <option value="move">MOVIMENTO</option>
                </select>

                {form.unlockType === "km" && (
                  <input
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-2 text-xs"
                    placeholder="Quantos KM para desbloquear"
                    value={form.kmRequired}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, kmRequired: e.target.value }))
                    }
                  />
                )}

                {form.unlockType === "mission" && (
                  <select
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-2 text-xs"
                    value={form.missionId}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, missionId: e.target.value }))
                    }
                  >
                    <option value="">Selecione uma missao</option>
                    {missions.map((mission) => (
                      <option key={mission.id} value={mission.id}>
                        {mission.title}
                      </option>
                    ))}
                  </select>
                )}

                {form.unlockType === "party" && (
                  <div className="space-y-2">
                    <p className="text-[11px] text-slate-300">
                      Selecione 1 ou 2 Pokemon
                    </p>
                    <input
                      className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-2 text-xs"
                      placeholder="Buscar Pokemon..."
                      value={partySearch}
                      onChange={(e) => setPartySearch(e.target.value)}
                    />
                    <div className="max-h-44 overflow-y-auto rounded border border-slate-700 p-2">
                      <div className="grid grid-cols-1 gap-1">
                        {filteredSpeciesOptions.map((species) => (
                          <label
                            key={species.id}
                            className="flex items-center gap-2 text-xs text-slate-200"
                          >
                            <input
                              type="checkbox"
                              checked={form.partySpeciesIds.includes(species.id)}
                              onChange={() => togglePartyPokemon(species.id)}
                            />
                            {species.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {form.unlockType === "move" && (
                  <div className="space-y-2">
                    <p className="text-[11px] text-slate-300">
                      Selecione 1 ou mais movimentos
                    </p>
                    <input
                      className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-2 text-xs"
                      placeholder="Buscar movimento..."
                      value={moveSearch}
                      onChange={(e) => setMoveSearch(e.target.value)}
                    />
                    <div className="max-h-44 overflow-y-auto rounded border border-slate-700 p-2">
                      <div className="grid grid-cols-1 gap-1">
                        {filteredMoveOptions.map((move) => (
                          <label
                            key={move.id}
                            className="flex items-center gap-2 text-xs text-slate-200"
                          >
                            <input
                              type="checkbox"
                              checked={form.requiredMoveIds.includes(move.id)}
                              onChange={() => toggleMove(move.id)}
                            />
                            {move.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-md border border-slate-700 bg-slate-950/50 p-3 mt-4">
              <p className="text-xs font-semibold text-slate-200">
                3 PARTE: CENARIOS ALEATORIOS
              </p>
              <p className="mt-1 text-[11px] text-slate-400">
                Selecione os cenarios que podem ser sorteados ao iniciar uma batalha neste bioma.
                Se definidos, um deles vai sobrescrever os assets padrao.
              </p>
              <div className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-2">
                {AVAILABLE_SCENARIOS.map((scenario) => (
                  <label key={scenario} className="flex items-center gap-2 text-xs text-slate-200">
                    <input
                      type="checkbox"
                      checked={form.battleScenarios.includes(scenario)}
                      onChange={() => toggleScenario(scenario)}
                    />
                    {scenario}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={save}
              className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
            >
              {saving ? "Salvando..." : editingId ? "Salvar alteracoes" : "Criar bioma"}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={startCreate}
                className="rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800"
              >
                Cancelar edicao
              </button>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <h2 className="text-sm font-semibold text-slate-100">Biomas cadastrados</h2>

          {loading ? (
            <p className="mt-3 text-sm text-slate-300">Carregando biomas...</p>
          ) : !items.length ? (
            <p className="mt-3 text-sm text-slate-300">Nenhum bioma cadastrado.</p>
          ) : (
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-slate-800 bg-slate-950/60 p-3"
                >
                  <p className="text-xs text-slate-400">{item.id}</p>
                  <h3 className="text-sm font-semibold text-white">{item.name}</h3>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-300">
                    {item.description || "Sem descricao"}
                  </p>
                  <p className="mt-2 text-[11px] text-slate-400">
                    NPCs: {item.npcs?.length || 0}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Cenários de Batalha: {item.battleScenarios?.length || 0}
                  </p>
                  {item.unlockRules ? (
                    <p className="mt-1 line-clamp-2 text-[11px] text-slate-400">
                      {getUnlockSummary(item.unlockRules)}
                    </p>
                  ) : null}
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => startEdit(item)}
                      className="rounded border border-blue-500/40 px-2 py-1 text-[11px] text-blue-200 hover:bg-blue-500/20"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(item.id)}
                      className="rounded border border-red-500/40 px-2 py-1 text-[11px] text-red-200 hover:bg-red-500/20"
                    >
                      Excluir
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
