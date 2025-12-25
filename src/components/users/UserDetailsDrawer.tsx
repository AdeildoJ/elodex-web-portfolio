'use client';

import { useEffect, useState } from 'react';
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  Timestamp,
  where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  BoxEntry,
  PlayerSummary,
  PokemonInstance,
  TeamSlot,
} from './types';
import UserTeam from './UserTeam';
import UserBoxPreview from './UserBoxPreview';
import UserBoxModal from './UserBoxModal';

interface Props {
  player: PlayerSummary;
  onClose: () => void;
}

const MAX_BOX_DOCS = 60; // segurança: evita ler box gigantes em uma tacada só

const formatDate = (ts?: Timestamp | null) => {
  if (!ts || !ts.toDate) return '-';
  return ts.toDate().toLocaleDateString('pt-BR');
};

function splitInBatches<T>(arr: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    batches.push(arr.slice(i, i + size));
  }
  return batches;
}

/**
 * Busca instâncias em pokemonInstances usando where("__name__", "in", batch)
 * para reduzir leituras em relação a vários getDoc individuais.
 */
async function fetchPokemonInstancesByIds(
  ids: string[]
): Promise<Record<string, PokemonInstance>> {
  const result: Record<string, PokemonInstance> = {};
  const uniqueIds = Array.from(new Set(ids)).filter(Boolean);
  if (uniqueIds.length === 0) return result;

  const batches = splitInBatches(uniqueIds, 10);

  for (const batch of batches) {
    const q = query(
      collection(db, 'pokemonInstances'),
      where('__name__', 'in', batch)
    );
    const snap = await getDocs(q);
    snap.forEach((psnap) => {
      const d = psnap.data() as any;
      const inst: PokemonInstance = {
        id: psnap.id,
        ownerId: d.ownerId,
        speciesId:
          d.speciesId?.toString?.() ?? String(d.speciesId ?? '?'),
        level: d.level ?? 1,
        shiny: d.shiny ?? false,
        types: Array.isArray(d.types) ? d.types : [],
        gender: d.gender,
        nature: d.nature,
        ability: d.ability,
        heldItemId: d.heldItemId ?? null,
        stats: d.stats,
        ivs: d.ivs,
        evs: d.evs,
        moves: d.moves ?? [],
      };
      result[psnap.id] = inst;
    });
  }

  return result;
}

