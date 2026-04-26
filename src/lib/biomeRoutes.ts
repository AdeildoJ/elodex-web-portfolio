import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  type Firestore,
} from "firebase/firestore";

export type BiomeRouteStatus = "active" | "inactive";

export type BiomeRouteRecord = {
  id: string;
  fromBiomeId: string;
  toBiomeId: string;
  bidirectional: boolean;
  kmCost: number;
  requiredItemIds: string[];
  requiredMoveIds: string[];
  requiredPokemonIds: number[];
  requiresTicket: boolean;
  ticketItemId: string;
  consumeTicketOnEnter: boolean;
  status: BiomeRouteStatus;
};

function normId(s: string) {
  return String(s || "")
    .trim()
    .toLowerCase();
}

export function defaultRouteId(fromBiomeId: string, toBiomeId: string) {
  return `${normId(fromBiomeId)}__${normId(toBiomeId)}`;
}

export async function listBiomeRoutes(db: Firestore): Promise<BiomeRouteRecord[]> {
  const snap = await getDocs(collection(db, "biomeRoutes"));
  const rows: BiomeRouteRecord[] = [];
  snap.forEach((d) => {
    const x = d.data() as Record<string, unknown>;
    rows.push({
      id: d.id,
      fromBiomeId: normId(String(x.fromBiomeId || "")),
      toBiomeId: normId(String(x.toBiomeId || "")),
      bidirectional: x.bidirectional === true,
      kmCost: Math.max(0, Math.trunc(Number(x.kmCost ?? 0))),
      requiredItemIds: Array.isArray(x.requiredItemIds)
        ? x.requiredItemIds.map((v) => String(v).trim().toLowerCase()).filter(Boolean)
        : [],
      requiredMoveIds: Array.isArray(x.requiredMoveIds)
        ? x.requiredMoveIds.map((v) => String(v).trim().toLowerCase()).filter(Boolean)
        : [],
      requiredPokemonIds: Array.isArray(x.requiredPokemonIds)
        ? x.requiredPokemonIds.map((v) => Math.trunc(Number(v))).filter((n) => n > 0)
        : [],
      requiresTicket: x.requiresTicket === true,
      ticketItemId: String(x.ticketItemId || "").trim().toLowerCase(),
      consumeTicketOnEnter: x.consumeTicketOnEnter === true,
      status: String(x.status || "active").toLowerCase() === "inactive" ? "inactive" : "active",
    });
  });
  return rows;
}

export async function saveBiomeRoute(db: Firestore, route: BiomeRouteRecord): Promise<void> {
  const id = route.id || defaultRouteId(route.fromBiomeId, route.toBiomeId);
  const ref = doc(db, "biomeRoutes", id);
  const exists = (await getDoc(ref)).exists();
  await setDoc(
    ref,
    {
      id,
      fromBiomeId: normId(route.fromBiomeId),
      toBiomeId: normId(route.toBiomeId),
      bidirectional: route.bidirectional,
      kmCost: Math.max(0, Math.trunc(route.kmCost)),
      requiredItemIds: route.requiredItemIds.map((x) => normId(x)).filter(Boolean),
      requiredMoveIds: route.requiredMoveIds.map((x) => normId(x)).filter(Boolean),
      requiredPokemonIds: route.requiredPokemonIds.filter((n) => n > 0),
      requiresTicket: route.requiresTicket,
      ticketItemId: route.requiresTicket ? normId(route.ticketItemId) : "",
      consumeTicketOnEnter: route.consumeTicketOnEnter,
      status: route.status,
      updatedAt: serverTimestamp(),
      ...(exists ? {} : { createdAt: serverTimestamp() }),
    },
    { merge: true }
  );
}

export async function deleteBiomeRoute(db: Firestore, routeId: string): Promise<void> {
  await deleteDoc(doc(db, "biomeRoutes", routeId));
}
