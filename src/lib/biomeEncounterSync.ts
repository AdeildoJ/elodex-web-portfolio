import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";

import type { Firestore } from "firebase/firestore";

import { spawnWindowFromFirestore, spawnWindowToFirestore, type SpawnWindow } from "./spawnWindow";

const DEFAULT_VERSION = "elodex-base";

export type SpeciesSlot = {
  speciesId: number;
  max: number | null;
  capturedCount: number;
  spawnWindow?: SpawnWindow | null;
};

function n(v: unknown, fb = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fb;
}

function toSpeciesList(data: Record<string, unknown>): number[] {
  const raw = data.speciesIds;
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => Math.trunc(n(x, 0))).filter((x) => x > 0);
}

function quotaRowForSpecies(quotasRaw: unknown, sid: number): Record<string, unknown> | undefined {
  if (!Array.isArray(quotasRaw)) return undefined;
  for (const row of quotasRaw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (Math.trunc(n(r.speciesId, 0)) === sid) return r;
  }
  return undefined;
}

function effectiveSpawnWindowForSlot(
  groupData: Record<string, unknown>,
  quotaRow: Record<string, unknown> | undefined
): SpawnWindow | null {
  const fromQuota = quotaRow
    ? spawnWindowToFirestore(spawnWindowFromFirestore(quotaRow.spawnWindow ?? {}))
    : null;
  if (fromQuota) return fromQuota;
  return spawnWindowToFirestore(spawnWindowFromFirestore(groupData.spawnWindow ?? {}));
}

function buildSlotsFromGroupData(
  data: Record<string, unknown>,
  previous: Record<string, unknown> | undefined
): SpeciesSlot[] {
  const speciesIds = toSpeciesList(data);
  const quotasRaw = data.speciesQuotas;
  const quotaBySpecies = new Map<number, number | null>();
  if (Array.isArray(quotasRaw)) {
    for (const row of quotasRaw) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const sid = Math.trunc(n(r.speciesId, 0));
      if (sid <= 0) continue;
      const maxRaw = r.max;
      quotaBySpecies.set(sid, maxRaw == null ? null : Math.max(0, Math.trunc(n(maxRaw, 0))));
    }
  }

  const prevSlots = Array.isArray(previous?.speciesSlots)
    ? (previous!.speciesSlots as unknown[])
    : [];
  const prevBySpecies = new Map<number, SpeciesSlot>();
  for (const row of prevSlots) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const sid = Math.trunc(n(r.speciesId, 0));
    if (sid <= 0) continue;
    prevBySpecies.set(sid, {
      speciesId: sid,
      max: r.max == null ? null : Math.max(0, Math.trunc(n(r.max, 0))),
      capturedCount: Math.max(0, Math.trunc(n(r.capturedCount, 0))),
    });
  }

  return speciesIds.map((sid) => {
    const pq = prevBySpecies.get(sid);
    const max = quotaBySpecies.has(sid) ? quotaBySpecies.get(sid)! : pq?.max ?? null;
    const quotaRow = quotaRowForSpecies(quotasRaw, sid);
    const sw = effectiveSpawnWindowForSlot(data, quotaRow);
    const base: SpeciesSlot = {
      speciesId: sid,
      max,
      capturedCount: pq?.speciesId === sid ? pq.capturedCount : 0,
    };
    if (sw) base.spawnWindow = sw;
    return base;
  });
}

async function commitBatches(db: Firestore, ops: Array<{ ref: ReturnType<typeof doc>; data: Record<string, unknown> }>) {
  let batch = writeBatch(db);
  let count = 0;
  for (const op of ops) {
    batch.set(op.ref, op.data, { merge: true });
    count += 1;
    if (count >= 450) {
      await batch.commit();
      batch = writeBatch(db);
      count = 0;
    }
  }
  if (count > 0) await batch.commit();
}

/**
 * Sincroniza biomeEncounterConfig a partir do cadastro do bioma + catálogos (grupos / encontros especiais).
 */
