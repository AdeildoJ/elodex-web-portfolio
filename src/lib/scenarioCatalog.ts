export type ScenarioSpecialType = "climate" | "status";
export type ScenarioClimateType = "rain" | "sun" | "sandstorm" | "hail" | "snow";
export type ScenarioSourceType = "legacy" | "custom";

export type GymElementType =
  | "normal"
  | "fire"
  | "water"
  | "electric"
  | "grass"
  | "ice"
  | "fighting"
  | "poison"
  | "ground"
  | "flying"
  | "psychic"
  | "bug"
  | "rock"
  | "ghost"
  | "dragon"
  | "dark"
  | "steel"
  | "fairy";

export type ScenarioBattleAssetOverrides = {
  background: string;
  backgroundDay: string;
  backgroundNight: string;
};

export type ScenarioRecord = {
  id: string;
  scenarioId: string;
  name: string;
  imageUrl: string;
  processedImageUrl: string;
  isCommercialized: boolean;
  ecoinPrice: number | null;
  isSpecial: boolean;
  specialType: ScenarioSpecialType | null;
  climateType: ScenarioClimateType | null;
  gymElementType: GymElementType | null;
  isActive: boolean;
  sourceType: ScenarioSourceType;
  legacyScenarioId: string | null;
  battleAssets: ScenarioBattleAssetOverrides;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export const LEGACY_SCENARIOS = [
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
] as const;

export const SCENARIO_SPECIAL_TYPE_OPTIONS: Array<{ value: ScenarioSpecialType; label: string }> = [
  { value: "climate", label: "Clima" },
  { value: "status", label: "Status" },
];

export const SCENARIO_CLIMATE_OPTIONS: Array<{ value: ScenarioClimateType; label: string }> = [
  { value: "rain", label: "Rain" },
  { value: "sun", label: "Sun" },
  { value: "sandstorm", label: "Sandstorm" },
  { value: "hail", label: "Hail" },
  { value: "snow", label: "Snow" },
];

export const GYM_ELEMENT_OPTIONS: Array<{ value: GymElementType; label: string }> = [
  { value: "normal", label: "Normal" },
  { value: "fire", label: "Fire" },
  { value: "water", label: "Water" },
  { value: "electric", label: "Electric" },
  { value: "grass", label: "Grass" },
  { value: "ice", label: "Ice" },
  { value: "fighting", label: "Fighting" },
  { value: "poison", label: "Poison" },
  { value: "ground", label: "Ground" },
  { value: "flying", label: "Flying" },
  { value: "psychic", label: "Psychic" },
  { value: "bug", label: "Bug" },
  { value: "rock", label: "Rock" },
  { value: "ghost", label: "Ghost" },
  { value: "dragon", label: "Dragon" },
  { value: "dark", label: "Dark" },
  { value: "steel", label: "Steel" },
  { value: "fairy", label: "Fairy" },
];

export function slugifyScenario(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getScenarioDisplayName(id: string) {
  return String(id || "")
    .split(/[-_]/g)
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

export function createLegacyScenarioSeed(id: string): ScenarioRecord {
  const normalizedId = slugifyScenario(id);
  return {
    id: normalizedId,
    scenarioId: normalizedId,
    name: getScenarioDisplayName(normalizedId),
    imageUrl: "",
    processedImageUrl: "",
    isCommercialized: false,
    ecoinPrice: null,
    isSpecial: false,
    specialType: null,
    climateType: null,
    gymElementType: null,
    isActive: true,
    sourceType: "legacy",
    legacyScenarioId: normalizedId,
    battleAssets: {
      background: "",
      backgroundDay: "",
      backgroundNight: "",
    },
  };
}

export function normalizeScenarioRecord(id: string, raw: unknown): ScenarioRecord {
  const base = createLegacyScenarioSeed(id);
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const scenarioId = slugifyScenario(String(data.scenarioId || id));
  const specialTypeRaw = String(data.specialType || "").trim().toLowerCase();
  const climateTypeRaw = String(data.climateType || "").trim().toLowerCase();
  const gymElementTypeRaw = String(data.gymElementType || "").trim().toLowerCase();
  const battleAssetsRaw =
    data.battleAssets && typeof data.battleAssets === "object"
      ? (data.battleAssets as Record<string, unknown>)
      : {};

  return {
    ...base,
    id: scenarioId,
    scenarioId,
    name: String(data.name || base.name || scenarioId),
    imageUrl: String(data.imageUrl || ""),
    processedImageUrl: String(data.processedImageUrl || ""),
    isCommercialized: Boolean(data.isCommercialized),
    ecoinPrice:
      typeof data.ecoinPrice === "number" && Number.isFinite(data.ecoinPrice) ? data.ecoinPrice : null,
    isSpecial: Boolean(data.isSpecial),
    specialType: specialTypeRaw === "climate" || specialTypeRaw === "status" ? specialTypeRaw : null,
    climateType:
      climateTypeRaw === "rain" ||
      climateTypeRaw === "sun" ||
      climateTypeRaw === "sandstorm" ||
      climateTypeRaw === "hail" ||
      climateTypeRaw === "snow"
        ? climateTypeRaw
        : null,
    gymElementType: gymElementTypeRaw ? (gymElementTypeRaw as GymElementType) : null,
    isActive: data.isActive === false ? false : true,
    sourceType: data.sourceType === "custom" ? "custom" : "legacy",
    legacyScenarioId: String(data.legacyScenarioId || base.legacyScenarioId || "") || null,
    battleAssets: {
      background: String(battleAssetsRaw.background || ""),
      backgroundDay: String(battleAssetsRaw.backgroundDay || ""),
      backgroundNight: String(battleAssetsRaw.backgroundNight || ""),
    },
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}
