export type AdminBiome = {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  hasDaycare?: boolean;
  hasPokemart?: boolean;
};

export type BiomeNpcRole = "nurse" | "breeder" | "specialist" | "remember";

export type BiomeNpcConfig = {
  id: string;
  role: BiomeNpcRole;
  name: string;
  imageUrl: string;
  specialistType?: string | null;
};

export const DEFAULT_ADMIN_BIOMES: AdminBiome[] = [
  { id: "planice-sylphia", name: "PlaniceSylphia" },
  { id: "floresta-esmeralda", name: "FlorestaEsmeralda" },
  { id: "floresta-luminar", name: "FlorestaLuminar" },
  { id: "caverna-luminar", name: "CavernaLuminar" },
  { id: "caverna-luminar-subsolo", name: "CavernaLuminarSubSolo" },
  { id: "praia-coralina", name: "PraiaCoralina" },
  { id: "lago-estelar", name: "LagoEstelar" },
  { id: "porto-azuria", name: "PortoAzuria" },
];

// Compatibilidade com código legado enquanto migramos para biomes/{id} no Firestore.
export const ADMIN_BIOMES = DEFAULT_ADMIN_BIOMES;
