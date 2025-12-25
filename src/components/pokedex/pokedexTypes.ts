// src/components/pokedex/pokedexTypes.ts

export type PokemonType =
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

export const ALL_TYPES: PokemonType[] = [
  "normal",
  "fire",
  "water",
  "electric",
  "grass",
  "ice",
  "fighting",
  "poison",
  "ground",
  "flying",
  "psychic",
  "bug",
  "rock",
  "ghost",
  "dragon",
  "dark",
  "steel",
  "fairy",
];

export type TypeMultiplier = 0 | 0.25 | 0.5 | 1 | 2 | 4;

/** Estrutura real do JSON: abilities = [{ abilityId, isHidden, slot }] */
export type PokemonAbilityEntry = {
  abilityId: string; // ex: "overgrow"
  isHidden: boolean; // true = hidden ability
  slot?: number; // slot (quando existir)
};

/** Estrutura real do JSON: incubação */
export type PokemonIncubation = {
  hatchCounter: number;
  stepsPerCycle: number;
  stepsToHatch: number;
};

/** Estrutura real do JSON: flags */
export type PokemonFlags = {
  legendary: boolean;
  mythical: boolean;
};

/** Estrutura real do JSON: sprites (links) */
export type PokemonSprites = {
  // muitas espécies têm esses 4 no species
  frontDefault?: string | null;
  frontShiny?: string | null;

  // padrão “usável no app” (normalmente HOME / official / etc.)
  default?: string | null;
  shiny?: string | null;

  // opcional (se você gravar isso no script de forms/species)
  source?: "home" | "official-artwork" | "front" | "none" | string;
};

/**
 * Estrutura real do JSON: typeMatchups
 * - multipliers: mapa de tipo -> multiplicador (0, 0.25, 0.5, 1, 2, 4)
 * - weak/resist: lista pronta
 * - neutral/immune: lista pronta
 */
export type TypeMatchupEntry = {
  type: PokemonType;
  multiplier: TypeMultiplier;
};

export type TypeMatchups = {
  multipliers: Partial<Record<PokemonType, TypeMultiplier>>;
  immune: PokemonType[];
  resist: TypeMatchupEntry[];
  weak: TypeMatchupEntry[];
  neutral: PokemonType[];
};

/**
 * Evoluções (vem pronto no JSON; mantemos permissivo)
 * Você pode tipar mais depois, mas sem inventar regra nova aqui.
 */
export type PokemonEvolutions = {
  chainId?: string;
  fromId?: string;
  toId?: string;
  // alguns geradores colocam mais campos; mantemos compatível
  [k: string]: any;
};

/** Stats fixos */
export type PokemonBaseStats = {
  hp: number;
  attack: number;
  defense: number;
  specialAttack: number;
  specialDefense: number;
  speed: number;
};

/**
 * FORMS (Mega/Gmax)
 * - formId/baseSpeciesId/formType/displayName
 * - mechanics (mega/gmax)
 */
export type PokemonFormType = "mega" | "gigantamax" | "other";

/** Campo mechanics do forms.json (mantemos compatível e sem inventar demais) */
export type PokemonFormMechanics = {
  mega?: {
    megaStoneItemId?: string | null;
    [k: string]: any;
  };
  gigantamax?: {
    [k: string]: any;
  };
  [k: string]: any;
};

/**
 * ✅ Tipo principal que o Admin usa para renderizar (species e forms juntos).
 *
 * IMPORTANTE:
 * - Species vem com: heightM/weightKg
 * - Forms vem com: height/weight
 * Para o Admin, você pode normalizar e usar um ou outro.
 * Aqui deixamos ambos como opcionais para compatibilidade.
 */
export type PokemonSpecies = {
  // Identidade básica
  id: string; // speciesId OU formId quando for forma
  dexNumber: number; // número dex (para forms, normalmente o dex do base)
  name: string; // species name ou displayName quando for forma

  // Tipos
  types: PokemonType[];

  // Flags fixas
  generation: number;
  captureRate: number;
  flags: PokemonFlags;

  // Stats / biologia
  baseStats: PokemonBaseStats;

  // do species.json
  abilities: PokemonAbilityEntry[];
  eggGroups?: string[];
  heightM?: number;
  weightKg?: number;
  incubation?: PokemonIncubation;

  // do forms.json (caso você não normalize)
  height?: number;
  weight?: number;

  // Sprites
  sprites: PokemonSprites;

  // Matchups fixos (species.json)
  typeMatchups?: TypeMatchups;

  // Evoluções
  evolutions?: PokemonEvolutions;

  // Texto/enciclopédia (se existir no seu JSON)
  dexEntryPtBr?: string | null;

  // Opcional (usado no admin p/ agrupar/estilo)
  pokemonClass?: string;

  // ===== Campos opcionais para FORMS =====
  baseSpeciesId?: string; // forms.json
  formType?: PokemonFormType;
  displayName?: string; // forms.json (se você quiser usar separado do name)
  mechanics?: PokemonFormMechanics;

  // Alguns geradores adicionam mais campos — manter extensível
  [k: string]: any;
};
