// src/components/users/PokemonTooltip.tsx
'use client';

import { useEffect, useState } from 'react';
import { PokemonInstance, StatsBlock } from './types';
import { fetchSpeciesData } from './PokemonSprite';

// JSONs estáticos de golpes e learnsets
import movesJson from '@/data/moves.json';
import pokemonMovesJson from '@/data/pokemonMoves.json';

interface PokemonTooltipProps {
  pokemon?: PokemonInstance;
  children: React.ReactNode;
}

/**
 * Estrutura de um movimento no learnset (pokemonMoves.json[{speciesId}])
 */
type PokemonMoveLearn = {
  moveId: string;
  method: string; // "level-up" | "egg" | "machine" | "tutor" ...
  level?: number | null; // nível quando for level-up
};

type PokemonMovesDoc = {
  moves?: PokemonMoveLearn[];
};

/**
 * Estrutura mínima de um movimento salvo na instância
 */
type NormalizedInstanceMove = {
  moveId: string;
  method?: string;
  level?: number | null;
};

/**
 * Dados base de um golpe (moves.json)
 */
type MoveData = {
  id?: number;
  name: string;
  type?: string | null;
  damageClass?: string | null;
  power?: number | null;
  accuracy?: number | null;
  pp?: number | null;
  statusAilment?: string | null;
  statusChance?: number | null;
};

/**
 * Dados já prontos para exibição
 */
type DisplayMove = MoveData & {
  method?: string;
  level?: number | null;
};

type StatKey = 'atk' | 'def' | 'spAtk' | 'spDef' | 'speed';

const natureMap: Record<string, { up?: StatKey; down?: StatKey }> = {
  // +Atk
  Lonely: { up: 'atk', down: 'def' },
  Brave: { up: 'atk', down: 'speed' },
  Adamant: { up: 'atk', down: 'spAtk' },
  Naughty: { up: 'atk', down: 'spDef' },
  // +Def
  Bold: { up: 'def', down: 'atk' },
  Relaxed: { up: 'def', down: 'speed' },
  Impish: { up: 'def', down: 'spAtk' },
  Lax: { up: 'def', down: 'spDef' },
  // +SpA
  Modest: { up: 'spAtk', down: 'atk' },
  Mild: { up: 'spAtk', down: 'def' },
  Quiet: { up: 'spAtk', down: 'speed' },
  Rash: { up: 'spAtk', down: 'spDef' },
  // +SpD
  Calm: { up: 'spDef', down: 'atk' },
  Gentle: { up: 'spDef', down: 'def' },
  Sassy: { up: 'spDef', down: 'speed' },
  Careful: { up: 'spDef', down: 'spAtk' },
  // +Speed
  Timid: { up: 'speed', down: 'atk' },
  Hasty: { up: 'speed', down: 'def' },
  Jolly: { up: 'speed', down: 'spAtk' },
  Naive: { up: 'speed', down: 'spDef' },
  // Neutras
  Hardy: {},
  Docile: {},
  Serious: {},
  Bashful: {},
  Quirky: {},
};

function getNatureModifier(nature: string | undefined, stat: StatKey) {
  if (!nature) return 1.0;
  const entry = natureMap[nature as keyof typeof natureMap];
  if (!entry) return 1.0;
  if (entry.up === stat) return 1.1;
  if (entry.down === stat) return 0.9;
  return 1.0;
}

/**
 * Fórmula oficial de stats
 */
function calcStat(
  base: number,
  iv: number,
  ev: number,
  level: number,
  natureMod: number,
  isHP: boolean
): number {
  const ivSafe = Number.isFinite(iv) ? iv : 31;
  const evSafe = Number.isFinite(ev) ? ev : 0;
  const lvl = level > 0 ? level : 1;

  if (isHP) {
    const value =
      ((2 * base + ivSafe + Math.floor(evSafe / 4)) * lvl) / 100 +
      lvl +
      10;
    return Math.floor(value);
  } else {
    const value =
      ((2 * base + ivSafe + Math.floor(evSafe / 4)) * lvl) / 100 + 5;
    return Math.floor(value * natureMod);
  }
}