const UserDetailsDrawer: React.FC<Props> = ({ player, onClose }) => {
  const [team, setTeam] = useState<TeamSlot[]>([]);
  const [box, setBox] = useState<BoxEntry[]>([]);
  const [loadingTeam, setLoadingTeam] = useState(true);
  const [loadingBox, setLoadingBox] = useState(true);
  const [boxModalOpen, setBoxModalOpen] = useState(false);

  // Time (sem realtime, apenas leitura pontual ao abrir)
  useEffect(() => {
    let cancelled = false;
    setLoadingTeam(true);

    (async () => {
      try {
        const teamCol = collection(db, 'users', player.id, 'team');
        const qTeam = query(teamCol, orderBy('slot', 'asc'));
        const snap = await getDocs(qTeam);

        const baseSlots: TeamSlot[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            slot: data.slot ?? 0,
            pokemonInstanceId: data.pokemonInstanceId,
          };
        });

        const instanceIds = baseSlots
          .map((s) => s.pokemonInstanceId)
          .filter((id): id is string => Boolean(id));

        const instancesById = await fetchPokemonInstancesByIds(instanceIds);
        if (cancelled) return;

        const resolved: TeamSlot[] = baseSlots.map((s) => ({
          ...s,
          pokemon: s.pokemonInstanceId
            ? instancesById[s.pokemonInstanceId]
            : undefined,
        }));

        setTeam(resolved);
      } catch (err) {
        console.error('[UserDetailsDrawer] Erro ao carregar time:', err);
        if (!cancelled) setTeam([]);
      } finally {
        if (!cancelled) setLoadingTeam(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [player.id]);

  // Box (também sem realtime, limitando quantidade)
  useEffect(() => {
    let cancelled = false;
    setLoadingBox(true);

    (async () => {
      try {
        const boxCol = collection(db, 'users', player.id, 'box');
        const qBox = query(
          boxCol,
          orderBy('createdAt', 'asc'),
          limit(MAX_BOX_DOCS)
        );
        const snap = await getDocs(qBox);

        const baseEntries: BoxEntry[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            pokemonInstanceId: data.pokemonInstanceId,
            createdAt: data.createdAt ?? null,
          };
        });

        const instanceIds = baseEntries
          .map((b) => b.pokemonInstanceId)
          .filter((id): id is string => Boolean(id));

        const instancesById = await fetchPokemonInstancesByIds(instanceIds);
        if (cancelled) return;

        const resolved: BoxEntry[] = baseEntries.map((b) => ({
          ...b,
          pokemon: b.pokemonInstanceId
            ? instancesById[b.pokemonInstanceId]
            : undefined,
        }));

        setBox(resolved);
      } catch (err) {
        console.error('[UserDetailsDrawer] Erro ao carregar box:', err);
        if (!cancelled) setBox([]);
      } finally {
        if (!cancelled) setLoadingBox(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [player.id]);

  return (
    <>
      <div className="fixed inset-0 z-40 flex justify-end bg-black/40 backdrop-blur-sm">
        <div className="flex h-full w-full max-w-3xl flex-col border-l border-slate-800 bg-slate-950/95">
          {/* Cabeçalho */}
          <div className="flex items-start justify-between border-b border-slate-800 px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold">
                Ficha do Jogador — {player.displayName}
              </h2>
              <p className="text-xs text-slate-400">
                ID: {player.id} • {player.email}
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-medium ${
                    player.accountType === 'vip'
                      ? 'bg-amber-500/10 text-amber-300 ring-1 ring-amber-500/40'
                      : 'bg-slate-800 text-slate-200 ring-1 ring-slate-600/60'
                  }`}
                >
                  Tipo: {player.accountType === 'vip' ? 'VIP' : 'Comum'}
                </span>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-medium ${
                    player.status === 'active'
                      ? 'bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/40'
                      : 'bg-rose-500/10 text-rose-300 ring-1 ring-rose-500/40'
                  }`}
                >
                  Status:{' '}
                  {player.status === 'active' ? 'Ativo' : 'Inativo'}
                </span>
                <span className="inline-flex items-center rounded-full bg-slate-800 px-2.5 py-0.5 font-medium text-slate-200 ring-1 ring-slate-600/60">
                  Cadastro: {formatDate(player.createdAt)}
                </span>
              </div>
            </div>

            <button
              onClick={onClose}
              className="rounded-full bg-slate-800 px-3 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700"
            >
              Fechar
            </button>
          </div>

          {/* Conteúdo */}
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {/* Resumo + Progresso */}
            <section className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <h3 className="mb-2 text-sm font-semibold text-slate-200">
                  Resumo Geral
                </h3>
                <div className="space-y-1 text-xs text-slate-300">
                  <p>
                    <span className="text-slate-400">Região:</span>{' '}
                    {player.region ?? '-'}
                  </p>
                  <p>
                    <span className="text-slate-400">Classe:</span>{' '}
                    {player.characterClass ?? '-'}
                  </p>
                  <p>
                    <span className="text-slate-400">
                      Pokémon inicial:
                    </span>{' '}
                    {player.starterSpeciesId ?? '-'}
                  </p>
                  <p>
                    <span className="text-slate-400">
                      Último login:
                    </span>{' '}
                    {formatDate(player.lastLoginAt)}
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <h3 className="mb-2 text-sm font-semibold text-slate-200">
                  Progresso Geral
                </h3>
                <div className="grid grid-cols-2 gap-2 text-xs text-slate-300">
                  <p>
                    <span className="text-slate-400">Nível:</span>{' '}
                    {player.level ?? 1}
                  </p>
                  <p>
                    <span className="text-slate-400">XP:</span>{' '}
                    {player.xp ?? 0}
                  </p>
                  <p>
                    <span className="text-slate-400">
                      KM percorridos:
                    </span>{' '}
                    {player.kmWalked ?? 0}
                  </p>
                  <p>
                    <span className="text-slate-400">Pokédex:</span>{' '}
                    {player.pokedexSeen ?? 0} vistos /{' '}
                    {player.pokedexCaught ?? 0} capturados
                  </p>
                  <p>
                    <span className="text-slate-400">Missões:</span>{' '}
                    {player.missionsCompleted ?? 0}
                  </p>
                  <p>
                    <span className="text-slate-400">Insígnias:</span>{' '}
                    {player.badges ?? 0}
                  </p>
                </div>
              </div>
            </section>

            {/* Box & VIP + Economia */}
            <section className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <h3 className="mb-2 text-sm font-semibold text-slate-200">
                  Box & VIP
                </h3>
                <div className="space-y-1 text-xs text-slate-300">
                  <p>
                    <span className="text-slate-400">Box:</span>{' '}
                    {player.boxCurrent ?? 0} /{' '}
                    {player.boxTotalLimit ?? 0}
                  </p>
                  {player.hasExpiringPokemon && (
                    <p className="text-amber-300">
                      Existem Pokémon ocupando espaços VIP em
                      contagem de expiração.
                    </p>
                  )}
                  {player.boxIsFull && (
                    <p className="text-rose-300">
                      Box cheia — não pode capturar novos Pokémon
                      até liberar espaço.
                    </p>
                  )}
                  {box.length >= MAX_BOX_DOCS && (
                    <p className="text-[11px] text-slate-500">
                      Mostrando os primeiros {MAX_BOX_DOCS} Pokémon
                      da box para economizar leituras.
                    </p>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <h3 className="mb-2 text-sm font-semibold text-slate-200">
                  Economia
                </h3>
                <div className="space-y-1 text-xs text-slate-300">
                  <p>
                    <span className="text-slate-400">
                      Saldo ECoin:
                    </span>{' '}
                    {player.ecoinBalance ?? 0}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    O histórico detalhado virá da subcoleção{' '}
                    <code>users/{player.id}/economy</code>.
                  </p>
                </div>
              </div>
            </section>

            {/* Time */}
            <UserTeam team={team} loading={loadingTeam} />

            {/* Box preview + modal */}
            <UserBoxPreview
              box={box}
              loading={loadingBox}
              onOpenFullBox={() => setBoxModalOpen(true)}
            />

            {/* Placeholders futuros */}
            <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs text-slate-300">
              <h3 className="text-sm font-semibold text-slate-200">
                Inventário de Itens
              </h3>
              <p className="text-slate-400">
                Em breve: itens de{' '}
                <code>users/{player.id}/inventory</code>.
              </p>
            </section>

            <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs text-slate-300">
              <h3 className="text-sm font-semibold text-slate-200">
                Economia & Compras
              </h3>
              <p className="text-slate-400">
                Em breve: histórico detalhado de{' '}
                <code>economy</code>.
              </p>
            </section>

            <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs text-slate-300">
              <h3 className="text-sm font-semibold text-slate-200">
                Logs Individuais
              </h3>
              <p className="text-slate-400">
                Em breve: integração com auditoria e logs de
                captura, evolução, etc.
              </p>
            </section>
          </div>
        </div>
      </div>

      <UserBoxModal
        open={boxModalOpen}
        onClose={() => setBoxModalOpen(false)}
        box={box}
      />
    </>
  );
};

export default UserDetailsDrawer;
