import type { PokemonInstance } from './types';

const normalizeForCompare = (v: unknown) =>
  String(v ?? '')
    .trim()
    .toLowerCase();

export function getPokemonDisplayName(pokemon?: PokemonInstance): string {
  if (!pokemon) return '-';
  const speciesName = String(pokemon.speciesName || `#${pokemon.speciesId}`).trim();
  const nickname = String(pokemon.nickname || '').trim();
  if (!nickname) return speciesName;
  if (normalizeForCompare(nickname) === normalizeForCompare(speciesName)) return speciesName;
  return `${nickname} (${speciesName})`;
}

