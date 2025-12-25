// src/components/users/UserBoxPreview.tsx
'use client';

import PokemonSprite from './PokemonSprite';
import PokemonTooltip from './PokemonTooltip';
import { BoxEntry } from './types';

interface Props {
  box: BoxEntry[];
  loading: boolean;
  onOpenFullBox: () => void;
}

const PREVIEW_COUNT = 6;

const UserBoxPreview: React.FC<Props> = ({
  box,
  loading,
  onOpenFullBox,
}) => {
  const preview = box.slice(0, PREVIEW_COUNT);
  const hasMore = box.length > PREVIEW_COUNT;

  return (
    <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs text-slate-300">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-200">
          Box (Armazenamento)
        </h3>
        {box.length > 0 && (
          <button
            onClick={onOpenFullBox}
            className="text-[11px] font-medium text-emerald-300 hover:text-emerald-200"
          >
            Ver box completa
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-slate-400">Carregando box...</p>
      ) : box.length === 0 ? (
        <p className="text-slate-400">
          Este jogador ainda não possui Pokémon na box.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 md:grid-cols-4">
            {preview.map((entry) => (
              <PokemonTooltip key={entry.id} pokemon={entry.pokemon}>
                <div className="flex flex-col items-center rounded-lg border border-slate-700 bg-slate-900/70 px-2 py-2">
                  <PokemonSprite
                    speciesId={entry.pokemon?.speciesId || '?'}
                    shiny={entry.pokemon?.shiny}
                    className="mb-1"
                  />
                  <p className="text-[10px] text-slate-100">
                    #{entry.pokemon?.speciesId ?? '?'}
                  </p>
                  <p className="text-[9px] text-slate-400">
                    Nv. {entry.pokemon?.level ?? '?'}
                  </p>
                </div>
              </PokemonTooltip>
            ))}
          </div>
          {hasMore && (
            <p className="mt-1 text-[10px] text-slate-500">
              +{box.length - PREVIEW_COUNT} Pokémon na box.
            </p>
          )}
        </>
      )}
    </section>
  );
};

export default UserBoxPreview;
