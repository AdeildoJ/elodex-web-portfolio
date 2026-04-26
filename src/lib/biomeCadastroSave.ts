import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  writeBatch,
  deleteField,
  type Firestore,
} from "firebase/firestore";

import type { BiomeEvolutionPair } from "@/lib/biomeEvolutionSync";
import { syncBiomeEvolutionRules } from "@/lib/biomeEvolutionSync";

export const BIOME_GAME_VERSION = "elodex-base";

export type BiomeNpcFirestore = {
  id: string;
  role: "nurse" | "breeder" | "specialist" | "remember" | "fisherman";
  name: string;
  imageUrl: string;
  specialistType?: string | null;
};

export type BiomeCadastroPayload = {
  biomeId: string;
  name: string;
  description: string;
  imageDataUrl: string;
  order: number;
  allowsFishing: boolean;
  allowsSafari: boolean;
  acceptsGym: boolean;
  evolutionEnabled: boolean;
  evolutionPairs: BiomeEvolutionPair[];
  npcEnabled: boolean;
  npcs: BiomeNpcFirestore[];
  battleScenarioId: string;
  battleWeather: string;
  captureNormalGroupIds: string[];
  captureNormalSpeciesIds: number[];
  captureSafariGroupIds: string[];
  captureSafariSpeciesIds: number[];
  /** active | inactive */
  biomeStatus: "active" | "inactive";
  visibleOnMap: boolean;
  isStartBiome: boolean;
  /** Preservado ao editar; opcional em novo bioma */
  mapPosition?: { x: number; y: number } | null;
  isPlacedOnMap?: boolean;
};

function adminNpcRoleToBiomeRole(
  role: string
): "nurse" | "breeder" | "specialist" | "remember" | "fisherman" {
  const r = String(role || "").trim().toLowerCase();
  if (r === "enfermeiro") return "nurse";
  if (r === "criador") return "breeder";
  if (r === "especialista") return "specialist";
  if (r === "remember") return "remember";
  if (r === "pescador" || r === "pescadora") return "fisherman";
  return "remember";
}

export function mapFirestoreWeatherToForm(raw: unknown): string {
  const w = String(raw || "").trim().toLowerCase();
  if (w === "sun" || w === "sunny") return "sunny";
  if (w === "rain") return "rain";
  if (w === "sandstorm") return "sandstorm";
  if (w === "hail" || w === "snow") return "hail";
  if (w === "fog") return "fog";
  if (w === "clear" || w === "none" || !w) return "clear";
  return "clear";
}

export function formWeatherToFirestore(value: string): string {
  const v = String(value || "").trim().toLowerCase();
  if (v === "sunny") return "sun";
  if (v === "rain") return "rain";
  if (v === "sandstorm") return "sandstorm";
  if (v === "hail") return "hail";
  if (v === "fog") return "fog";
  return "none";
}

/** Próximo número de ordem livre (max existente + 1). */
export async function getNextBiomeOrder(db: Firestore): Promise<number> {
  const snap = await getDocs(collection(db, "biomes"));
  let max = 0;
  snap.forEach((d) => {
    const data = d.data() as Record<string, unknown>;
    const o = Number(data.order ?? 0);
    if (Number.isFinite(o) && o > max) max = Math.trunc(o);
  });
  return max + 1;
}

async function wipeEncounterPrefix(db: Firestore, prefix: string) {
  const [groupsSnap, indSnap] = await Promise.all([
    getDocs(collection(db, "biomeEncounterConfig", prefix, "groups")),
    getDocs(collection(db, "biomeEncounterConfig", prefix, "individual")),
  ]);
  let batch = writeBatch(db);
  let n = 0;
  const flush = async () => {
    if (n > 0) {
      await batch.commit();
      batch = writeBatch(db);
      n = 0;
    }
  };
  for (const d of [...groupsSnap.docs, ...indSnap.docs]) {
    batch.delete(d.ref);
    n += 1;
    if (n >= 450) await flush();
  }
  await flush();
}

