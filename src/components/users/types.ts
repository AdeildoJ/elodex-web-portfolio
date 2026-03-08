// src/components/users/types.ts
import type { Timestamp } from 'firebase/firestore';

export type PlayerAccountType = 'FREE' | 'VIP';
export type PlayerStatus = 'active' | 'inactive';

export type CharacterSummary = {
  id: string;
  name: string;
  region?: string | null;
  classType?: string | null;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
  kmWalked?: number;
  pokeCoins?: number;
  level?: number;
};

export interface PlayerSummary {
  id: string; // uid do player
  uid: string;
  nomeJogador: string;
  email: string;
  playerType: PlayerAccountType;
  status: PlayerStatus;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;

  selectedCharacterId?: string | null;
  characterCount: number;
  primaryCharacter?: CharacterSummary | null;
}

export interface StatsBlock {
  hp?: number;
  atk?: number;
  def?: number;
  spAtk?: number;
  spDef?: number;
  speed?: number;
  spa?: number;
  spd?: number;
  spe?: number;
}

export interface PokemonMove {
  name: string;
  moveId?: string;
  type?: string;
  category?: string;
  power?: number | null;
  accuracy?: number | null;
  pp?: number | null;
  learnedAtLevel?: number | null;
  method?: string;
}

export interface PokemonInstance {
  id: string;
  ownerId?: string;
  speciesId: string;
  speciesName?: string;
  nickname?: string;
  level: number;
  shiny: boolean;
  types: string[];
  gender?: string;
  nature?: string;
  ability?: string;
  abilityId?: string;
  heldItemId?: string | null;
  stats?: StatsBlock;
  ivs?: StatsBlock;
  evs?: StatsBlock;
  moves?: PokemonMove[] | string[];
  hpCurrent?: number;
  hpTotal?: number;
}

export interface TeamSlot {
  slot: number;
  pokemonDocId: string;
  pokemon?: PokemonInstance;
}

export interface BoxEntry {
  id: string;
  createdAt?: Timestamp | null;
  pokemon?: PokemonInstance;
}

export interface FilterState {
  search: string;
  accountType: 'all' | PlayerAccountType;
  status: 'all' | PlayerStatus;
  hasCharacters: 'all' | 'with' | 'without';
}