function formatMoveName(name: string) {
  return name
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Normaliza pokemon.moves (string[] ou objeto[]) para um formato único
 */
function normalizeInstanceMoves(
  pokemon: PokemonInstance
): NormalizedInstanceMove[] {
  const raw = Array.isArray(pokemon.moves)
    ? (pokemon.moves as any[])
    : [];

  const norm = raw
    .map((m) => {
      if (!m) return null;

      if (typeof m === 'string') {
        return { moveId: m, method: undefined, level: null };
      }

      const obj: any = m;
      const moveId: string | undefined =
        obj.moveId ?? obj.id ?? obj.name;

      if (!moveId) return null;

      return {
        moveId,
        method: obj.method,
        level:
          typeof obj.level === 'number' ? obj.level : null,
      };
    })
    .filter((m) => m !== null) as NormalizedInstanceMove[];

  return norm;
}

/**
 * Busca o learnset no JSON estático pokemonMoves.json
 */
async function fetchLearnset(
  speciesId: string | number
): Promise<PokemonMoveLearn[]> {
  const key = String(speciesId);
  const entry =
    (pokemonMovesJson as Record<string, PokemonMovesDoc | undefined>)[key];

  if (!entry || !Array.isArray(entry.moves)) return [];
  return entry.moves;
}

/**
 * Busca dados de cada golpe em memória usando moves.json
 */
async function fetchMovesDetails(
  moveIds: string[]
): Promise<Record<string, MoveData>> {
  const result: Record<string, MoveData> = {};
  const uniqueIds = Array.from(new Set(moveIds)).filter(Boolean);
  if (uniqueIds.length === 0) return result;

  uniqueIds.forEach((id) => {
    const base = (movesJson as Record<string, any>)[id];

    if (base) {
      result[id] = {
        name: base.name ?? id,
        type: base.type ?? null,
        damageClass: base.damageClass ?? null,
        power: base.power ?? null,
        accuracy: base.accuracy ?? null,
        pp: base.pp ?? null,
        statusAilment: null,
        statusChance: null,
      };
    } else {
      result[id] = { name: id };
    }
  });

  return result;
}

/**
 * Lógica de escolha de golpes para exibição:
 * - Se a instância tiver moves → usa eles (máx. 4).
 * - Senão:
 *    • tenta pegar até 4 últimos level-up <= nível atual
 *    • se não tiver level-up, pega até 2 egg moves (para caso de ovo)
 */
function chooseMovesFromLearnset(
  pokemon: PokemonInstance,
  learnset: PokemonMoveLearn[]
): PokemonMoveLearn[] {
  const level = pokemon.level ?? 1;

  const levelUp = learnset
    .filter(
      (m) =>
        m.method === 'level-up' &&
        (m.level ?? 0) <= level
    )
    .sort((a, b) => (a.level ?? 0) - (b.level ?? 0));

  if (levelUp.length > 0) {
    const start = Math.max(levelUp.length - 4, 0);
    return levelUp.slice(start); // últimos até 4
  }

  // fallback: egg moves (caso ovo / espécie sem level-up)
  const eggMoves = learnset.filter((m) => m.method === 'egg');

  if (eggMoves.length === 0) {
    return [];
  }

  // regra de visualização: mostra até 2 egg moves (ou o que tiver)
  return eggMoves.slice(0, Math.min(2, eggMoves.length));
}

/**
 * Monta lista final de movimentos a exibir
 */
function buildDisplayMoves(
  pokemon: PokemonInstance,
  learnset: PokemonMoveLearn[],
  detailsById: Record<string, MoveData>
): DisplayMove[] {
  const instanceMoves = normalizeInstanceMoves(pokemon);

  // 1) Se a instância tem golpes escolhidos → são a verdade oficial
  if (instanceMoves.length > 0) {
    const chosen =
      instanceMoves.length > 4
        ? instanceMoves.slice(0, 4)
        : instanceMoves;

    return chosen.map((inst) => {
      const base = detailsById[inst.moveId] ?? { name: inst.moveId };
      const fromLearnset = learnset.find(
        (m) => m.moveId === inst.moveId
      );

      return {
        ...base,
        method: inst.method ?? fromLearnset?.method,
        level: inst.level ?? fromLearnset?.level ?? null,
      };
    });
  }

  // 2) Nenhum golpe salvo na instância → calcula a partir do learnset
  const fromLearnset = chooseMovesFromLearnset(pokemon, learnset);

  return fromLearnset.map((entry) => {
    const base = detailsById[entry.moveId] ?? { name: entry.moveId };
    return {
      ...base,
      method: entry.method,
      level: entry.level ?? null,
    };
  });
}

const PokemonTooltip: React.FC<PokemonTooltipProps> = ({
  pokemon,
  children,
}) => {
  const [hovered, setHovered] = useState(false);
  const [speciesName, setSpeciesName] = useState<string>('');
  const [finalStats, setFinalStats] = useState<StatsBlock>({});
  const [ivs, setIvs] = useState<StatsBlock>({});
  const [evs, setEvs] = useState<StatsBlock>({});
  const [movesToShow, setMovesToShow] = useState<DisplayMove[]>([]);

  useEffect(() => {
    // ⚠️ ECONOMIA: só busca dados quando o mouse estiver em cima
    if (!pokemon || !hovered) return;

    let cancelled = false;

    (async () => {
      try {
        // 1) Espécie + base stats
        const species = await fetchSpeciesData(pokemon.speciesId);
        if (cancelled) return;

        const base = species.baseStats || {};
        const name = species.name || `#${pokemon.speciesId}`;
        setSpeciesName(name);

        // 2) IVs / EVs
        const ivBlock: StatsBlock = {
          hp: pokemon.ivs?.hp ?? 31,
          atk: pokemon.ivs?.atk ?? 31,
          def: pokemon.ivs?.def ?? 31,
          spAtk: pokemon.ivs?.spAtk ?? 31,
          spDef: pokemon.ivs?.spDef ?? 31,
          speed: pokemon.ivs?.speed ?? 31,
        };
        const evBlock: StatsBlock = {
          hp: pokemon.evs?.hp ?? 0,
          atk: pokemon.evs?.atk ?? 0,
          def: pokemon.evs?.def ?? 0,
          spAtk: pokemon.evs?.spAtk ?? 0,
          spDef: pokemon.evs?.spDef ?? 0,
          speed: pokemon.evs?.speed ?? 0,
        };
        setIvs(ivBlock);
        setEvs(evBlock);

        const lvl = pokemon.level ?? 1;
        const nat = pokemon.nature;

        const baseHp = base.hp ?? 0;
        const baseAtk = base.attack ?? 0;
        const baseDef = base.defense ?? 0;
        const baseSpA = base.specialAttack ?? 0;
        const baseSpD = base.specialDefense ?? 0;
        const baseSpe = base.speed ?? 0;

        const computed: StatsBlock = {
          hp: calcStat(
            baseHp,
            ivBlock.hp ?? 31,
            evBlock.hp ?? 0,
            lvl,
            1.0,
            true
          ),
          atk: calcStat(
            baseAtk,
            ivBlock.atk ?? 31,
            evBlock.atk ?? 0,
            lvl,
            getNatureModifier(nat, 'atk'),
            false
          ),
          def: calcStat(
            baseDef,
            ivBlock.def ?? 31,
            evBlock.def ?? 0,
            lvl,
            getNatureModifier(nat, 'def'),
            false
          ),
          spAtk: calcStat(
            baseSpA,
            ivBlock.spAtk ?? 31,
            evBlock.spAtk ?? 0,
            lvl,
            getNatureModifier(nat, 'spAtk'),
            false
          ),
          spDef: calcStat(
            baseSpD,
            ivBlock.spDef ?? 31,
            evBlock.spDef ?? 0,
            lvl,
            getNatureModifier(nat, 'spDef'),
            false
          ),
          speed: calcStat(
            baseSpe,
            ivBlock.speed ?? 31,
            evBlock.speed ?? 0,
            lvl,
            getNatureModifier(nat, 'speed'),
            false
          ),
        };

        if (cancelled) return;
        setFinalStats(computed);

        // 3) Movimentos: instância + learnset como fallback
        const learnset = await fetchLearnset(pokemon.speciesId);
        if (cancelled) return;

        const instanceMoves = normalizeInstanceMoves(pokemon);
        let moveIds: string[] = [];

        if (instanceMoves.length > 0) {
          moveIds = instanceMoves.slice(0, 4).map((m) => m.moveId);
        } else {
          const fromLearnset = chooseMovesFromLearnset(pokemon, learnset);
          moveIds = fromLearnset.map((m) => m.moveId);
        }

        const detailsById = await fetchMovesDetails(moveIds);
        if (cancelled) return;

        const list = buildDisplayMoves(pokemon, learnset, detailsById);
        setMovesToShow(list);
      } catch (err) {
        console.error('Erro ao montar tooltip de Pokémon:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pokemon, hovered]);

  if (!pokemon) {
    return (
      <div className="relative inline-flex group">
        {children}
        <div className="pointer-events-none absolute left-1/2 top-0 z-40 hidden -translate-x-1/2 -translate-y-full transform rounded-md bg-slate-900 px-3 py-2 text-[10px] text-slate-300 shadow-lg group-hover:block">
          Pokémon não encontrado.
        </div>
      </div>
    );
  }

  const expValue =
    (pokemon as any).exp ??
    (pokemon as any).experience ??
    0;

  const heldItem =
    (pokemon as any).heldItem ??
    (pokemon as any).heldItemId ??
    'Nenhum';

  const felicidade =
    (pokemon as any).happiness ??
    (pokemon as any).felicidade ??
    '-';
  const beleza =
    (pokemon as any).beauty ??
    (pokemon as any).beleza ??
    '-';
  const maldade =
    (pokemon as any).evil ??
    (pokemon as any).malice ??
    (pokemon as any).maldade ??
    '-';

  return (
    <div
      className="relative inline-flex group"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}

      <div className="pointer-events-none absolute left-1/2 top-0 z-40 hidden w-80 -translate-x-1/2 -translate-y-full transform rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-[10px] text-slate-200 shadow-2xl group-hover:block">
        {/* HEADER */}
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="space-y-0.5">
            <div className="font-semibold text-[11px]">
              {speciesName || `#${pokemon.speciesId}`}{' '}
              [Nv. {pokemon.level ?? 1} - EXP {expValue}]
            </div>
            <div className="text-[9px] text-slate-300">
              Tipo:{' '}
              {pokemon.types && pokemon.types.length
                ? pokemon.types.join(' / ')
                : '?'}{' '}
              | Natureza: {pokemon.nature || '-'}
            </div>
            <div className="text-[9px] text-slate-300">
              Habilidade: {pokemon.ability || '-'} | Item: {heldItem}
            </div>
            <div className="text-[9px] text-slate-300">
              Felicidade: {felicidade} | Beleza: {beleza} | Maldade:{' '}
              {maldade}
            </div>
          </div>

          {pokemon.shiny && (
            <span className="mt-0.5 rounded-full bg-amber-500/20 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-200">
              Shiny
            </span>
          )}
        </div>

        {/* STATUS | IV | EV */}
        <div className="mb-2">
          <div className="font-semibold text-[9px] text-slate-300">
            Status | IV | EV
          </div>
          <table className="mt-0.5 w-full text-[9px]">
            <thead className="text-slate-400">
              <tr>
                <th className="text-left font-normal"></th>
                <th className="text-right font-normal">Status</th>
                <th className="text-right font-normal">IV</th>
                <th className="text-right font-normal">EV</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['HP', 'hp'],
                ['Atk', 'atk'],
                ['Def', 'def'],
                ['SpA', 'spAtk'],
                ['SpD', 'spDef'],
                ['Spe', 'speed'],
              ].map(([label, key]) => (
                <tr key={key}>
                  <td className="text-left text-slate-300">{label}:</td>
                  <td className="text-right">
                    {finalStats[key as keyof StatsBlock] ?? '-'}
                  </td>
                  <td className="text-right">
                    {ivs[key as keyof StatsBlock] ?? '-'}
                  </td>
                  <td className="text-right">
                    {evs[key as keyof StatsBlock] ?? '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* MOVIMENTOS */}
        <div className="mt-1">
          <div className="font-semibold text-[9px] text-slate-300">
            Movimentos
          </div>
          {movesToShow.length ? (
            <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto pr-1 text-[9px]">
              {movesToShow.map((m, idx) => (
                <li key={idx}>
                  <span className="font-semibold">
                    {formatMoveName(m.name)}
                  </span>
                  {m.type && (
                    <span className="text-slate-400">
                      {' '}
                      • {m.type.toUpperCase()}
                    </span>
                  )}
                  {m.damageClass && (
                    <span className="text-slate-400">
                      {' '}
                      • {m.damageClass.toUpperCase()}
                    </span>
                  )}
                  {typeof m.power === 'number' && (
                    <span className="text-slate-400">
                      {' '}
                      • Poder {m.power}
                    </span>
                  )}
                  {typeof m.accuracy === 'number' && (
                    <span className="text-slate-400">
                      {' '}
                      • {m.accuracy}% precisão
                    </span>
                  )}
                  {m.statusAilment && (
                    <span className="text-amber-300">
                      {' '}
                      • {m.statusAilment}
                      {m.statusChance != null
                        ? ` (${m.statusChance}%)`
                        : ''}
                    </span>
                  )}
                  {m.method && (
                    <span className="text-slate-500">
                      {' '}
                      ({m.method}
                      {m.level != null && m.level > 0
                        ? ` Nv.${m.level}`
                        : ''}
                      )
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[9px] text-slate-500">
              Nenhum movimento carregado ainda.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default PokemonTooltip;
