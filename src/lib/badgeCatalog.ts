export type BadgeBonusType = "shiny" | "capture" | "xp" | "money" | "heal" | "loot";

export type BadgeRecord = {
  id: string;
  badgeId: string;
  name: string;
  imageUrl: string;
  description: string;
  bonusType: BadgeBonusType;
  bonusValue: number;
  isActive: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export const BADGE_BONUS_OPTIONS: Array<{
  value: BadgeBonusType;
  label: string;
  helper: string;
}> = [
  { value: "shiny", label: "Shiny", helper: "Aumenta levemente a chance de shiny." },
  { value: "capture", label: "Captura", helper: "Aumenta levemente a chance de captura." },
  { value: "xp", label: "XP", helper: "Concede bonus percentual de XP." },
  { value: "money", label: "Dinheiro", helper: "Concede bonus percentual de moedas." },
  { value: "heal", label: "Cura", helper: "Reduz um pouco o custo de cura." },
  { value: "loot", label: "Loot", helper: "Aumenta levemente a qualidade de itens encontrados." },
];

export function slugifyBadge(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeBadgeRecord(id: string, raw: unknown): BadgeRecord {
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const badgeId = slugifyBadge(String(data.badgeId || id));
  const bonusTypeRaw = String(data.bonusType || "").trim().toLowerCase() as BadgeBonusType;
  const fallbackBonus = BADGE_BONUS_OPTIONS[0].value;

  return {
    id: badgeId,
    badgeId,
    name: String(data.name || badgeId),
    imageUrl: String(data.imageUrl || ""),
    description: String(data.description || ""),
    bonusType: BADGE_BONUS_OPTIONS.some((item) => item.value === bonusTypeRaw) ? bonusTypeRaw : fallbackBonus,
    bonusValue: Math.max(0, Number(data.bonusValue || 0)),
    isActive: data.isActive === false ? false : true,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}
