// src/components/users/PokemonSprite.tsx
'use client';

import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface PokemonSpriteProps {
  speciesId: string;
  shiny?: boolean;
  className?: string;
  alt?: string;
}

/**
 * Agora o cache guarda também baseStats e name.
 */
type SpeciesCacheValue = {
  spriteUrl?: string;
  shinySpriteUrl?: string;
  name?: string;
  baseStats?: {
    attack?: number;
    defense?: number;
    hp?: number;
    specialAttack?: number;
    specialDefense?: number;
    speed?: number;
  };
};

const speciesCache: Record<string, SpeciesCacheValue> = {};

/**
 * Buscar dados da espécie em pokemonSpecies:
 * - spriteUrl
 * - shinySpriteUrl (se existir)
 * - name
 * - baseStats (hp/atk/def/spAtk/spDef/speed)
 */
export async function fetchSpeciesData(
  speciesId: string
): Promise<SpeciesCacheValue> {
  if (speciesCache[speciesId]) return speciesCache[speciesId];

  const ref = doc(db, 'pokemonSpecies', speciesId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    speciesCache[speciesId] = {};
    return speciesCache[speciesId];
  }

  const data = snap.data() as any;
  const value: SpeciesCacheValue = {
    spriteUrl: data.spriteUrl as string | undefined,
    shinySpriteUrl: data.shinySpriteUrl as string | undefined,
    name: data.name as string | undefined,
    baseStats: data.baseStats ?? undefined,
  };

  speciesCache[speciesId] = value;
  return value;
}

const PokemonSprite: React.FC<PokemonSpriteProps> = ({
  speciesId,
  shiny,
  className,
  alt,
}) => {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    (async () => {
      try {
        const data = await fetchSpeciesData(speciesId);
        if (!isMounted) return;

        const chosen =
          shiny && data.shinySpriteUrl
            ? data.shinySpriteUrl
            : data.spriteUrl || null;

        setUrl(chosen);
      } catch {
        setUrl(null);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [speciesId, shiny]);

  if (!url) {
    return (
      <div
        className={
          'flex h-12 w-12 items-center justify-center rounded bg-slate-800 text-[10px] text-slate-400 ' +
          (className ?? '')
        }
      >
        #{speciesId}
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={alt || `Pokémon ${speciesId}`}
      className={'h-12 w-12 object-contain ' + (className ?? '')}
      draggable={false}
    />
  );
};

export default PokemonSprite;
