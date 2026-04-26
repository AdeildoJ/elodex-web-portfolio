export type ScenarioSpecialType = "climate" | "status";

export type ScenarioWeather =
  | "clear"
  | "sunny"
  | "rain"
  | "sandstorm"
  | "hail"
  | "fog";

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

export type ScenarioRecord = {
  id: string;
  name: string;
  isPaid: boolean;
  priceEcoin: number | null;
  isSpecial: boolean;
  specialType: ScenarioSpecialType | null;
  weather: ScenarioWeather;
  gymType: GymElementType | null;
  imageDay: string;
  imageNight: string;
  processedImageDay: string;
  processedImageNight: string;
  isActive: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export const SCENARIO_SPECIAL_TYPE_OPTIONS: Array<{ value: ScenarioSpecialType; label: string }> = [
  { value: "climate", label: "Clima" },
  { value: "status", label: "Status" },
];

export const SCENARIO_WEATHER_OPTIONS: Array<{ value: ScenarioWeather; label: string }> = [
  { value: "clear", label: "Limpo" },
  { value: "sunny", label: "Ensolarado" },
  { value: "rain", label: "Chuva" },
  { value: "sandstorm", label: "Tempestade de areia" },
  { value: "hail", label: "Granizo" },
  { value: "fog", label: "Neblina" },
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

export function normalizeScenarioRecord(id: string, raw: unknown): ScenarioRecord {
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const weatherRaw = String(
    data.weather ?? (data.specialType === "climate" ? data.climateType : null) ?? data.climateType ?? "clear"
  ).trim().toLowerCase();
  const gymTypeRaw = String(data.gymType || data.gymElementType || "").trim().toLowerCase();

  const weatherMap: Record<string, ScenarioWeather> = {
    clear: "clear",
    sunny: "sunny",
    sun: "sunny",
    rain: "rain",
    sandstorm: "sandstorm",
    hail: "hail",
    snow: "hail",
    fog: "fog",
  };
  const weather = weatherMap[weatherRaw] || "clear";

  const gymTypes = [
    "normal", "fire", "water", "electric", "grass", "ice", "fighting", "poison",
    "ground", "flying", "psychic", "bug", "rock", "ghost", "dragon", "dark", "steel", "fairy",
  ] as const;
  const gymType = gymTypes.includes(gymTypeRaw as GymElementType) ? (gymTypeRaw as GymElementType) : null;

  const processedDay = String(data.processedImageDay || data.processedImageUrl || data.imageDay || data.imageUrl || "").trim();
  const processedNight = String(data.processedImageNight || data.processedImageUrl || data.imageNight || "").trim();
  const rawDay = String(data.imageDay || data.imageUrl || processedDay || "").trim();
  const rawNight = String(data.imageNight || data.imageUrl || processedNight || "").trim();

  return {
    id: slugifyScenario(String(data.scenarioId || id)),
    name: String(data.name || id),
    isPaid: Boolean(data.isPaid ?? data.isCommercialized),
    priceEcoin:
      typeof data.priceEcoin === "number"
        ? data.priceEcoin
        : typeof data.ecoinPrice === "number" && Number.isFinite(data.ecoinPrice)
        ? data.ecoinPrice
        : null,
    isSpecial: Boolean(data.isSpecial),
    specialType:
      String(data.specialType || "").trim().toLowerCase() === "climate" ||
      String(data.specialType || "").trim().toLowerCase() === "status"
        ? (data.specialType as ScenarioSpecialType)
        : null,
    weather,
    gymType,
    imageDay: rawDay,
    imageNight: rawNight,
    processedImageDay: processedDay || rawDay,
    processedImageNight: processedNight || rawNight,
    isActive: data.isActive === false ? false : true,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}
