// src/components/users/UserBoxModal.tsx
'use client';

import { BoxEntry } from './types';
import PokemonSprite from './PokemonSprite';
import PokemonTooltip from './PokemonTooltip';

interface Props {
  open: boolean;
  onClose: () => void;
  box: BoxEntry[];
}

const UserBoxModal: React.FC<Props> = ({ open, onClose, box }) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border border-slate-700 bg-slate-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-100">
            Box Completa do Jogador
          </h2>
          <button
            onClick={onClose}
            className="rounded-full bg-slate-800 px-3 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700"
          >
            Fechar
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {box.length === 0 ? (
            <p className="text-xs text-slate-400">
              Nenhum Pokémon na box.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-3 md:grid-cols-4 lg:grid-cols-6">
              {box.map((entry) => (
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
                    <p className="text-[9px] text-slate-400">
                      {entry.pokemon?.types?.length
                        ? entry.pokemon.types.join(' / ')
                        : '?'}
                    </p>
                  </div>
                </PokemonTooltip>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default UserBoxModal;
