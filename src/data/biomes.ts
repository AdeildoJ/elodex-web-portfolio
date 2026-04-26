export type AdminBiome = {
  id: string;
  name: string;
  order?: number;
  description?: string;
  imageUrl?: string;
  hasDaycare?: boolean;
  hasPokemart?: boolean;
  requiresTicket?: boolean;
  ticketProductCode?: string | null;
};

export type BiomeNpcRole =
  | "nurse"
  | "breeder"
  | "specialist"
  | "remember"
  | "policial"
  | "ladrao"
  | "enfermeiro"
  | "criador"
  | "fisherman"
  | "pescador"
  | "pescadora";

export type BiomeNpcConfig = {
  id: string;
  role: BiomeNpcRole;
  name: string;
  imageUrl: string;
  specialistType?: string | null;
};

/** Lista legada removida: biomas vêm apenas do Firestore (`biomes`). */
export const DEFAULT_ADMIN_BIOMES: AdminBiome[] = [];

export const ADMIN_BIOMES = DEFAULT_ADMIN_BIOMES;
