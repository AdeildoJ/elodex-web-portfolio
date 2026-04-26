import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import evolutionTargetsBySpecies from "@/data/evolutionTargetsBySpecies.json";

export type BiomeEvolutionPair = { fromSpeciesId: number; toSpeciesId: number };

const TARGETS = evolutionTargetsBySpecies as Record<string, number[]>;

/** Destinos de evolução válidos (gerado em build a partir do mesmo catálogo do app). */
export function evolutionTargetsForSpecies(fromSpeciesId: number): number[] {
  const sid = Math.max(1, Math.trunc(Number(fromSpeciesId || 0)));
  const row = TARGETS[String(sid)];
  return Array.isArray(row) ? [...row] : [];
}

export function isValidEvolutionPair(fromSpeciesId: number, toSpeciesId: number): boolean {
  const to = Math.max(1, Math.trunc(Number(toSpeciesId || 0)));
  return evolutionTargetsForSpecies(fromSpeciesId).includes(to);
}

export function pairKey(fromSpeciesId: number, toSpeciesId: number): string {
  return `${Math.max(1, Math.trunc(fromSpeciesId))}_${Math.max(1, Math.trunc(toSpeciesId))}`;
}

/** ID determinístico em evolutionConfigRules para regra gerenciada pelo bioma. */
export function biomeEvolutionDocId(biomeId: string, fromSpeciesId: number, toSpeciesId: number): string {
  const b = String(biomeId || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-");
  return `biome_${b}_${pairKey(fromSpeciesId, toSpeciesId)}`;
}

export async function loadBiomeEvolutionPairs(db: Firestore, biomeId: string): Promise<BiomeEvolutionPair[]> {
  const bid = String(biomeId || "").trim().toLowerCase();
  if (!bid) return [];
  const snap = await getDocs(collection(db, "evolutionConfigRules"));
  const out: BiomeEvolutionPair[] = [];
  snap.forEach((d) => {
    const x = d.data() as Record<string, unknown>;
    if (String(x.biomeRuleOwnerId || "").toLowerCase() !== bid) return;
    if (x.enabled === false) return;
    const from = Math.max(1, Math.trunc(Number(x.fromSpeciesId ?? 0)));
    const to = Math.max(1, Math.trunc(Number(x.toSpeciesId ?? 0)));
    if (!from || !to) return;
    out.push({ fromSpeciesId: from, toSpeciesId: to });
  });
  out.sort((a, b) => a.fromSpeciesId - b.fromSpeciesId || a.toSpeciesId - b.toSpeciesId);
  return out;
}

/** Remove regras gerenciadas por este bioma e, se habilitado, grava os pares (evolutionConfigRules). */
export async function syncBiomeEvolutionRules(
  db: Firestore,
  biomeId: string,
  allows: boolean,
  pairs: BiomeEvolutionPair[]
): Promise<void> {
  const bid = String(biomeId || "").trim().toLowerCase();
  if (!bid) return;

  const snap = await getDocs(collection(db, "evolutionConfigRules"));
  const toRemove = snap.docs.filter((d) => String((d.data() as Record<string, unknown>).biomeRuleOwnerId || "").toLowerCase() === bid);

  for (let i = 0; i < toRemove.length; i += 400) {
    const batch = writeBatch(db);
    for (const d of toRemove.slice(i, i + 400)) {
      batch.delete(d.ref);
    }
    await batch.commit();
  }

  if (!allows) return;

  const seen = new Set<string>();
  const validPairs = pairs.filter((p) => {
    const k = pairKey(p.fromSpeciesId, p.toSpeciesId);
    if (seen.has(k)) return false;
    seen.add(k);
    return isValidEvolutionPair(p.fromSpeciesId, p.toSpeciesId);
  });

  for (let i = 0; i < validPairs.length; i += 400) {
    const batch = writeBatch(db);
    const chunk = validPairs.slice(i, i + 400);
    for (const p of chunk) {
      const id = biomeEvolutionDocId(bid, p.fromSpeciesId, p.toSpeciesId);
      const ref = doc(db, "evolutionConfigRules", id);
      batch.set(
        ref,
        {
          enabled: true,
          fromSpeciesId: p.fromSpeciesId,
          toSpeciesId: p.toSpeciesId,
          biomeId: bid,
          biomeRuleOwnerId: bid,
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );
    }
    await batch.commit();
  }
}

/** Exclui todas as regras de evolução ligadas ao bioma (ex.: antes de apagar o bioma). */
export async function deleteAllBiomeEvolutionRules(db: Firestore, biomeId: string): Promise<void> {
  const bid = String(biomeId || "").trim().toLowerCase();
  if (!bid) return;
  const snap = await getDocs(collection(db, "evolutionConfigRules"));
  const toRemove = snap.docs.filter((d) => String((d.data() as Record<string, unknown>).biomeRuleOwnerId || "").toLowerCase() === bid);
  for (const d of toRemove) {
    await deleteDoc(d.ref);
  }
}
