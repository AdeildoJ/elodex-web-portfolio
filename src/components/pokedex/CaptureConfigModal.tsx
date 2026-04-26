"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { DEFAULT_ADMIN_BIOMES, type AdminBiome } from "@/data/biomes";
import type { PokemonSpecies } from "@/components/pokedex/pokedexTypes";
import movesJson from "@/data/moves.json";
import pokemonMovesJson from "@/data/pokemonMoves.json";
import pokemonSpeciesJson from "@/data/pokemon/pokemonSpecies.json";

type Step = "root" | "individual" | "group";
type IndividualConfig = {
  speciesId: string;
  speciesName: string;
  isSpecialMode: boolean;
  minLevel: number | null;
  maxLevel: number | null;
  biomeIds: string[];
  captureLimit: number | null;
  unlimitedCaptures: boolean;
  encounterRate: number | null;
  shinyRate: number | null;
  specialAbility: string;
  specialNature: string;
  specialMoves: string[];
  specialIVs: Record<"hp" | "atk" | "def" | "spa" | "spd" | "spe", number | null>;
  specialEVs: Record<"hp" | "atk" | "def" | "spa" | "spd" | "spe", number | null>;
  learnsetMaxGeneration: number | null;
  learnsetBlockedSources: Array<"level-up" | "machine" | "egg" | "tutor">;
};
type GroupRuleConfig = {
  minLevel: number;
  maxLevel: number;
  abilityMode: "random" | "fixed";
  fixedAbility: string;
  natureMode: "random" | "fixed";
  fixedNature: string;
  randomEV: boolean;
  randomIV: boolean;
  randomMoves: boolean;
};
type CaptureGroup = {
  id: string;
  versionId: string;
  name: string;
  speciesIds: number[];
  biomeIds: string[];
  config: GroupRuleConfig;
};

interface CaptureConfigModalProps {
  open: boolean;
  onClose: () => void;
  markedPokemon: PokemonSpecies[];
  versionId: string;
}

const DEFAULT_GROUP_CONFIG: GroupRuleConfig = { minLevel: 1, maxLevel: 50, abilityMode: "random", fixedAbility: "", natureMode: "random", fixedNature: "", randomEV: true, randomIV: true, randomMoves: true };
const NATURES = ["Hardy","Lonely","Brave","Adamant","Naughty","Bold","Docile","Relaxed","Impish","Lax","Timid","Hasty","Serious","Jolly","Naive","Modest","Mild","Quiet","Bashful","Rash","Calm","Gentle","Sassy","Careful","Quirky"];
const LEARNSET_SOURCES: Array<"level-up" | "machine" | "egg" | "tutor"> = ["level-up", "machine", "egg", "tutor"];

const clamp = (v: number | null, min: number, max: number) => (v == null || Number.isNaN(v) ? null : Math.min(max, Math.max(min, v)));
function parseSpeciesNumber(pk: PokemonSpecies): number | null {
  const byId = Number(pk.id);
  if (Number.isFinite(byId) && byId > 0) return Math.trunc(byId);
  const byDex = Number(pk.dexNumber);
  if (Number.isFinite(byDex) && byDex > 0) return Math.trunc(byDex);
  return null;
}
const defaultIndividual = (pk: PokemonSpecies): IndividualConfig => ({
  speciesId: String(pk.id),
  speciesName: pk.name,
  isSpecialMode: false,
  minLevel: 1,
  maxLevel: 30,
  biomeIds: [],
  captureLimit: 10,
  unlimitedCaptures: false,
  encounterRate: 10,
  shinyRate: 0.05,
  specialAbility: "",
  specialNature: "",
  specialMoves: ["", "", "", ""],
  specialIVs: { hp: null, atk: null, def: null, spa: null, spd: null, spe: null },
  specialEVs: { hp: null, atk: null, def: null, spa: null, spd: null, spe: null },
  learnsetMaxGeneration: null,
  learnsetBlockedSources: [],
});
const cfgDocId = (versionId: string, speciesId: string) => `${versionId}_${speciesId}`;
const sanitizeGroupName = (n: string) => n.trim().toLowerCase().replace(/[^a-z0-9\s-_]/g, "").replace(/\s+/g, "-").slice(0, 40);
const groupDocId = (versionId: string, name: string) => `${versionId}_${sanitizeGroupName(name) || `grupo-${Date.now()}`}`;
function dedupeGroups(groups: CaptureGroup[]): CaptureGroup[] {
  return groups.map((g) => ({ ...g, speciesIds: Array.from(new Set(g.speciesIds)) }));
}

