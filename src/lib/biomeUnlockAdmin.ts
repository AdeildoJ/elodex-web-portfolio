export type UnlockRow =
  | { key: string; kind: "km"; minKm: string }
  | { key: string; kind: "mission"; missionId: string }
  | { key: string; kind: "party"; speciesIds: number[] }
  | { key: string; kind: "move"; moveIds: string[] }
  | { key: string; kind: "biome"; biomeIds: string[] }
  | { key: string; kind: "item"; itemIds: string[] }
  | { key: string; kind: "ticket"; productCode: string };

function newKey() {
  return `u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyUnlockRows(): UnlockRow[] {
  return [{ key: newKey(), kind: "km", minKm: "0" }];
}

function str(v: unknown) {
  return String(v || "").trim().toLowerCase();
}

function toInt(v: unknown, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : fb;
}

/** Converte unlockRules do Firestore em linhas de formulário (melhor esforço + retrocompat). */
export function parseUnlockRulesToRows(input: unknown): UnlockRow[] {
  if (!input || typeof input !== "object") return emptyUnlockRows();
  const root = input as Record<string, unknown>;
  const op = str(root.op);
  const rules = Array.isArray(root.rules) ? root.rules : [];

  if ((op === "and" || op === "or") && rules.length) {
    const rows: UnlockRow[] = [];
    for (const r of rules) {
      if (!r || typeof r !== "object") continue;
      const row = r as Record<string, unknown>;
      const type = str(row.type);
      if (type === "km") {
        rows.push({ key: newKey(), kind: "km", minKm: String(toInt(row.minKm, 0)) });
      } else if (type === "missioncompleted") {
        const ids = Array.isArray(row.missionIds) ? row.missionIds.map((x) => String(x).trim()).filter(Boolean) : [];
        rows.push({ key: newKey(), kind: "mission", missionId: ids[0] || "" });
      } else if (type === "speciesinparty") {
        const ids = Array.isArray(row.speciesIds)
          ? row.speciesIds.map((x) => toInt(x, 0)).filter((x) => x > 0)
          : [];
        rows.push({ key: newKey(), kind: "party", speciesIds: ids.slice(0, 12) });
      } else if (type === "move") {
        const mid = str(row.moveId);
        if (mid) rows.push({ key: newKey(), kind: "move", moveIds: [mid] });
      } else if (type === "biomeunlocked") {
        const ids = Array.isArray(row.biomeIds) ? row.biomeIds.map((x) => str(x)).filter(Boolean) : [];
        rows.push({ key: newKey(), kind: "biome", biomeIds: ids });
      } else if (type === "bagitem") {
        const ids = Array.isArray(row.itemIds) ? row.itemIds.map((x) => String(x).trim().toLowerCase()).filter(Boolean) : [];
        rows.push({ key: newKey(), kind: "item", itemIds: ids.slice(0, 24) });
      } else if (type === "ticketproduct") {
        const code = String(row.productCode || "").trim().toLowerCase();
        rows.push({ key: newKey(), kind: "ticket", productCode: code });
      }
    }
    if (rows.length) return rows;
  }

  return emptyUnlockRows();
}

/** Monta árvore AND com cada linha como regra atômica (OR interno quando necessário). */
export function buildUnlockRulesFromRows(rows: UnlockRow[]): unknown {
  const atomic: unknown[] = [];
  for (const row of rows) {
    if (row.kind === "km") {
      atomic.push({ type: "km", minKm: toInt(row.minKm, 0) });
    } else if (row.kind === "mission" && row.missionId) {
      atomic.push({ type: "missionCompleted", missionIds: [row.missionId], match: "any" });
    } else if (row.kind === "party" && row.speciesIds.length) {
      atomic.push({ type: "speciesInParty", speciesIds: row.speciesIds, match: "any" });
    } else if (row.kind === "move" && row.moveIds.length) {
      const moves = row.moveIds.map((m) => String(m).trim().toLowerCase()).filter(Boolean);
      if (moves.length === 1) atomic.push({ type: "move", moveId: moves[0] });
      else atomic.push({ op: "OR", rules: moves.map((moveId) => ({ type: "move", moveId })) });
    } else if (row.kind === "biome" && row.biomeIds.length) {
      atomic.push({
        type: "biomeUnlocked",
        biomeIds: row.biomeIds.map((x) => str(x)).filter(Boolean),
        match: "all",
      });
    } else if (row.kind === "item" && row.itemIds.length) {
      const ids = row.itemIds.map((x) => String(x).trim().toLowerCase()).filter(Boolean);
      if (ids.length) atomic.push({ type: "bagItem", itemIds: ids, match: "any" });
    } else if (row.kind === "ticket" && row.productCode) {
      atomic.push({ type: "ticketProduct", productCode: String(row.productCode).trim().toLowerCase() });
    }
  }
  if (!atomic.length) return { op: "OR", rules: [{ type: "km", minKm: 0 }] };
  if (atomic.length === 1) return atomic[0];
  return { op: "AND", rules: atomic };
}
