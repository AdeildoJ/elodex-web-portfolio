// src/components/users/UserTeam.tsx
'use client';

import PokemonSprite from './PokemonSprite';
import PokemonTooltip from './PokemonTooltip';
import { TeamSlot } from './types';

interface Props {
  team: TeamSlot[];
  loading: boolean;
}

const UserTeam: React.FC<Props> = ({ team, loading }) => {
  return (
    <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs text-slate-300">
      <h3 className="text-sm font-semibold text-slate-200">
        Time Principal
      </h3>

      {loading ? (
        <p className="text-slate-400">Carregando time...</p>
      ) : team.length === 0 ? (
        <p className="text-slate-400">
          Este jogador ainda não possui Pokémon no time.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {team.map((slot) => (
            <PokemonTooltip key={slot.slot} pokemon={slot.pokemon}>
              <div className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2">
                <PokemonSprite
                  speciesId={slot.pokemon?.speciesId || '?'}
                  shiny={slot.pokemon?.shiny}
                />

                <div className="flex-1">
                  <p className="text-[11px] text-slate-400">
                    Slot {slot.slot}
                  </p>
                  {slot.pokemon ? (
                    <>
                      <p className="text-sm font-semibold text-slate-50">
                        #{slot.pokemon.speciesId} • Nível{' '}
                        {slot.pokemon.level}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        Tipos:{' '}
                        {slot.pokemon.types?.length
                          ? slot.pokemon.types.join(' / ')
                          : 'Desconhecido'}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-slate-400">
                      Pokémon não encontrado ({slot.pokemonInstanceId})
                    </p>
                  )}
                </div>

                {slot.pokemon?.shiny && (
                  <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
                    Shiny
                  </span>
                )}
              </div>
            </PokemonTooltip>
          ))}
        </div>
      )}
    </section>
  );
};

export default UserTeam;
