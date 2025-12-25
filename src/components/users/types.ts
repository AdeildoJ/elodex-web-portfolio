// src/components/users/types.ts
import type { Timestamp } from 'firebase/firestore';

export type PlayerStatus = 'active' | 'inactive';
export type PlayerAccountType = 'vip' | 'common';

export interface PlayerSummary {
  id: string;
  displayName: string;
  email: string;
  status: PlayerStatus;
  accountType: PlayerAccountType;
  createdAt?: Timestamp | null;
  boxCurrent?: number;
  boxTotalLimit?: number;
  ecoinBalance?: number;
  itemsCount?: number;
  hasExpiringPokemon?: boolean;
  boxIsFull?: boolean;
  lastLoginAt?: Timestamp | null;
  region?: string | null;
  characterClass?: string | null;
  starterSpeciesId?: string | null;
  level?: number;
  xp?: number;
  kmWalked?: number;
  pokedexSeen?: number;
  pokedexCaught?: number;
  missionsCompleted?: number;
  badges?: number;
}

export interface StatsBlock {
  hp?: number;
  atk?: number;
  def?: number;
  spAtk?: number;
  spDef?: number;
  speed?: number;
}

export interface PokemonMove {
  name: string;
  type?: string;
  category?: string;
  power?: number | null;
  accuracy?: number | null;
  pp?: number | null;
  learnedAtLevel?: number | null;
  method?: string; // levelUp, tm, egg, tutor...
}

export interface PokemonInstance {
  id: string;
  ownerId: string;
  speciesId: string;
  level: number;
  shiny: boolean;
  types: string[];
  gender?: string;
  nature?: string;
  ability?: string;
  heldItemId?: string | null;
  stats?: StatsBlock;
  ivs?: StatsBlock;
  evs?: StatsBlock;
  moves?: PokemonMove[];
}

export interface TeamSlot {
  slot: number;
  pokemonInstanceId: string;
  pokemon?: PokemonInstance;
}

export interface BoxEntry {
  id: string;
  pokemonInstanceId: string;
  createdAt?: Timestamp | null;
  pokemon?: PokemonInstance;
}

export interface FilterState {
  search: string;
  status: 'all' | PlayerStatus;
  accountType: 'all' | PlayerAccountType;
  onlyExpiring: boolean;
  onlyBoxFull: boolean;
}
