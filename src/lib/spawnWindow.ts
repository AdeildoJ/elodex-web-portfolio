export type SpawnWindow = {
  dateStart?: string;
  dateEnd?: string;
  timeStart?: string;
  timeEnd?: string;
};

export function emptySpawnWindow(): SpawnWindow {
  return { dateStart: "", dateEnd: "", timeStart: "", timeEnd: "" };
}

export function spawnWindowFromFirestore(raw: unknown): SpawnWindow {
  if (!raw || typeof raw !== "object") return emptySpawnWindow();
  const o = raw as Record<string, unknown>;
  return {
    dateStart: typeof o.dateStart === "string" ? o.dateStart : "",
    dateEnd: typeof o.dateEnd === "string" ? o.dateEnd : "",
    timeStart: typeof o.timeStart === "string" ? o.timeStart : "",
    timeEnd: typeof o.timeEnd === "string" ? o.timeEnd : "",
  };
}

/** Retorna objeto para Firestore ou null se não há restrição. */
export function spawnWindowToFirestore(w: SpawnWindow | undefined | null): SpawnWindow | null {
  if (!w) return null;
  const dateStart = String(w.dateStart || "").trim();
  const dateEnd = String(w.dateEnd || "").trim();
  const timeStart = String(w.timeStart || "").trim();
  const timeEnd = String(w.timeEnd || "").trim();
  if (!dateStart && !dateEnd && !timeStart && !timeEnd) return null;
  const out: SpawnWindow = {};
  if (dateStart) out.dateStart = dateStart;
  if (dateEnd) out.dateEnd = dateEnd;
  if (timeStart) out.timeStart = timeStart;
  if (timeEnd) out.timeEnd = timeEnd;
  return out;
}
