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
import { imageFileToStorableDataUrl } from "@/lib/imageProcessing";
import {
  LEGACY_SCENARIOS,
  createLegacyScenarioSeed,
  getScenarioDisplayName,
  normalizeScenarioRecord,
} from "@/lib/scenarioCatalog";
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
  acceptsGym?: boolean;
  requiresTrainerLicense?: boolean;
  trainerLicenseProductCode?: string | null;
  updatedAt?: unknown;
  createdAt?: unknown;
};

type UnlockType = "km" | "mission" | "party" | "move";

type BiomeForm = {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  acceptsGym: boolean;
  requiresTicket: boolean;
  ticketProductCode: string;
  requiresTrainerLicense: boolean;
  trainerLicenseProductCode: string;
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

type ScenarioOption = {
  id: string;
  name: string;
  processedImageUrl: string;
  isActive: boolean;
  isSpecial: boolean;
  specialType: string | null;
};

type LicenseProductOption = {
  code: string;
  name: string;
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
  acceptsGym: false,
  requiresTicket: false,
  ticketProductCode: "biome-ticket",
  requiresTrainerLicense: false,
  trainerLicenseProductCode: "",
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

type NpcOption = {
  id: string;
  name: string;
  role: BiomeNpcRole;
  imageUrl: string;
  specialistType?: string | null;
};

const NPC_ROLE_LABEL: Record<BiomeNpcRole, string> = {
  nurse: "Enfermeira",
  breeder: "Criador",
  specialist: "Especialista",
  remember: "Remember",
  policial: "Policial",
  ladrao: "Ladrao",
  enfermeiro: "Enfermeiro",
  criador: "Criador",
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
    const allowedRoles: BiomeNpcRole[] = [
      "nurse",
      "breeder",
      "specialist",
      "remember",
      "policial",
      "ladrao",
      "enfermeiro",
      "criador",
    ];
    const role: BiomeNpcRole = allowedRoles.includes(roleRaw as BiomeNpcRole)
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
  const [availableNpcs, setAvailableNpcs] = useState<NpcOption[]>([]);
  const [availableScenarios, setAvailableScenarios] = useState<ScenarioOption[]>([]);
  const [licenseProducts, setLicenseProducts] = useState<LicenseProductOption[]>([]);
  const [speciesOptions, setSpeciesOptions] = useState<SpeciesOption[]>([]);
  const [moveOptions, setMoveOptions] = useState<MoveOption[]>([]);
  const [form, setForm] = useState<BiomeForm>(emptyForm);
  const [partySearch, setPartySearch] = useState("");
  const [moveSearch, setMoveSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

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
          acceptsGym: Boolean(data.acceptsGym),
          requiresTicket: Boolean(data.requiresTicket),
          ticketProductCode: typeof data.ticketProductCode === "string" ? data.ticketProductCode : null,
          requiresTrainerLicense: Boolean(data.requiresTrainerLicense),
          trainerLicenseProductCode:
            typeof data.trainerLicenseProductCode === "string" ? data.trainerLicenseProductCode : null,
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
          acceptsGym: Boolean((biome as Record<string, unknown>).acceptsGym),
          requiresTicket: Boolean(biome.requiresTicket),
          ticketProductCode: biome.ticketProductCode || "biome-ticket",
          requiresTrainerLicense: false,
          trainerLicenseProductCode: null,
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

  async function loadNpcs() {
    const snap = await getDocs(collection(db, "npcs"));
    const rows: NpcOption[] = snap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      const roleRaw = String(data.role || "remember").trim().toLowerCase() as BiomeNpcRole;
      return {
        id: String(data.id || d.id),
        name: String(data.nome || data.name || d.id),
        role: roleRaw,
        imageUrl: String(data.imageUrl || ""),
        specialistType: typeof data.specialistType === "string" ? data.specialistType : null,
      };
    });
    rows.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    setAvailableNpcs(rows);
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

  async function loadScenarios() {
    const snap = await getDocs(collection(db, "scenarios"));
    const merged = new Map<string, ScenarioOption>();

    LEGACY_SCENARIOS.forEach((scenarioId) => {
      const seed = createLegacyScenarioSeed(scenarioId);
      merged.set(seed.id, {
        id: seed.id,
        name: seed.name,
        processedImageUrl: seed.processedImageUrl,
        isActive: seed.isActive,
        isSpecial: seed.isSpecial,
        specialType: seed.specialType,
      });
    });

    snap.forEach((row) => {
      const item = normalizeScenarioRecord(row.id, row.data());
      merged.set(item.id, {
        id: item.id,
        name: item.name || getScenarioDisplayName(item.id),
        processedImageUrl: item.processedImageUrl || item.imageUrl || "",
        isActive: item.isActive,
        isSpecial: item.isSpecial,
        specialType: item.specialType,
      });
    });

    setAvailableScenarios(
      Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
    );
  }

  async function loadLicenseProducts() {
    const snap = await getDocs(collection(db, "monetizationProducts"));
    const rows = snap.docs
      .map((docSnap) => {
        const data = docSnap.data() as Record<string, unknown>;
        const type = String(data.type || "").trim().toLowerCase();
        const configuration =
          data.configuration && typeof data.configuration === "object"
            ? (data.configuration as Record<string, unknown>)
            : {};
        if (type !== "trainer_license" && String(configuration.kind || "") !== "trainer_license") {
          return null;
        }
        return {
          code: String(data.code || docSnap.id).trim().toLowerCase(),
          name: String(data.name || data.nome || docSnap.id),
        };
      })
      .filter((row): row is LicenseProductOption => Boolean(row?.code))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

    setLicenseProducts(rows);
  }

  useEffect(() => {
    loadBiomes();
    loadMissions();
    loadNpcs();
    loadScenarios();
    loadLicenseProducts();
    loadCatalogOptions().catch(() => {
      setSpeciesOptions([]);
      setMoveOptions([]);
    });
  }, []);

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm);
  }

  function startEdit(item: BiomeDoc) {
    const parsedUnlock = parseUnlockRules(item.unlockRules);
    setEditingId(item.id);
    setForm({
      id: item.id,
      name: item.name,
      description: item.description || "",
      imageUrl: item.imageUrl || "",
      acceptsGym: Boolean((item as Record<string, unknown>).acceptsGym),
      requiresTicket: Boolean(item.requiresTicket),
      ticketProductCode: item.ticketProductCode || "biome-ticket",
      requiresTrainerLicense: Boolean(item.requiresTrainerLicense),
      trainerLicenseProductCode: item.trainerLicenseProductCode || "",
      npcs: item.npcs || [],
      unlockType: parsedUnlock.unlockType,
      kmRequired: parsedUnlock.kmRequired,
      missionId: parsedUnlock.missionId,
      partySpeciesIds: parsedUnlock.partySpeciesIds,
      requiredMoveIds: parsedUnlock.requiredMoveIds,
      battleAssets: parseBattleAssets(item.battleAssets),
      battleScenarios: item.battleScenarios || [],
    });
  }

  function removeNpc(id: string) {
    setForm((prev) => ({ ...prev, npcs: prev.npcs.filter((npc) => npc.id !== id) }));
  }

  function toggleNpcSelection(option: NpcOption) {
    setForm((prev) => {
      const exists = prev.npcs.some((npc) => npc.id === option.id);
      if (exists) {
        return { ...prev, npcs: prev.npcs.filter((npc) => npc.id !== option.id) };
      }
      return {
        ...prev,
        npcs: [
          ...prev.npcs,
          {
            id: option.id,
            role: option.role,
            name: option.name,
            imageUrl: option.imageUrl,
            specialistType: option.specialistType || null,
          },
        ],
      };
    });
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
    if (form.requiresTrainerLicense && !form.trainerLicenseProductCode) {
      alert("Selecione qual licenca libera este bioma.");
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
        acceptsGym: !!form.acceptsGym,
        gymEnabled: !!form.acceptsGym,
        requiresTicket: !!form.requiresTicket,
        ticketProductCode: form.requiresTicket ? String(form.ticketProductCode || "biome-ticket").trim().toLowerCase() : null,
        requiresTrainerLicense: !!form.requiresTrainerLicense,
        trainerLicenseProductCode: form.requiresTrainerLicense
          ? String(form.trainerLicenseProductCode || "").trim().toLowerCase()
          : null,
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

                <label className="flex items-center gap-2 text-xs text-slate-200">
                  <input
                    type="checkbox"
                    checked={form.acceptsGym}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, acceptsGym: e.target.checked }))
                    }
                  />
                  Este bioma aceita GYM
                </label>

                <label className="flex items-center gap-2 text-xs text-slate-200">
                  <input
                    type="checkbox"
                    checked={form.requiresTicket}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, requiresTicket: e.target.checked }))
                    }
                  />
                  Este bioma exige ticket
                </label>
                {form.requiresTicket ? (
                  <input
                    className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                    placeholder="Codigo do produto de ticket"
                    value={form.ticketProductCode}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, ticketProductCode: e.target.value }))
                    }
                  />
                ) : null}

                <label className="flex items-center gap-2 text-xs text-slate-200">
                  <input
                    type="checkbox"
                    checked={form.requiresTrainerLicense}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        requiresTrainerLicense: e.target.checked,
                        trainerLicenseProductCode: e.target.checked ? prev.trainerLicenseProductCode : "",
                      }))
                    }
                  />
                  Este bioma e exclusivo por licenca
                </label>
                {form.requiresTrainerLicense ? (
                  <select
                    className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                    value={form.trainerLicenseProductCode}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, trainerLicenseProductCode: e.target.value }))
                    }
                  >
                    <option value="">Selecione a licenca</option>
                    {licenseProducts.map((license) => (
                      <option key={license.code} value={license.code}>
                        {license.name} ({license.code})
                      </option>
                    ))}
                  </select>
                ) : null}

                <div className="rounded border border-slate-700 bg-slate-950/60 p-2 space-y-2">
                  <p className="text-[11px] text-slate-300">
                    Selecione os NPCs ja cadastrados no menu de NPCs.
                  </p>
                  <div className="max-h-44 overflow-y-auto rounded border border-slate-700 p-2">
                    <div className="grid grid-cols-1 gap-2">
                      {availableNpcs.map((npc) => {
                        const checked = form.npcs.some((item) => item.id === npc.id);
                        return (
                          <label
                            key={npc.id}
                            className="flex items-center gap-2 rounded border border-slate-800 bg-slate-900/60 p-2 text-xs text-slate-200"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleNpcSelection(npc)}
                            />
                            {npc.imageUrl ? (
                              <img src={npc.imageUrl} alt={npc.name} className="h-8 w-8 rounded object-cover" />
                            ) : (
                              <div className="h-8 w-8 rounded bg-slate-800" />
                            )}
                            <div className="flex-1">
                              <p className="font-semibold text-slate-100">{npc.name}</p>
                              <p className="text-[11px] text-slate-400">
                                {NPC_ROLE_LABEL[npc.role] || npc.role}
                                {npc.role === "specialist" && npc.specialistType ? ` | ${npc.specialistType}` : ""}
                              </p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
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
              <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                {availableScenarios.map((scenario) => {
                  const checked = form.battleScenarios.includes(scenario.id);
                  return (
                    <label
                      key={scenario.id}
                      className={`flex items-center gap-3 rounded border p-2 text-xs transition ${
                        checked
                          ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-100"
                          : "border-slate-700 bg-slate-950/60 text-slate-200"
                      } ${scenario.isActive ? "" : "opacity-60"}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleScenario(scenario.id)}
                      />
                      {scenario.processedImageUrl ? (
                        <img
                          src={scenario.processedImageUrl}
                          alt={scenario.name}
                          className="h-10 w-16 rounded border border-slate-700 object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-16 items-center justify-center rounded border border-dashed border-slate-700 bg-slate-900 text-[10px] uppercase tracking-[0.2em] text-slate-500">
                          Legacy
                        </div>
                      )}
                      <div className="flex-1">
                        <p className="font-semibold text-slate-100">{scenario.name}</p>
                        <p className="text-[11px] text-slate-400">
                          {scenario.isSpecial ? `Especial: ${scenario.specialType}` : "Visual comum"}
                          {!scenario.isActive ? " | Inativo" : ""}
                        </p>
                      </div>
                    </label>
                  );
                })}
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
                    Aceita GYM: {(item as Record<string, unknown>).acceptsGym ? "Sim" : "Nao"}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Licenca: {item.requiresTrainerLicense ? item.trainerLicenseProductCode || "Obrigatoria" : "Nao"}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    CenÃ¡rios de Batalha: {item.battleScenarios?.length || 0}
                  </p>
                  {item.battleScenarios?.length ? (
                    <p className="mt-1 line-clamp-2 text-[11px] text-slate-400">
                      {item.battleScenarios
                        .map(
                          (scenarioId) =>
                            availableScenarios.find((entry) => entry.id === scenarioId)?.name ||
                            getScenarioDisplayName(scenarioId)
                        )
                        .join(", ")}
                    </p>
                  ) : null}
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