async function syncEncounterPrefix(
  db: Firestore,
  prefix: string,
  biomeId: string,
  groupIds: string[],
  speciesIds: number[],
  speciesNameById: Map<number, string>
) {
  const versionId = BIOME_GAME_VERSION;
  const bid = String(biomeId || "").trim().toLowerCase();
  await wipeEncounterPrefix(db, prefix);

  for (const gid of groupIds.map((x) => String(x).trim()).filter(Boolean)) {
    const gSnap = await getDoc(doc(db, "captureConfigGroups", gid));
    if (!gSnap.exists()) continue;
    const g = gSnap.data() as Record<string, unknown>;
    await setDoc(
      doc(db, "biomeEncounterConfig", prefix, "groups", gid),
      {
        versionId,
        biomeId: bid,
        groupId: gid,
        groupName: g.name ?? "",
        speciesIds: Array.isArray(g.speciesIds) ? g.speciesIds : [],
        config: g.config ?? {},
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  const uniqSpecies = Array.from(
    new Set(speciesIds.map((x) => Math.trunc(Number(x))).filter((x) => x > 0))
  );
  for (const sid of uniqSpecies) {
    await setDoc(
      doc(db, "biomeEncounterConfig", prefix, "individual", String(sid)),
      {
        versionId,
        biomeId: bid,
        speciesId: sid,
        speciesName: speciesNameById.get(sid) ?? `#${sid}`,
        configMode: "individual",
        minLevel: 1,
        maxLevel: 50,
        encounterRate: 15,
        captureLimit: null,
        unlimitedCaptures: true,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  const allSpecies = new Set<number>(uniqSpecies);
  for (const gid of groupIds) {
    const gSnap = await getDoc(doc(db, "captureConfigGroups", gid));
    if (!gSnap.exists()) continue;
    const g = gSnap.data() as { speciesIds?: unknown };
    if (Array.isArray(g.speciesIds)) {
      for (const raw of g.speciesIds) {
        const n = Math.trunc(Number(raw));
        if (n > 0) allSpecies.add(n);
      }
    }
  }

  await setDoc(
    doc(db, "biomeEncounterConfig", prefix),
    {
      versionId,
      biomeId: bid,
      speciesIds: Array.from(allSpecies).sort((a, b) => a - b),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export function encounterPrefix(biomeId: string, safari: boolean) {
  const bid = String(biomeId || "").trim().toLowerCase();
  const base = `${BIOME_GAME_VERSION}_${bid}`;
  return safari ? `${base}_safari` : base;
}

async function clearOtherStartBiomes(db: Firestore, exceptBiomeId: string) {
  const bid = String(exceptBiomeId || "").trim().toLowerCase();
  const snap = await getDocs(collection(db, "biomes"));
  const batch = writeBatch(db);
  let n = 0;
  for (const d of snap.docs) {
    const id = String(d.id).trim().toLowerCase();
    if (!id || id === bid) continue;
    const data = d.data() as Record<string, unknown>;
    if (data.isStartBiome === true) {
      batch.set(d.ref, { isStartBiome: false, updatedAt: serverTimestamp() }, { merge: true });
      n += 1;
    }
  }
  if (n > 0) await batch.commit();
}

export async function saveBiomeCadastro(db: Firestore, p: BiomeCadastroPayload): Promise<void> {
  const bid = String(p.biomeId || "").trim().toLowerCase();
  if (!bid) throw new Error("ID do bioma inválido.");

  const battleSceneId = String(p.battleScenarioId || "").trim().toLowerCase();
  const npcIds = p.npcEnabled ? p.npcs.map((n) => n.id) : [];
  const evolutionPairsSpec =
    p.evolutionEnabled && p.evolutionPairs.length
      ? p.evolutionPairs.map((pair) => ({
          pokemonId: String(pair.fromSpeciesId),
          evolutionId: String(pair.toSpeciesId),
        }))
      : [];

  const capturePokemonIds = p.captureNormalSpeciesIds.map((x) => String(Math.trunc(x)));
  const safariPokemonIds = p.captureSafariSpeciesIds.map((x) => String(Math.trunc(x)));

  if (p.isStartBiome) {
    await clearOtherStartBiomes(db, bid);
  }

  const biomeRef = doc(db, "biomes", bid);
  const existingBiome = await getDoc(biomeRef);
  const prevData = existingBiome.exists() ? (existingBiome.data() as Record<string, unknown>) : {};
  const mapPosition =
    p.mapPosition != null
      ? p.mapPosition
      : prevData.mapPosition && typeof prevData.mapPosition === "object"
        ? (prevData.mapPosition as { x: number; y: number })
        : null;
  const isPlacedOnMap =
    p.isPlacedOnMap !== undefined ? p.isPlacedOnMap : Boolean(prevData.isPlacedOnMap ?? prevData.mapPosition);

  await setDoc(
    biomeRef,
    {
      id: bid,
      name: String(p.name || "").trim(),
      description: String(p.description || "").trim() || null,
      imageUrl: p.imageDataUrl,
      order: Math.max(0, Math.trunc(Number(p.order) || 0)),
      allowsFishing: p.allowsFishing,
      allowsSafari: p.allowsSafari,
      acceptsGym: p.acceptsGym,
      evolutionEnabled: p.evolutionEnabled,
      evolutionPairs: evolutionPairsSpec,
      npcEnabled: p.npcEnabled,
      npcIds,
      npcs: p.npcEnabled ? p.npcs : [],
      battleSceneId,
      battleScenarios: battleSceneId ? [battleSceneId] : [],
      battleWeather: formWeatherToFirestore(p.battleWeather),
      captureGroups: p.captureNormalGroupIds.map((x) => String(x).trim()).filter(Boolean),
      capturePokemonIds,
      safariCaptureGroups: p.allowsSafari
        ? p.captureSafariGroupIds.map((x) => String(x).trim()).filter(Boolean)
        : [],
      safariPokemonIds: p.allowsSafari ? safariPokemonIds : [],
      status: p.biomeStatus,
      visibleOnMap: p.visibleOnMap,
      isStartBiome: p.isStartBiome,
      mapPosition: mapPosition || null,
      isPlacedOnMap: Boolean(isPlacedOnMap && mapPosition),
      hidden: p.biomeStatus === "inactive",
      updatedAt: serverTimestamp(),
      ...(existingBiome.exists() ? {} : { createdAt: serverTimestamp() }),
      unlockRules: deleteField(),
      nextBiomeIds: deleteField(),
      requiresTicket: deleteField(),
      ticketProductCode: deleteField(),
    },
    { merge: true }
  );

  const speciesNameById = new Map<number, string>();
  for (const sid of p.captureNormalSpeciesIds) {
    speciesNameById.set(sid, `#${sid}`);
  }
  await syncEncounterPrefix(
    db,
    encounterPrefix(bid, false),
    bid,
    p.captureNormalGroupIds,
    p.captureNormalSpeciesIds,
    speciesNameById
  );

  if (p.allowsSafari) {
    const safariNames = new Map(speciesNameById);
    for (const sid of p.captureSafariSpeciesIds) {
      if (!safariNames.has(sid)) safariNames.set(sid, `#${sid}`);
    }
    await syncEncounterPrefix(
      db,
      encounterPrefix(bid, true),
      bid,
      p.captureSafariGroupIds,
      p.captureSafariSpeciesIds,
      safariNames
    );
  } else {
    await wipeEncounterPrefix(db, encounterPrefix(bid, true));
    try {
      await deleteDoc(doc(db, "biomeEncounterConfig", encounterPrefix(bid, true)));
    } catch {
      /* ok */
    }
  }

  await syncBiomeEvolutionRules(db, bid, p.evolutionEnabled, p.evolutionPairs);
}

export async function loadBiomeCadastroDraft(
  db: Firestore,
  biomeId: string,
  loadEvolutionPairs: (id: string) => Promise<BiomeEvolutionPair[]>
): Promise<Partial<BiomeCadastroPayload> | null> {
  const bid = String(biomeId || "").trim().toLowerCase();
  if (!bid) return null;
  const snap = await getDoc(doc(db, "biomes", bid));
  if (!snap.exists()) return null;
  const data = snap.data() as Record<string, unknown>;

  const prefix = encounterPrefix(bid, false);
  const [groupsSnap, indSnap] = await Promise.all([
    getDocs(collection(db, "biomeEncounterConfig", prefix, "groups")),
    getDocs(collection(db, "biomeEncounterConfig", prefix, "individual")),
  ]);
  let captureNormalGroupIds = groupsSnap.docs.map((d) => d.id);
  const captureNormalSpeciesIds: number[] = [];
  for (const d of indSnap.docs) {
    const row = d.data() as { speciesId?: unknown };
    const sid = Math.trunc(Number(row.speciesId ?? d.id));
    if (sid > 0) captureNormalSpeciesIds.push(sid);
  }

  const cg = data.captureGroups;
  if (Array.isArray(cg) && cg.length) {
    captureNormalGroupIds = cg.map((x) => String(x).trim()).filter(Boolean);
  }
  const cp = data.capturePokemonIds;
  if (Array.isArray(cp) && cp.length) {
    const fromDoc = cp.map((x) => Math.trunc(Number(x))).filter((x) => x > 0);
    if (fromDoc.length) {
      captureNormalSpeciesIds.length = 0;
      captureNormalSpeciesIds.push(...fromDoc);
    }
  }

  let captureSafariGroupIds: string[] = [];
  const captureSafariSpeciesIds: number[] = [];
  if (data.allowsSafari === true) {
    const sp = encounterPrefix(bid, true);
    const [sg, si] = await Promise.all([
      getDocs(collection(db, "biomeEncounterConfig", sp, "groups")),
      getDocs(collection(db, "biomeEncounterConfig", sp, "individual")),
    ]);
    captureSafariGroupIds = sg.docs.map((d) => d.id);
    for (const d of si.docs) {
      const row = d.data() as { speciesId?: unknown };
      const sid = Math.trunc(Number(row.speciesId ?? d.id));
      if (sid > 0) captureSafariSpeciesIds.push(sid);
    }
    const sgFire = data.safariCaptureGroups;
    if (Array.isArray(sgFire) && sgFire.length) {
      captureSafariGroupIds = sgFire.map((x) => String(x).trim()).filter(Boolean);
    }
    const spFire = data.safariPokemonIds;
    if (Array.isArray(spFire) && spFire.length) {
      captureSafariSpeciesIds.length = 0;
      captureSafariSpeciesIds.push(...spFire.map((x) => Math.trunc(Number(x))).filter((x) => x > 0));
    }
  }

  const battleSceneId =
    String(data.battleSceneId || "").trim().toLowerCase() ||
    (Array.isArray(data.battleScenarios) && data.battleScenarios[0]
      ? String(data.battleScenarios[0]).trim().toLowerCase()
      : "");

  const statusRaw = String(data.status || (data.hidden === true ? "inactive" : "active")).toLowerCase();
  const biomeStatus = statusRaw === "inactive" ? "inactive" : "active";

  const mapPos = data.mapPosition;
  let mapPosition: { x: number; y: number } | null = null;
  if (mapPos && typeof mapPos === "object") {
    const o = mapPos as Record<string, unknown>;
    const x = Number(o.x);
    const y = Number(o.y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      mapPosition = { x, y };
    }
  }

  const rawNpcs = Array.isArray(data.npcs) ? data.npcs : [];
  const npcs: BiomeNpcFirestore[] = [];
  for (const row of rawNpcs) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = String(r.id || "").trim();
    const name = String(r.name || "").trim();
    if (!id || !name) continue;
    const role = (String(r.role || "remember").trim().toLowerCase() as BiomeNpcFirestore["role"]) || "remember";
    npcs.push({
      id,
      role: ["nurse", "breeder", "specialist", "remember", "fisherman"].includes(role)
        ? role
        : "remember",
      name,
      imageUrl: String(r.imageUrl || ""),
      specialistType: role === "specialist" ? String(r.specialistType || "") : null,
    });
  }

  if (!npcs.length && Array.isArray(data.npcIds) && data.npcIds.length) {
    for (const nid of data.npcIds) {
      const id = String(nid || "").trim();
      if (!id) continue;
      npcs.push({
        id,
        role: "remember",
        name: id,
        imageUrl: "",
        specialistType: null,
      });
    }
  }

  const evolutionPairs = await loadEvolutionPairs(bid);

  return {
    biomeId: bid,
    name: String(data.name || bid),
    description: String(data.description || ""),
    imageDataUrl: String(data.imageUrl || ""),
    order: Math.max(0, Math.trunc(Number(data.order ?? 0))),
    allowsFishing: data.allowsFishing === true,
    allowsSafari: data.allowsSafari === true,
    acceptsGym: data.acceptsGym === true,
    evolutionEnabled: data.evolutionEnabled === true || evolutionPairs.length > 0,
    evolutionPairs,
    npcEnabled: npcs.length > 0 || (Array.isArray(data.npcIds) && data.npcIds.length > 0),
    npcs,
    battleScenarioId: battleSceneId,
    battleWeather: mapFirestoreWeatherToForm(data.battleWeather),
    captureNormalGroupIds,
    captureNormalSpeciesIds,
    captureSafariGroupIds,
    captureSafariSpeciesIds,
    biomeStatus,
    visibleOnMap: data.visibleOnMap === true,
    isStartBiome: data.isStartBiome === true,
    mapPosition,
    isPlacedOnMap: data.isPlacedOnMap === true,
  };
}

export { adminNpcRoleToBiomeRole };