export async function syncBiomeEncounterConfig(
  db: Firestore,
  biomeId: string,
  opts: { groupIds: string[]; wildEncounterIds: string[]; versionId?: string }
): Promise<void> {
  const versionId = String(opts.versionId || DEFAULT_VERSION).trim() || DEFAULT_VERSION;
  const bid = String(biomeId || "").trim().toLowerCase();
  if (!bid) return;

  const prefix = `${versionId}_${bid}`;
  const rootRef = doc(db, "biomeEncounterConfig", prefix);
  const groupsPath = collection(db, "biomeEncounterConfig", prefix, "groups");
  const individualPath = collection(db, "biomeEncounterConfig", prefix, "individual");

  const [existingGroupsSnap, existingIndSnap] = await Promise.all([
    getDocs(groupsPath),
    getDocs(individualPath),
  ]);

  const prevGroupData = new Map<string, Record<string, unknown>>();
  existingGroupsSnap.forEach((d) => prevGroupData.set(d.id, d.data() as Record<string, unknown>));

  const prevIndData = new Map<string, Record<string, unknown>>();
  existingIndSnap.forEach((d) => prevIndData.set(d.id, d.data() as Record<string, unknown>));

  const keepGroupIds = new Set(opts.groupIds.map((x) => String(x).trim()).filter(Boolean));
  const deleteBatch = writeBatch(db);
  let delCount = 0;
  for (const d of existingGroupsSnap.docs) {
    if (!keepGroupIds.has(d.id)) {
      deleteBatch.delete(d.ref);
      delCount += 1;
    }
  }
  const keepIndSpecies = new Set<string>();
  for (const wid of opts.wildEncounterIds.map((x) => String(x).trim()).filter(Boolean)) {
    const wSnap = await getDoc(doc(db, "wildEncounters", wid));
    if (!wSnap.exists()) continue;
    const wd = wSnap.data() as Record<string, unknown>;
    const speciesId = Math.trunc(n(wd.speciesId, 0));
    if (speciesId > 0) keepIndSpecies.add(String(speciesId));
  }
  for (const d of existingIndSnap.docs) {
    if (!keepIndSpecies.has(d.id)) {
      deleteBatch.delete(d.ref);
      delCount += 1;
    }
  }
  if (delCount > 0) await deleteBatch.commit();

  await setDoc(
    rootRef,
    {
      versionId,
      biomeId: bid,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  const writes: Array<{ ref: ReturnType<typeof doc>; data: Record<string, unknown> }> = [];

  for (const gid of keepGroupIds) {
    const gSnap = await getDoc(doc(db, "captureConfigGroups", gid));
    if (!gSnap.exists()) continue;
    const gd = gSnap.data() as Record<string, unknown>;
    const speciesIds = toSpeciesList(gd);
    if (!speciesIds.length) continue;
    const slots = buildSlotsFromGroupData(gd, prevGroupData.get(gid));
    const groupSpawn = spawnWindowToFirestore(spawnWindowFromFirestore(gd.spawnWindow ?? {}));
    const groupPayload: Record<string, unknown> = {
      versionId,
      biomeId: bid,
      groupId: gid,
      groupName: String(gd.name || gid),
      speciesIds,
      speciesSlots: slots,
      config: gd.config && typeof gd.config === "object" ? gd.config : {},
      updatedAt: serverTimestamp(),
    };
    if (groupSpawn) groupPayload.spawnWindow = groupSpawn;
    writes.push({
      ref: doc(db, "biomeEncounterConfig", prefix, "groups", gid),
      data: groupPayload,
    });
  }

  for (const wid of opts.wildEncounterIds.map((x) => String(x).trim()).filter(Boolean)) {
    const wSnap = await getDoc(doc(db, "wildEncounters", wid));
    if (!wSnap.exists()) continue;
    const wd = wSnap.data() as Record<string, unknown>;
    const speciesId = Math.trunc(n(wd.speciesId, 0));
    if (speciesId <= 0) continue;
    const indKey = String(speciesId);
    const prev = prevIndData.get(indKey);
    const capturedCount = Math.max(0, Math.trunc(n(prev?.capturedCount, 0)));
    const captureLimit =
      wd.unlimitedCaptures === true ? null : wd.captureLimit == null ? null : Math.max(0, Math.trunc(n(wd.captureLimit, 0)));

    const indSpawn = spawnWindowToFirestore(spawnWindowFromFirestore(wd.spawnWindow ?? {}));
    const indPayload: Record<string, unknown> = {
      versionId,
      biomeId: bid,
      wildEncounterId: wid,
      speciesId,
      speciesName: String(wd.speciesName || ""),
      configMode: "individual",
      minLevel: n(wd.minLevel, 1),
      maxLevel: n(wd.maxLevel, 30),
      encounterRate: wd.encounterRate == null ? null : n(wd.encounterRate, 0),
      shinyRate: wd.shinyRate == null ? null : n(wd.shinyRate, 0),
      captureLimit,
      unlimitedCaptures: wd.unlimitedCaptures === true,
      capturedCount,
      isSpecial: wd.isSpecial === true,
      specialAbility: typeof wd.specialAbility === "string" ? wd.specialAbility : null,
      specialNature: typeof wd.specialNature === "string" ? wd.specialNature : null,
      specialMoves: Array.isArray(wd.specialMoves) ? wd.specialMoves : [],
      specialIVs: wd.specialIVs && typeof wd.specialIVs === "object" ? wd.specialIVs : {},
      specialEVs: wd.specialEVs && typeof wd.specialEVs === "object" ? wd.specialEVs : {},
      learnsetConstraints:
        wd.learnsetConstraints && typeof wd.learnsetConstraints === "object" ? wd.learnsetConstraints : {},
      updatedAt: serverTimestamp(),
    };
    if (indSpawn) indPayload.spawnWindow = indSpawn;
    writes.push({
      ref: doc(db, "biomeEncounterConfig", prefix, "individual", indKey),
      data: indPayload,
    });
  }

  await commitBatches(db, writes);

  const allSpecies = new Set<number>();
  for (const gid of keepGroupIds) {
    const gSnap = await getDoc(doc(db, "captureConfigGroups", gid));
    if (!gSnap.exists()) continue;
    toSpeciesList(gSnap.data() as Record<string, unknown>).forEach((s) => allSpecies.add(s));
  }
  keepIndSpecies.forEach((k) => {
    const sid = Math.trunc(n(k, 0));
    if (sid > 0) allSpecies.add(sid);
  });

  await setDoc(
    rootRef,
    {
      speciesIds: Array.from(allSpecies).sort((a, b) => a - b),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function deleteBiomeEncounterConfig(db: Firestore, biomeId: string, versionId = DEFAULT_VERSION) {
  const bid = String(biomeId || "").trim().toLowerCase();
  const prefix = `${versionId}_${bid}`;
  const groupsSnap = await getDocs(collection(db, "biomeEncounterConfig", prefix, "groups"));
  const indSnap = await getDocs(collection(db, "biomeEncounterConfig", prefix, "individual"));
  const batch = writeBatch(db);
  groupsSnap.forEach((d) => batch.delete(d.ref));
  indSnap.forEach((d) => batch.delete(d.ref));
  batch.delete(doc(db, "biomeEncounterConfig", prefix));
  await batch.commit();
}