export default function CaptureConfigModal({ open, onClose, markedPokemon, versionId }: CaptureConfigModalProps) {
  const [step, setStep] = useState<Step>("root");
  const [loading, setLoading] = useState(false);
  const [savingIndividual, setSavingIndividual] = useState(false);
  const [savingGroups, setSavingGroups] = useState(false);
  const [adminBiomes, setAdminBiomes] = useState<AdminBiome[]>(DEFAULT_ADMIN_BIOMES);
  const [individualConfigs, setIndividualConfigs] = useState<Record<string, IndividualConfig>>({});
  const [selectedIndividualSpeciesId, setSelectedIndividualSpeciesId] = useState("");
  const [groups, setGroups] = useState<CaptureGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupSpeciesIds, setNewGroupSpeciesIds] = useState<number[]>([]);
  const [biomeConfigById, setBiomeConfigById] = useState<Record<string, number[]>>({});
  const [viewBiomeId, setViewBiomeId] = useState<string>(DEFAULT_ADMIN_BIOMES[0]?.id ?? "");

  const pokemonCatalogById = useMemo(() => {
    const map = new Map<number, PokemonSpecies>();
    const root = pokemonSpeciesJson as Record<string, any>;
    for (const [key, v] of Object.entries(root)) {
      const idNum = Number(v?.id ?? key);
      if (!Number.isFinite(idNum) || idNum <= 0) continue;
      const id = Math.trunc(idNum);
      map.set(id, {
        id: String(id),
        dexNumber: id,
        name: String(v?.name ?? `#${id}`),
        types: Array.isArray(v?.types) ? v.types : [],
      } as PokemonSpecies);
    }
    return map;
  }, []);

  const markedWithNumbers = useMemo(() => markedPokemon.map((pokemon) => ({ pokemon, speciesNumber: parseSpeciesNumber(pokemon) })).filter((v): v is { pokemon: PokemonSpecies; speciesNumber: number } => v.speciesNumber != null), [markedPokemon]);
  const speciesIdToName = useMemo(() => new Map(markedWithNumbers.map((v) => [v.speciesNumber, v.pokemon.name])), [markedWithNumbers]);
  const speciesInGroup = useMemo(() => {
    const map = new Map<number, number>();
    for (const g of groups) {
      for (const s of g.speciesIds) {
        map.set(s, (map.get(s) ?? 0) + 1);
      }
    }
    return map;
  }, [groups]);
  const biomeSpeciesIds = useMemo(
    () => Array.from(new Set(Object.values(biomeConfigById).flatMap((ids) => ids))),
    [biomeConfigById]
  );
  const individualPokemon = useMemo(() => {
    const byId = new Map<string, PokemonSpecies>();
    for (const pk of markedPokemon) byId.set(String(pk.id), pk);
    for (const sid of biomeSpeciesIds) {
      if (!byId.has(String(sid)) && pokemonCatalogById.has(sid)) {
        byId.set(String(sid), pokemonCatalogById.get(sid)!);
      }
    }
    return Array.from(byId.values()).filter((pk) => {
      const num = parseSpeciesNumber(pk);
      return num == null ? true : !speciesInGroup.has(num);
    });
  }, [markedPokemon, biomeSpeciesIds, pokemonCatalogById, speciesInGroup]);

  const selectedIndividualConfig = selectedIndividualSpeciesId ? individualConfigs[selectedIndividualSpeciesId] ?? null : null;
  const selectedGroup = groups.find((g) => g.id === selectedGroupId) ?? null;
  const specialMoveOptions = useMemo(() => {
    if (!selectedIndividualSpeciesId) return [] as { id: string; label: string }[];
    const pk = individualPokemon.find((p) => String(p.id) === selectedIndividualSpeciesId);
    if (!pk) return [] as { id: string; label: string }[];

    const anyPk = pk as any;
    const keys = Array.from(
      new Set(
        [String(pk.id), String(pk.dexNumber), anyPk.baseSpeciesId ? String(anyPk.baseSpeciesId) : null].filter(
          (v): v is string => !!v
        )
      )
    );

    const learnsetRoot = pokemonMovesJson as Record<string, { moves?: Array<{ moveId: string }> }>;
    const learnedMoveIds = new Set<string>();
    for (const key of keys) {
      const entry = learnsetRoot[key];
      if (!entry?.moves) continue;
      for (const move of entry.moves) {
        if (move?.moveId) learnedMoveIds.add(String(move.moveId));
      }
    }

    const moveRoot = movesJson as Record<string, { name?: string }>;
    const learned = Array.from(learnedMoveIds)
      .map((id) => ({ id, label: moveRoot[id]?.name ?? id }))
      .sort((a, b) => a.label.localeCompare(b.label));

    if (learned.length > 0) return learned;

    // Fallback: alguns speciesIds no pokemonMoves.json estao sem learnset.
    // Nesse caso libera o catalogo global para nao bloquear a configuracao.
    return Object.entries(moveRoot)
      .map(([id, data]) => ({ id, label: data?.name ?? id }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [selectedIndividualSpeciesId, individualPokemon]);
  const specialAbilityOptions = useMemo(() => {
    if (!selectedIndividualSpeciesId) return [] as { id: string; label: string }[];
    const pk = individualPokemon.find((p) => String(p.id) === selectedIndividualSpeciesId);
    if (!pk) return [] as { id: string; label: string }[];

    const raw = (pk as any).abilities;
    const out: Array<{ id: string; label: string }> = [];
    const seen = new Set<string>();

    const pushAbility = (idRaw: unknown, hidden: boolean) => {
      const id = String(idRaw ?? "").trim();
      if (!id || seen.has(id)) return;
      seen.add(id);
      const labelBase = id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      out.push({ id, label: hidden ? `${labelBase} (Hidden)` : labelBase });
    };

    if (Array.isArray(raw)) {
      for (const a of raw) {
        const aid = (a as any)?.abilityId ?? (a as any)?.id ?? (a as any)?.name ?? a;
        const hidden = Boolean((a as any)?.isHidden);
        pushAbility(aid, hidden);
      }
    } else if (raw && typeof raw === "object") {
      const normal = Array.isArray((raw as any).normal) ? (raw as any).normal : [];
      const hidden = Array.isArray((raw as any).hidden) ? (raw as any).hidden : [];
      for (const a of normal) pushAbility((a as any)?.abilityId ?? (a as any)?.id ?? (a as any)?.name ?? a, false);
      for (const a of hidden) pushAbility((a as any)?.abilityId ?? (a as any)?.id ?? (a as any)?.name ?? a, true);
    }

    return out.sort((a, b) => a.label.localeCompare(b.label));
  }, [selectedIndividualSpeciesId, individualPokemon]);
  const speciesNameById = useMemo(() => {
    const map = new Map<number, string>();
    const root = pokemonSpeciesJson as Record<string, { name?: string; id?: number | string }>;
    for (const [key, v] of Object.entries(root)) {
      const id = Number(v?.id ?? key);
      if (Number.isFinite(id) && id > 0) map.set(Math.trunc(id), String(v?.name ?? key));
    }
    return map;
  }, []);

  const viewedBiomeSpecies = useMemo(() => {
    const ids = biomeConfigById[viewBiomeId] ?? [];
    return ids.map((id) => ({ id, name: speciesNameById.get(id) ?? `#${id}` }));
  }, [biomeConfigById, viewBiomeId, speciesNameById]);

  const biomeConfigDocId = (biomeId: string) => `${versionId}_${biomeId}`;

  useEffect(() => {
    if (!adminBiomes.length) return;
    if (!viewBiomeId || !adminBiomes.some((b) => b.id === viewBiomeId)) {
      setViewBiomeId(adminBiomes[0].id);
    }
  }, [adminBiomes, viewBiomeId]);

  async function loadAdminBiomes(): Promise<AdminBiome[]> {
    try {
      const snap = await getDocs(collection(db, "biomes"));
      if (snap.empty) {
        setAdminBiomes(DEFAULT_ADMIN_BIOMES);
        return DEFAULT_ADMIN_BIOMES;
      }
      const rows: AdminBiome[] = [];
      snap.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        const id = String(data.id || d.id).trim();
        const name = String(data.name || id).trim();
        if (!id || !name) return;
        rows.push({ id, name });
      });
      rows.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
      const next = rows.length ? rows : DEFAULT_ADMIN_BIOMES;
      setAdminBiomes(next);
      return next;
    } catch {
      setAdminBiomes(DEFAULT_ADMIN_BIOMES);
      return DEFAULT_ADMIN_BIOMES;
    }
  }

  function toSpeciesNumberList(input: unknown): number[] {
    if (!Array.isArray(input)) return [];
    return input
      .map(Number)
      .filter((v) => Number.isFinite(v) && v > 0)
      .map((v) => Math.trunc(v));
  }

  async function getBiomeSpeciesFromSubcollections(biomeId: string): Promise<number[] | null> {
    const docId = biomeConfigDocId(biomeId);
    try {
      const [individualSnap, groupsSnap] = await Promise.all([
        getDocs(collection(db, "biomeEncounterConfig", docId, "individual")),
        getDocs(collection(db, "biomeEncounterConfig", docId, "groups")),
      ]);

      const set = new Set<number>();
      for (const d of individualSnap.docs) {
        const data = d.data() as { speciesId?: unknown };
        const speciesId = Number(data.speciesId ?? d.id);
        if (Number.isFinite(speciesId) && speciesId > 0) set.add(Math.trunc(speciesId));
      }
      for (const d of groupsSnap.docs) {
        const data = d.data() as { speciesIds?: unknown };
        for (const speciesId of toSpeciesNumberList(data.speciesIds)) set.add(speciesId);
      }

      if (!individualSnap.empty || !groupsSnap.empty) return Array.from(set);
      return null;
    } catch {
      return null;
    }
  }

  async function syncBiomeRootSpeciesIndex(biomeId: string) {
    const biome = adminBiomes.find((b) => b.id === biomeId);
    if (!biome) return;
    const docId = biomeConfigDocId(biomeId);
    const subSpecies = await getBiomeSpeciesFromSubcollections(biomeId);
    const nextSpecies = subSpecies ?? [];
    await setDoc(
      doc(db, "biomeEncounterConfig", docId),
      {
        versionId,
        biomeId: biome.id,
        biomeName: biome.name,
        speciesIds: nextSpecies,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  async function loadAllBiomeSpeciesMap(biomeList: AdminBiome[] = adminBiomes) {
    const next: Record<string, number[]> = {};
    if (!biomeList.length) return next;
    await Promise.all(
      biomeList.map(async (biome) => {
        const subSpecies = await getBiomeSpeciesFromSubcollections(biome.id);
        if (subSpecies) {
          next[biome.id] = subSpecies;
          return;
        }
        const snap = await getDoc(doc(db, "biomeEncounterConfig", biomeConfigDocId(biome.id)));
        const data = snap.exists() ? (snap.data() as { speciesIds?: unknown }) : { speciesIds: [] };
        next[biome.id] = toSpeciesNumberList(data.speciesIds);
      })
    );
    return next;
  }

  async function refreshBiomeConfig() {
    const next = await loadAllBiomeSpeciesMap();
    setBiomeConfigById(next);
  }

  async function removePokemonFromBiome(speciesId: number, biomeId: string) {
    try {
      const biomeDoc = biomeConfigDocId(biomeId);
      await deleteDoc(doc(db, "biomeEncounterConfig", biomeDoc, "individual", String(speciesId)));

      const groupsSnap = await getDocs(collection(db, "biomeEncounterConfig", biomeDoc, "groups"));
      await Promise.all(
        groupsSnap.docs.map(async (groupDoc) => {
          const data = groupDoc.data() as { speciesIds?: unknown };
          const curr = toSpeciesNumberList(data.speciesIds);
          if (!curr.includes(speciesId)) return;
          const next = curr.filter((id) => id !== speciesId);
          await setDoc(
            groupDoc.ref,
            { speciesIds: next, updatedAt: serverTimestamp() },
            { merge: true }
          );
        })
      );

      await syncBiomeRootSpeciesIndex(biomeId);
      await refreshBiomeConfig();
    } catch (err) {
      console.error("Erro ao remover pokemon do bioma:", err);
      alert("Não foi possível remover do bioma.");
    }
  }

  async function editPokemonFromBiome(speciesId: number) {
    const inGroups = (speciesInGroup.get(speciesId) ?? 0) > 0;
    if (inGroups) {
      const owner = groups.find((g) => g.speciesIds.includes(speciesId));
      setStep("group");
      if (owner) setSelectedGroupId(owner.id);
      return;
    }

    const speciesIdStr = String(speciesId);
    if (!individualConfigs[speciesIdStr]) {
      const pk = pokemonCatalogById.get(speciesId) ??
        ({ id: speciesIdStr, dexNumber: speciesId, name: speciesNameById.get(speciesId) ?? `#${speciesId}`, types: [] } as unknown as PokemonSpecies);
      const base = defaultIndividual(pk);
      try {
        const snap = await getDoc(doc(db, "pokedexConfig", cfgDocId(versionId, speciesIdStr)));
        const data = snap.exists() ? (snap.data() as any) : null;
        const loaded: IndividualConfig = {
          ...base,
          speciesName: data?.speciesName ?? base.speciesName,
          isSpecialMode: data?.isSpecial === true,
          minLevel: typeof data?.minLevel === "number" ? data.minLevel : base.minLevel,
          maxLevel: typeof data?.maxLevel === "number" ? data.maxLevel : base.maxLevel,
          captureLimit: typeof data?.captureLimit === "number" ? data.captureLimit : base.captureLimit,
          unlimitedCaptures: data?.unlimitedCaptures === true,
          encounterRate: typeof data?.encounterRate === "number" ? data.encounterRate : base.encounterRate,
          shinyRate: typeof data?.shinyRate === "number" ? data.shinyRate : base.shinyRate,
          biomeIds: adminBiomes.filter((b) => (biomeConfigById[b.id] ?? []).includes(speciesId)).map((b) => b.id),
          specialAbility: typeof data?.specialAbility === "string" ? data.specialAbility : base.specialAbility,
          specialNature: typeof data?.specialNature === "string" ? data.specialNature : base.specialNature,
          specialMoves: Array.isArray(data?.specialMoves) ? [...data.specialMoves.map((v: unknown) => String(v ?? "")), "", "", "", ""].slice(0, 4) : base.specialMoves,
          specialIVs: typeof data?.specialIVs === "object" && data?.specialIVs ? { ...base.specialIVs, ...(data.specialIVs as object) } as IndividualConfig["specialIVs"] : base.specialIVs,
          specialEVs: typeof data?.specialEVs === "object" && data?.specialEVs ? { ...base.specialEVs, ...(data.specialEVs as object) } as IndividualConfig["specialEVs"] : base.specialEVs,
          learnsetMaxGeneration:
            typeof data?.learnsetConstraints?.maxGeneration === "number"
              ? data.learnsetConstraints.maxGeneration
              : base.learnsetMaxGeneration,
          learnsetBlockedSources: Array.isArray(data?.learnsetConstraints?.blockedSources)
            ? data.learnsetConstraints.blockedSources
                .map((v: unknown) => String(v ?? ""))
                .filter((v: string) => LEARNSET_SOURCES.includes(v as any)) as IndividualConfig["learnsetBlockedSources"]
            : base.learnsetBlockedSources,
        };
        setIndividualConfigs((prev) => ({ ...prev, [speciesIdStr]: loaded }));
      } catch {
        setIndividualConfigs((prev) => ({ ...prev, [speciesIdStr]: base }));
      }
    }

    setSelectedIndividualSpeciesId(speciesIdStr);
    setStep("individual");
  }

  useEffect(() => {
    if (!open) return;
    const hasSelected = individualPokemon.some((pk) => String(pk.id) === selectedIndividualSpeciesId);
    if (!hasSelected) {
      setSelectedIndividualSpeciesId(individualPokemon[0]?.id ? String(individualPokemon[0].id) : "");
    }
  }, [open, individualPokemon, selectedIndividualSpeciesId]);

  useEffect(() => {
    if (!open) return;
    setStep("root");
    setLoading(true);
    let cancelled = false;
    (async () => {
      try {
        const loadedBiomes = await loadAdminBiomes();
        const biomeSpeciesById = await loadAllBiomeSpeciesMap(loadedBiomes);

        const groupsSnap = await getDocs(query(collection(db, "captureConfigGroups"), where("versionId", "==", versionId)));
        const loadedGroups: CaptureGroup[] = groupsSnap.docs.map((d) => {
          const data = d.data() as {
            versionId?: string;
            name?: string;
            speciesIds?: unknown;
            biomeIds?: unknown;
            config?: Partial<GroupRuleConfig>;
          };
          const speciesIds = Array.isArray(data.speciesIds) ? data.speciesIds.map(Number).filter((v) => Number.isFinite(v) && v > 0).map((v) => Math.trunc(v)) : [];
          const biomeIds = Array.isArray(data.biomeIds)
            ? data.biomeIds.map(String).filter((id) => loadedBiomes.some((b) => b.id === id))
            : [];
          return {
            id: d.id,
            versionId: data.versionId ?? versionId,
            name: data.name ?? d.id,
            speciesIds,
            biomeIds,
            config: { ...DEFAULT_GROUP_CONFIG, ...(data.config ?? {}) },
          };
        });

        const configs: Record<string, IndividualConfig> = {};
        await Promise.all(markedPokemon.map(async (pk) => {
          const base = defaultIndividual(pk);
          const speciesNumber = parseSpeciesNumber(pk);
          const cfgLookupId = speciesNumber != null ? String(speciesNumber) : String(pk.id);
          const snap = await getDoc(doc(db, "pokedexConfig", cfgDocId(versionId, cfgLookupId)));
          const data = snap.exists()
            ? (snap.data() as {
                isSpecial?: boolean;
                minLevel?: unknown;
                maxLevel?: unknown;
                captureLimit?: unknown;
                unlimitedCaptures?: unknown;
                encounterRate?: unknown;
                shinyRate?: unknown;
                speciesName?: string;
                specialAbility?: unknown;
                specialNature?: unknown;
                specialMoves?: unknown;
                specialIVs?: unknown;
                specialEVs?: unknown;
                learnsetConstraints?: {
                  maxGeneration?: unknown;
                  blockedSources?: unknown;
                };
              })
            : null;
          const next: IndividualConfig = {
            ...base,
            speciesName: data?.speciesName ?? base.speciesName,
            isSpecialMode: data?.isSpecial === true,
            minLevel: typeof data?.minLevel === "number" ? data.minLevel : data?.minLevel != null ? Number(data.minLevel) : base.minLevel,
            maxLevel: typeof data?.maxLevel === "number" ? data.maxLevel : data?.maxLevel != null ? Number(data.maxLevel) : base.maxLevel,
            captureLimit: typeof data?.captureLimit === "number" ? data.captureLimit : data?.captureLimit != null ? Number(data.captureLimit) : base.captureLimit,
            unlimitedCaptures: data?.unlimitedCaptures === true,
            encounterRate: typeof data?.encounterRate === "number" ? data.encounterRate : data?.encounterRate != null ? Number(data.encounterRate) : base.encounterRate,
            shinyRate: typeof data?.shinyRate === "number" ? data.shinyRate : data?.shinyRate != null ? Number(data.shinyRate) : base.shinyRate,
            biomeIds: [],
            specialAbility: typeof data?.specialAbility === "string" ? data.specialAbility : base.specialAbility,
            specialNature: typeof data?.specialNature === "string" ? data.specialNature : base.specialNature,
            specialMoves: Array.isArray(data?.specialMoves)
              ? [...(data?.specialMoves as unknown[])].map((v) => String(v ?? "")).slice(0, 4).concat(["", "", "", ""]).slice(0, 4)
              : base.specialMoves,
            specialIVs: typeof data?.specialIVs === "object" && data?.specialIVs
              ? {
                  hp: (data.specialIVs as any).hp ?? null,
                  atk: (data.specialIVs as any).atk ?? null,
                  def: (data.specialIVs as any).def ?? null,
                  spa: (data.specialIVs as any).spa ?? null,
                  spd: (data.specialIVs as any).spd ?? null,
                  spe: (data.specialIVs as any).spe ?? null,
                }
              : base.specialIVs,
            specialEVs: typeof data?.specialEVs === "object" && data?.specialEVs
              ? {
                  hp: (data.specialEVs as any).hp ?? null,
                  atk: (data.specialEVs as any).atk ?? null,
                  def: (data.specialEVs as any).def ?? null,
                  spa: (data.specialEVs as any).spa ?? null,
                  spd: (data.specialEVs as any).spd ?? null,
                  spe: (data.specialEVs as any).spe ?? null,
                }
              : base.specialEVs,
            learnsetMaxGeneration:
              typeof data?.learnsetConstraints?.maxGeneration === "number"
                ? data.learnsetConstraints.maxGeneration
                : data?.learnsetConstraints?.maxGeneration != null
                ? Number(data.learnsetConstraints.maxGeneration)
                : base.learnsetMaxGeneration,
            learnsetBlockedSources: Array.isArray(data?.learnsetConstraints?.blockedSources)
              ? (data.learnsetConstraints.blockedSources as unknown[])
                  .map((v) => String(v ?? ""))
                  .filter((v) => LEARNSET_SOURCES.includes(v as any)) as IndividualConfig["learnsetBlockedSources"]
              : base.learnsetBlockedSources,
          };
          const num = parseSpeciesNumber(pk);
          if (num != null) next.biomeIds = loadedBiomes.filter((b) => (biomeSpeciesById[b.id] ?? []).includes(num)).map((b) => b.id);
          configs[String(pk.id)] = next;
        }));

        if (cancelled) return;
        const cleaned = dedupeGroups(loadedGroups);
        setGroups(cleaned);
        setSelectedGroupId(cleaned[0]?.id ?? "");
        setIndividualConfigs(configs);
        setSelectedIndividualSpeciesId(markedPokemon[0]?.id ? String(markedPokemon[0].id) : "");
        setBiomeConfigById(biomeSpeciesById);
      } catch (err) {
        console.error("Erro ao carregar captura:", err);
        if (!cancelled) alert("Não foi possível carregar as configurações de captura.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, markedPokemon, versionId]);

  const updateIndividual = (id: string, patch: Partial<IndividualConfig>) => setIndividualConfigs((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], ...patch } } : prev));
  const toggleBiome = (id: string, biomeId: string) => setIndividualConfigs((prev) => {
    const cur = prev[id];
    if (!cur) return prev;
    const exists = cur.biomeIds.includes(biomeId);
    return { ...prev, [id]: { ...cur, biomeIds: exists ? cur.biomeIds.filter((b) => b !== biomeId) : [...cur.biomeIds, biomeId] } };
  });

  function createGroup() {
    if (!newGroupName.trim()) return alert("Informe o nome do grupo.");
    if (newGroupSpeciesIds.length === 0) return alert("Selecione ao menos um Pokémon para o grupo.");
    const id = groupDocId(versionId, newGroupName);
    if (groups.some((g) => g.id === id)) return alert("Já existe um grupo com esse nome nesta versão.");
    const cleaned = dedupeGroups([
      {
        id,
        versionId,
        name: newGroupName.trim(),
        speciesIds: newGroupSpeciesIds,
        biomeIds: [],
        config: { ...DEFAULT_GROUP_CONFIG },
      },
      ...groups,
    ]);
    setGroups(cleaned);
    setSelectedGroupId(id);
    setNewGroupName("");
    setNewGroupSpeciesIds([]);
  }

  const updateGroupConfig = (patch: Partial<GroupRuleConfig>) => {
    if (!selectedGroup) return;
    setGroups((prev) => prev.map((g) => (g.id === selectedGroup.id ? { ...g, config: { ...g.config, ...patch } } : g)));
  };
  const removeFromSelectedGroup = (speciesId: number) => {
    if (!selectedGroup) return;
    setGroups((prev) => prev.map((g) => (g.id === selectedGroup.id ? { ...g, speciesIds: g.speciesIds.filter((id) => id !== speciesId) } : g)));
  };
  const toggleGroupBiome = (biomeId: string) => {
    if (!selectedGroup) return;
    setGroups((prev) =>
      prev.map((g) => {
        if (g.id !== selectedGroup.id) return g;
        const exists = g.biomeIds.includes(biomeId);
        return {
          ...g,
          biomeIds: exists ? g.biomeIds.filter((id) => id !== biomeId) : [...g.biomeIds, biomeId],
        };
      })
    );
  };

  async function handleSaveIndividual() {
    if (!selectedIndividualConfig) return;
    const selectedPk =
      individualPokemon.find((pk) => String(pk.id) === selectedIndividualConfig.speciesId) ??
      pokemonCatalogById.get(Number(selectedIndividualConfig.speciesId));
    if (!selectedPk) return;
    const speciesNumber = parseSpeciesNumber(selectedPk);
    if (speciesNumber == null) return alert("Não foi possível identificar o número da espécie.");
    if ((speciesInGroup.get(speciesNumber) ?? 0) > 0) {
      return alert("Este Pokémon está em grupo. Remova dos grupos para configurar no modo individual.");
    }

    setSavingIndividual(true);
    try {
      await setDoc(doc(db, "pokedexConfig", cfgDocId(versionId, String(speciesNumber))), {
        versionId,
        speciesId: speciesNumber,
        speciesName: selectedIndividualConfig.speciesName,
        configMode: "individual",
        groupId: null,
        isSpecial: selectedIndividualConfig.isSpecialMode,
        minLevel: selectedIndividualConfig.minLevel,
        maxLevel: selectedIndividualConfig.maxLevel,
        captureLimit: selectedIndividualConfig.unlimitedCaptures ? null : selectedIndividualConfig.captureLimit,
        unlimitedCaptures: selectedIndividualConfig.unlimitedCaptures,
        encounterRate: selectedIndividualConfig.encounterRate,
        shinyRate: selectedIndividualConfig.shinyRate,
        specialAbility: selectedIndividualConfig.isSpecialMode ? selectedIndividualConfig.specialAbility : null,
        specialNature: selectedIndividualConfig.isSpecialMode ? selectedIndividualConfig.specialNature : null,
        specialMoves: selectedIndividualConfig.isSpecialMode ? selectedIndividualConfig.specialMoves.filter((m) => !!m) : [],
        specialIVs: selectedIndividualConfig.isSpecialMode ? selectedIndividualConfig.specialIVs : {},
        specialEVs: selectedIndividualConfig.isSpecialMode ? selectedIndividualConfig.specialEVs : {},
        learnsetConstraints: {
          maxGeneration: selectedIndividualConfig.learnsetMaxGeneration,
          blockedSources: selectedIndividualConfig.learnsetBlockedSources,
        },
        updatedAt: serverTimestamp(),
      }, { merge: true });

      await Promise.all(adminBiomes.map(async (biome) => {
        const biomeDoc = biomeConfigDocId(biome.id);
        const individualRef = doc(db, "biomeEncounterConfig", biomeDoc, "individual", String(speciesNumber));
        if (selectedIndividualConfig.biomeIds.includes(biome.id)) {
          await setDoc(
            individualRef,
            {
              versionId,
              biomeId: biome.id,
              speciesId: speciesNumber,
              speciesName: selectedIndividualConfig.speciesName,
              configMode: "individual",
              minLevel: selectedIndividualConfig.minLevel,
              maxLevel: selectedIndividualConfig.maxLevel,
              encounterRate: selectedIndividualConfig.encounterRate,
              shinyRate: selectedIndividualConfig.shinyRate,
              captureLimit: selectedIndividualConfig.unlimitedCaptures ? null : selectedIndividualConfig.captureLimit,
              unlimitedCaptures: selectedIndividualConfig.unlimitedCaptures,
              isSpecial: selectedIndividualConfig.isSpecialMode,
              specialAbility: selectedIndividualConfig.isSpecialMode ? selectedIndividualConfig.specialAbility : null,
              specialNature: selectedIndividualConfig.isSpecialMode ? selectedIndividualConfig.specialNature : null,
              specialMoves: selectedIndividualConfig.isSpecialMode ? selectedIndividualConfig.specialMoves.filter((m) => !!m) : [],
              specialIVs: selectedIndividualConfig.isSpecialMode ? selectedIndividualConfig.specialIVs : {},
              specialEVs: selectedIndividualConfig.isSpecialMode ? selectedIndividualConfig.specialEVs : {},
              learnsetConstraints: {
                maxGeneration: selectedIndividualConfig.learnsetMaxGeneration,
                blockedSources: selectedIndividualConfig.learnsetBlockedSources,
              },
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        } else {
          await deleteDoc(individualRef);
        }
      }));
      await Promise.all(adminBiomes.map((biome) => syncBiomeRootSpeciesIndex(biome.id)));

      const nextGroups = groups.map((g) => ({ ...g, speciesIds: g.speciesIds.filter((id) => id !== speciesNumber) }));
      if (JSON.stringify(nextGroups) !== JSON.stringify(groups)) {
        const batch = writeBatch(db);
        for (const g of nextGroups) {
          batch.set(
            doc(db, "captureConfigGroups", g.id),
            {
              versionId: g.versionId,
              name: g.name,
              speciesIds: g.speciesIds,
              biomeIds: g.biomeIds,
              config: g.config,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        }
        await batch.commit();
        setGroups(nextGroups);
        await Promise.all(
          adminBiomes.map(async (biome) => {
            const biomeDoc = biomeConfigDocId(biome.id);
            const groupsSnap = await getDocs(collection(db, "biomeEncounterConfig", biomeDoc, "groups"));
            await Promise.all(
              groupsSnap.docs.map(async (groupDoc) => {
                const data = groupDoc.data() as { speciesIds?: unknown };
                const curr = toSpeciesNumberList(data.speciesIds);
                if (!curr.includes(speciesNumber)) return;
                const next = curr.filter((id) => id !== speciesNumber);
                await setDoc(groupDoc.ref, { speciesIds: next, updatedAt: serverTimestamp() }, { merge: true });
              })
            );
          })
        );
        await Promise.all(adminBiomes.map((biome) => syncBiomeRootSpeciesIndex(biome.id)));
      }

      alert("Configuração individual salva com sucesso.");
      await refreshBiomeConfig();
    } catch (err) {
      console.error("Erro ao salvar individual:", err);
      alert("Não foi possível salvar a configuração individual.");
    } finally {
      setSavingIndividual(false);
    }
  }

  async function handleSaveGroups() {
    setSavingGroups(true);
    try {
      const cleaned = dedupeGroups(groups).map((g) => ({ ...g, speciesIds: Array.from(new Set(g.speciesIds)) }));
      setGroups(cleaned);

      const oldIds = new Set(groups.map((g) => g.id));
      const newIds = new Set(cleaned.map((g) => g.id));
      const batch = writeBatch(db);
      for (const g of cleaned) {
        batch.set(
          doc(db, "captureConfigGroups", g.id),
          {
            versionId: g.versionId,
            name: g.name,
            speciesIds: g.speciesIds,
            biomeIds: g.biomeIds,
            config: g.config,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }
      for (const oldId of oldIds) {
        if (!newIds.has(oldId)) batch.delete(doc(db, "captureConfigGroups", oldId));
      }
      await batch.commit();

      const cfgBatch = writeBatch(db);
      for (const g of cleaned) {
        for (const speciesId of g.speciesIds) {
          cfgBatch.set(doc(db, "pokedexConfig", cfgDocId(versionId, String(speciesId))), {
            versionId,
            speciesId,
            speciesName: speciesIdToName.get(speciesId) ?? null,
            configMode: "group",
            groupId: g.id,
            groupName: g.name,
            groupConfig: g.config,
            updatedAt: serverTimestamp(),
          }, { merge: true });
        }
      }
      await cfgBatch.commit();

      await Promise.all(
        adminBiomes.map(async (biome) => {
          const biomeDoc = biomeConfigDocId(biome.id);
          const groupsCol = collection(db, "biomeEncounterConfig", biomeDoc, "groups");
          const existingGroups = await getDocs(groupsCol);
          const shouldExist = cleaned.filter((g) => g.biomeIds.includes(biome.id));
          const shouldIds = new Set(shouldExist.map((g) => g.id));

          await Promise.all(
            shouldExist.map((group) =>
              setDoc(
                doc(db, "biomeEncounterConfig", biomeDoc, "groups", group.id),
                {
                  versionId,
                  biomeId: biome.id,
                  groupId: group.id,
                  groupName: group.name,
                  speciesIds: group.speciesIds,
                  config: group.config,
                  updatedAt: serverTimestamp(),
                },
                { merge: true }
              )
            )
          );

          await Promise.all(
            existingGroups.docs
              .filter((d) => !shouldIds.has(d.id))
              .map((d) => deleteDoc(d.ref))
          );

          for (const group of shouldExist) {
            for (const speciesId of group.speciesIds) {
              await deleteDoc(doc(db, "biomeEncounterConfig", biomeDoc, "individual", String(speciesId)));
            }
          }

          await syncBiomeRootSpeciesIndex(biome.id);
        })
      );

      alert("Configurações de grupo salvas com sucesso.");
      await refreshBiomeConfig();
    } catch (err) {
      console.error("Erro ao salvar grupos:", err);
      alert("Não foi possível salvar os grupos.");
    } finally {
      setSavingGroups(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-3 py-6">
      <div className="w-full max-w-5xl max-h-[92vh] rounded-2xl bg-slate-950 border border-slate-800 shadow-xl flex flex-col">
        <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Configurar Captura</h2>
            <p className="text-[11px] text-slate-400">{markedPokemon.length} Pokémon marcado(s) nesta versão.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 text-sm">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 text-sm">
          {loading && <p className="text-slate-300">Carregando configuração de captura...</p>}
          {!loading && markedPokemon.length === 0 && <p className="text-slate-300">Nenhum Pokémon marcado.</p>}

          {!loading && markedPokemon.length > 0 && step === "root" && (
            <div className="grid gap-3 md:grid-cols-2">
              <button type="button" onClick={() => setStep("individual")} className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-5 text-left hover:bg-emerald-500/20">
                <div className="text-base font-semibold text-emerald-200">Configurar Individualmente</div>
                <p className="mt-1 text-xs text-slate-300">Configuração exclusiva por Pokémon.</p>
              </button>
              <button type="button" onClick={() => setStep("group")} className="rounded-xl border border-indigo-500/40 bg-indigo-500/10 p-5 text-left hover:bg-indigo-500/20">
                <div className="text-base font-semibold text-indigo-200">Criar Grupo de Pokémon</div>
                <p className="mt-1 text-xs text-slate-300">Configuração coletiva para múltiplos Pokémon.</p>
              </button>
            </div>
          )}

          {!loading && step === "individual" && (
            <div className="space-y-4">
              <button type="button" onClick={() => setStep("root")} className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800">? Voltar</button>
              <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3 space-y-3">
                <h3 className="text-white font-semibold">Configuração Unitária</h3>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Selecionar Pokémon</label>
                  <select value={selectedIndividualSpeciesId} onChange={(e) => setSelectedIndividualSpeciesId(e.target.value)} className="w-full rounded-md bg-slate-950 border border-slate-700 px-2 py-1.5 text-xs">
                    {individualPokemon.map((pk) => <option key={String(pk.id)} value={String(pk.id)}>#{String(pk.dexNumber).padStart(4, "0")} {pk.name}</option>)}
                  </select>
                </div>

                {individualPokemon.length === 0 && (
                  <p className="text-xs text-amber-200">
                    Todos os Pokémon marcados estão em grupos. Remova de um grupo para configurar individualmente.
                  </p>
                )}

                {individualPokemon.length > 0 && selectedIndividualConfig && (
                  <div className="space-y-3">
                    <label className="inline-flex items-center gap-2 text-xs text-slate-200"><input type="checkbox" checked={selectedIndividualConfig.isSpecialMode} onChange={(e) => updateIndividual(selectedIndividualSpeciesId, { isSpecialMode: e.target.checked })} className="h-4 w-4" />Ativar Modo Especial</label>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">Nível mínimo</label>
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={selectedIndividualConfig.minLevel ?? ""}
                          onChange={(e) => updateIndividual(selectedIndividualSpeciesId, { minLevel: clamp(e.target.value ? Number(e.target.value) : null, 1, 100) })}
                          className="w-full rounded-md bg-slate-950 border border-slate-700 px-2 py-1.5 text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">Nível máximo</label>
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={selectedIndividualConfig.maxLevel ?? ""}
                          onChange={(e) => updateIndividual(selectedIndividualSpeciesId, { maxLevel: clamp(e.target.value ? Number(e.target.value) : null, 1, 100) })}
                          className="w-full rounded-md bg-slate-950 border border-slate-700 px-2 py-1.5 text-xs"
                        />
                      </div>
                    </div>

                    {selectedIndividualConfig.isSpecialMode && (
                      <div className="rounded-md border border-indigo-500/30 bg-indigo-500/5 p-3 space-y-3">
                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">Habilidade</label>
                          <select
                            value={selectedIndividualConfig.specialAbility}
                            onChange={(e) => updateIndividual(selectedIndividualSpeciesId, { specialAbility: e.target.value })}
                            className="w-full rounded-md bg-slate-950 border border-slate-700 px-2 py-1.5 text-xs"
                          >
                            <option value="">Selecione uma habilidade</option>
                            {specialAbilityOptions.map((ab) => (
                              <option key={ab.id} value={ab.id}>
                                {ab.label}
                              </option>
                            ))}
                          </select>
                          {specialAbilityOptions.length === 0 && (
                            <p className="mt-1 text-[10px] text-amber-200">
                              Nenhuma habilidade encontrada para esta espécie no JSON.
                            </p>
                          )}
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">Natureza</label>
                          <select
                            value={selectedIndividualConfig.specialNature}
                            onChange={(e) => updateIndividual(selectedIndividualSpeciesId, { specialNature: e.target.value })}
                            className="w-full rounded-md bg-slate-950 border border-slate-700 px-2 py-1.5 text-xs"
                          >
                            <option value="">Selecione</option>
                            {NATURES.map((n) => <option key={n} value={n}>{n}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">Movimentos da espécie</label>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {[0, 1, 2, 3].map((slot) => (
                              <select
                                key={slot}
                                value={selectedIndividualConfig.specialMoves[slot] ?? ""}
                                onChange={(e) => {
                                  const nextMoves = [...selectedIndividualConfig.specialMoves];
                                  nextMoves[slot] = e.target.value;
                                  updateIndividual(selectedIndividualSpeciesId, { specialMoves: nextMoves });
                                }}
                                className="w-full rounded-md bg-slate-950 border border-slate-700 px-2 py-1.5 text-xs"
                              >
                                <option value="">(vazio)</option>
                                {specialMoveOptions.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                              </select>
                            ))}
                          </div>
                          {specialMoveOptions.length === 0 && (
                            <p className="mt-1 text-[10px] text-amber-200">
                              Nenhum movimento encontrado para esta espécie no JSON.
                            </p>
                          )}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">IV</label>
                            <div className="grid grid-cols-3 gap-2">
                              {(["hp", "atk", "def", "spa", "spd", "spe"] as const).map((k) => (
                                <input
                                  key={`iv-${k}`}
                                  type="number"
                                  min={0}
                                  max={31}
                                  placeholder={k.toUpperCase()}
                                  value={selectedIndividualConfig.specialIVs[k] ?? ""}
                                  onChange={(e) =>
                                    updateIndividual(selectedIndividualSpeciesId, {
                                      specialIVs: {
                                        ...selectedIndividualConfig.specialIVs,
                                        [k]: clamp(e.target.value ? Number(e.target.value) : null, 0, 31),
                                      },
                                    })
                                  }
                                  className="w-full rounded-md bg-slate-950 border border-slate-700 px-2 py-1 text-xs"
                                />
                              ))}
                            </div>
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">EV</label>
                            <div className="grid grid-cols-3 gap-2">
                              {(["hp", "atk", "def", "spa", "spd", "spe"] as const).map((k) => (
                                <input
                                  key={`ev-${k}`}
                                  type="number"
                                  min={0}
                                  max={252}
                                  placeholder={k.toUpperCase()}
                                  value={selectedIndividualConfig.specialEVs[k] ?? ""}
                                  onChange={(e) =>
                                    updateIndividual(selectedIndividualSpeciesId, {
                                      specialEVs: {
                                        ...selectedIndividualConfig.specialEVs,
                                        [k]: clamp(e.target.value ? Number(e.target.value) : null, 0, 252),
                                      },
                                    })
                                  }
                                  className="w-full rounded-md bg-slate-950 border border-slate-700 px-2 py-1 text-xs"
                                />
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    <div>
                      <div className="text-[11px] text-slate-400 mb-1">Biomas onde pode aparecer</div>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {adminBiomes.map((biome) => <label key={biome.id} className="inline-flex items-center gap-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"><input type="checkbox" checked={selectedIndividualConfig.biomeIds.includes(biome.id)} onChange={() => toggleBiome(selectedIndividualSpeciesId, biome.id)} className="h-3.5 w-3.5" />{biome.name}</label>)}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      <div><label className="block text-[11px] text-slate-400 mb-1">Máximo de capturas</label><input type="number" min={1} max={9999} disabled={selectedIndividualConfig.unlimitedCaptures} value={selectedIndividualConfig.captureLimit ?? ""} onChange={(e) => updateIndividual(selectedIndividualSpeciesId, { captureLimit: clamp(e.target.value ? Number(e.target.value) : null, 1, 9999) })} className="w-full rounded-md bg-slate-950 border border-slate-700 px-2 py-1.5 text-xs disabled:opacity-50" /></div>
                      <div><label className="block text-[11px] text-slate-400 mb-1">Chance de aparecer (%)</label><input type="number" min={0} max={100} step={0.01} value={selectedIndividualConfig.encounterRate ?? ""} onChange={(e) => updateIndividual(selectedIndividualSpeciesId, { encounterRate: clamp(e.target.value ? Number(e.target.value) : null, 0, 100) })} className="w-full rounded-md bg-slate-950 border border-slate-700 px-2 py-1.5 text-xs" /></div>
                      <div><label className="block text-[11px] text-slate-400 mb-1">Chance de Shiny (%)</label><input type="number" min={0} max={100} step={0.01} value={selectedIndividualConfig.shinyRate ?? ""} onChange={(e) => updateIndividual(selectedIndividualSpeciesId, { shinyRate: clamp(e.target.value ? Number(e.target.value) : null, 0, 100) })} className="w-full rounded-md bg-slate-950 border border-slate-700 px-2 py-1.5 text-xs" /></div>
                    </div>
                    <div className="rounded-md border border-slate-700 bg-slate-950 p-3 space-y-2">
                      <div className="text-[11px] font-semibold text-slate-200">Learnset Constraints (Moves)</div>
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">Geração máxima permitida (opcional)</label>
                        <input
                          type="number"
                          min={1}
                          max={20}
                          placeholder="Sem limite"
                          value={selectedIndividualConfig.learnsetMaxGeneration ?? ""}
                          onChange={(e) =>
                            updateIndividual(selectedIndividualSpeciesId, {
                              learnsetMaxGeneration: clamp(
                                e.target.value ? Number(e.target.value) : null,
                                1,
                                20
                              ),
                            })
                          }
                          className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs"
                        />
                      </div>
                      <div>
                        <div className="block text-[11px] text-slate-400 mb-1">Bloquear fontes de aprendizado</div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          {LEARNSET_SOURCES.map((src) => (
                            <label key={`src_${src}`} className="inline-flex items-center gap-2 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200">
                              <input
                                type="checkbox"
                                checked={selectedIndividualConfig.learnsetBlockedSources.includes(src)}
                                onChange={() => {
                                  const prev = selectedIndividualConfig.learnsetBlockedSources;
                                  const next = prev.includes(src) ? prev.filter((v) => v !== src) : [...prev, src];
                                  updateIndividual(selectedIndividualSpeciesId, { learnsetBlockedSources: next });
                                }}
                                className="h-3.5 w-3.5"
                              />
                              {src}
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                    <label className="inline-flex items-center gap-2 text-xs text-slate-200"><input type="checkbox" checked={selectedIndividualConfig.unlimitedCaptures} onChange={(e) => updateIndividual(selectedIndividualSpeciesId, { unlimitedCaptures: e.target.checked })} className="h-4 w-4" />Capturas ilimitadas</label>
                    <button type="button" onClick={handleSaveIndividual} disabled={savingIndividual} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60">{savingIndividual ? "Salvando..." : "Salvar configuração individual"}</button>
                  </div>
                )}
              </div>
            </div>
          )}

          {!loading && step === "group" && (
            <div className="space-y-4">
              <button type="button" onClick={() => setStep("root")} className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800">? Voltar</button>
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3 space-y-3">
                  <h3 className="text-white font-semibold">Etapa 1: Seleção</h3>
                  <div><label className="block text-[11px] text-slate-400 mb-1">Nome do grupo</label><input type="text" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} className="w-full rounded-md bg-slate-950 border border-slate-700 px-2 py-1.5 text-xs" placeholder="Ex.: Rota Kanto Inicial" /></div>
                  <div>
                    <div className="text-[11px] text-slate-400 mb-1">Selecionar Pokémon para o grupo</div>
                    <div className="max-h-52 overflow-auto rounded border border-slate-700 bg-slate-950 p-2 space-y-1">
                      {markedWithNumbers.map(({ pokemon, speciesNumber }) => {
                        const inGroupsCount = speciesInGroup.get(speciesNumber) ?? 0;
                        const checked = newGroupSpeciesIds.includes(speciesNumber);
                        return <label key={`${pokemon.id}_${speciesNumber}`} className="flex items-center justify-between gap-2 text-xs text-slate-200"><span>#{String(pokemon.dexNumber).padStart(4, "0")} {pokemon.name}</span><span className="inline-flex items-center gap-2">{inGroupsCount > 0 && !checked && <span className="text-[10px] text-amber-300">em {inGroupsCount} grupo(s)</span>}<input type="checkbox" checked={checked} onChange={() => setNewGroupSpeciesIds((prev) => prev.includes(speciesNumber) ? prev.filter((id) => id !== speciesNumber) : [...prev, speciesNumber])} className="h-3.5 w-3.5" /></span></label>;
                      })}
                    </div>
                  </div>
                  <button type="button" onClick={createGroup} className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500">Adicionar ao Grupo</button>
                </div>

                <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3 space-y-3">
                  <h3 className="text-white font-semibold">Etapa 2: Configuração do Grupo</h3>
                  <div><label className="block text-[11px] text-slate-400 mb-1">Grupo</label><select value={selectedGroupId} onChange={(e) => setSelectedGroupId(e.target.value)} className="w-full rounded-md bg-slate-950 border border-slate-700 px-2 py-1.5 text-xs"><option value="">Selecione um grupo</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.speciesIds.length})</option>)}</select></div>

                  {selectedGroup && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <div><label className="block text-[11px] text-slate-400 mb-1">Nível mínimo</label><input type="number" min={1} max={100} value={selectedGroup.config.minLevel} onChange={(e) => updateGroupConfig({ minLevel: Number(clamp(Number(e.target.value), 1, 100) ?? 1) })} className="w-full rounded-md bg-slate-950 border border-slate-700 px-2 py-1.5 text-xs" /></div>
                        <div><label className="block text-[11px] text-slate-400 mb-1">Nível máximo</label><input type="number" min={1} max={100} value={selectedGroup.config.maxLevel} onChange={(e) => updateGroupConfig({ maxLevel: Number(clamp(Number(e.target.value), 1, 100) ?? 100) })} className="w-full rounded-md bg-slate-950 border border-slate-700 px-2 py-1.5 text-xs" /></div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <div><label className="block text-[11px] text-slate-400 mb-1">Habilidade</label><select value={selectedGroup.config.abilityMode} onChange={(e) => updateGroupConfig({ abilityMode: e.target.value as GroupRuleConfig["abilityMode"] })} className="w-full rounded-md bg-slate-950 border border-slate-700 px-2 py-1.5 text-xs"><option value="random">Aleatória</option><option value="fixed">Fixa</option></select>{selectedGroup.config.abilityMode === "fixed" && <input type="text" value={selectedGroup.config.fixedAbility} onChange={(e) => updateGroupConfig({ fixedAbility: e.target.value })} placeholder="Nome da habilidade" className="mt-1 w-full rounded-md bg-slate-950 border border-slate-700 px-2 py-1.5 text-xs" />}</div>
                        <div><label className="block text-[11px] text-slate-400 mb-1">Natureza</label><select value={selectedGroup.config.natureMode} onChange={(e) => updateGroupConfig({ natureMode: e.target.value as GroupRuleConfig["natureMode"] })} className="w-full rounded-md bg-slate-950 border border-slate-700 px-2 py-1.5 text-xs"><option value="random">Aleatória</option><option value="fixed">Fixa</option></select>{selectedGroup.config.natureMode === "fixed" && <select value={selectedGroup.config.fixedNature} onChange={(e) => updateGroupConfig({ fixedNature: e.target.value })} className="mt-1 w-full rounded-md bg-slate-950 border border-slate-700 px-2 py-1.5 text-xs"><option value="">Selecione a natureza</option>{NATURES.map((n) => <option key={n} value={n}>{n}</option>)}</select>}</div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        <label className="inline-flex items-center gap-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"><input type="checkbox" checked={selectedGroup.config.randomEV} onChange={(e) => updateGroupConfig({ randomEV: e.target.checked })} className="h-3.5 w-3.5" />EV aleatório</label>
                        <label className="inline-flex items-center gap-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"><input type="checkbox" checked={selectedGroup.config.randomIV} onChange={(e) => updateGroupConfig({ randomIV: e.target.checked })} className="h-3.5 w-3.5" />IV aleatório</label>
                        <label className="inline-flex items-center gap-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"><input type="checkbox" checked={selectedGroup.config.randomMoves} onChange={(e) => updateGroupConfig({ randomMoves: e.target.checked })} className="h-3.5 w-3.5" />Movimentos aleatórios</label>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-400 mb-1">Biomas do grupo (adicionar ao jogo)</div>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                          {adminBiomes.map((biome) => (
                            <label key={biome.id} className="inline-flex items-center gap-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200">
                              <input
                                type="checkbox"
                                checked={selectedGroup.biomeIds.includes(biome.id)}
                                onChange={() => toggleGroupBiome(biome.id)}
                                className="h-3.5 w-3.5"
                              />
                              {biome.name}
                            </label>
                          ))}
                        </div>
                      </div>
                      <div><div className="text-[11px] text-slate-400 mb-1">Pokémon do grupo</div><div className="max-h-32 overflow-auto rounded border border-slate-700 bg-slate-950 p-2 space-y-1">{selectedGroup.speciesIds.length === 0 && <p className="text-xs text-slate-400">Nenhum Pokémon no grupo.</p>}{selectedGroup.speciesIds.map((speciesId) => <div key={speciesId} className="flex items-center justify-between text-xs text-slate-200"><span>#{String(speciesId).padStart(4, "0")} {speciesIdToName.get(speciesId) ?? "Pokémon"}</span><button type="button" onClick={() => removeFromSelectedGroup(speciesId)} className="rounded border border-amber-600/50 px-2 py-0.5 text-[10px] text-amber-200 hover:bg-amber-600/20">Remover</button></div>)}</div></div>
                      <div className="flex flex-wrap gap-2"><button type="button" onClick={handleSaveGroups} disabled={savingGroups} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60">{savingGroups ? "Salvando..." : "Salvar grupos"}</button><button type="button" onClick={() => { if (!selectedGroup) return; if (!window.confirm(`Excluir grupo \"${selectedGroup.name}\"?`)) return; setGroups((prev) => prev.filter((g) => g.id !== selectedGroup.id)); setSelectedGroupId(""); }} className="rounded-md border border-red-500/50 px-3 py-1.5 text-xs text-red-200 hover:bg-red-500/15">Excluir grupo</button></div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {!loading && (
            <div className="mt-4 rounded-lg border border-slate-700 bg-slate-900/60 p-3 space-y-3">
              <h3 className="text-white font-semibold">Configuração por Bioma</h3>
              <div className="flex flex-wrap gap-2">
                {adminBiomes.map((biome) => (
                  <button
                    key={biome.id}
                    type="button"
                    onClick={() => setViewBiomeId(biome.id)}
                    className={`px-2 py-1 rounded-md text-[11px] border ${
                      viewBiomeId === biome.id
                        ? "bg-blue-600 border-blue-500 text-white"
                        : "bg-slate-950 border-slate-700 text-slate-200 hover:bg-slate-800"
                    }`}
                  >
                    {biome.name} ({(biomeConfigById[biome.id] ?? []).length})
                  </button>
                ))}
              </div>

              <div className="max-h-40 overflow-auto rounded border border-slate-700 bg-slate-950 p-2">
                {viewedBiomeSpecies.length === 0 ? (
                  <p className="text-xs text-slate-400">Nenhum Pokémon configurado neste bioma.</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {viewedBiomeSpecies.map((pk) => (
                      <div key={`${viewBiomeId}_${pk.id}`} className="rounded border border-slate-800 bg-slate-900/60 px-2 py-1.5 text-xs text-slate-200 flex items-center justify-between gap-2">
                        <span>#{String(pk.id).padStart(4, "0")} {pk.name}</span>
                        <span className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => editPokemonFromBiome(pk.id)}
                            className="rounded border border-blue-500/40 px-2 py-0.5 text-[10px] text-blue-200 hover:bg-blue-500/20"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => removePokemonFromBiome(pk.id, viewBiomeId)}
                            className="rounded border border-red-500/40 px-2 py-0.5 text-[10px] text-red-200 hover:bg-red-500/20"
                          >
                            Remover
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-800 bg-slate-900/70 flex items-center justify-between">
          <p className="text-[11px] text-slate-300">Regras: individual não herda grupo, grupo aplica configuração coletiva, Pokémon pode estar em vários grupos, mas não pode ficar em grupo e individual ao mesmo tempo.</p>
          <button type="button" onClick={onClose} className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800">Fechar</button>
        </div>
      </div>
    </div>
  );
}


