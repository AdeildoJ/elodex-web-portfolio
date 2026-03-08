'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  BoxEntry,
  CharacterSummary,
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

const MAX_BOX_DOCS = 120;

const formatDateTime = (ts?: Timestamp | null) => {
  if (!ts || !ts.toDate) return '-';
  return ts.toDate().toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
};

function parsePokemonFromDoc(id: string, data: any): PokemonInstance {
  const hpCurrent = Number(data?.hp?.current ?? 0);
  const hpTotal = Number(data?.hp?.total ?? 0);
  return {
    id,
    ownerId: String(data?.ownerId || ''),
    speciesId: String(data?.speciesId ?? '?'),
    speciesName: String(data?.speciesName || ''),
    nickname: String(data?.nickname || ''),
    level: Number(data?.level ?? 1),
    shiny: Boolean(data?.shiny),
    types: Array.isArray(data?.types) ? data.types : [],
    gender: data?.gender,
    nature: data?.nature,
    ability: data?.ability,
    abilityId: data?.abilityId,
    heldItemId: data?.heldItemId ?? null,
    stats: data?.stats,
    ivs: data?.ivs,
    evs: data?.evs,
    moves: Array.isArray(data?.moves) ? data.moves : [],
    hpCurrent: Number.isFinite(hpCurrent) ? hpCurrent : undefined,
    hpTotal: Number.isFinite(hpTotal) ? hpTotal : undefined,
  };
}

const UserDetailsDrawer: React.FC<Props> = ({ player, onClose }) => {
  const [characters, setCharacters] = useState<CharacterSummary[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(
    player.selectedCharacterId || player.primaryCharacter?.id || null
  );

  const [team, setTeam] = useState<TeamSlot[]>([]);
  const [box, setBox] = useState<BoxEntry[]>([]);

  const [loadingChars, setLoadingChars] = useState(true);
  const [loadingTeam, setLoadingTeam] = useState(true);
  const [loadingBox, setLoadingBox] = useState(true);
  const [boxModalOpen, setBoxModalOpen] = useState(false);

  const [itemsCount, setItemsCount] = useState(0);
  const [ballsCount, setBallsCount] = useState(0);
  const [eggsCount, setEggsCount] = useState(0);
  const [battleCount, setBattleCount] = useState(0);

  const selectedCharacter = useMemo(
    () => characters.find((c) => c.id === selectedCharacterId) || null,
    [characters, selectedCharacterId]
  );

  useEffect(() => {
    let cancelled = false;
    setLoadingChars(true);

    (async () => {
      try {
        const charsCol = collection(db, 'players', player.id, 'characters');
        const snap = await getDocs(query(charsCol, orderBy('createdAt', 'asc')));
        if (cancelled) return;

        const rows: CharacterSummary[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            name: String(data?.name || d.id),
            region: data?.region ?? null,
            classType: data?.classType ?? null,
            createdAt: data?.createdAt ?? null,
            updatedAt: data?.updatedAt ?? null,
            kmWalked: Number(data?.kmWalked ?? data?.totalKm ?? data?.distanceKm ?? 0) || 0,
            pokeCoins: Number(data?.pokeCoins ?? 0) || 0,
            level: Number(data?.level ?? 1) || 1,
          };
        });

        setCharacters(rows);

        if (!selectedCharacterId) {
          setSelectedCharacterId(rows[0]?.id || null);
        } else if (!rows.some((r) => r.id === selectedCharacterId)) {
          setSelectedCharacterId(rows[0]?.id || null);
        }
      } catch (err) {
        console.error('[UserDetailsDrawer] Erro ao carregar personagens:', err);
        if (!cancelled) {
          setCharacters([]);
          setSelectedCharacterId(null);
        }
      } finally {
        if (!cancelled) setLoadingChars(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [player.id]);

  useEffect(() => {
    let cancelled = false;

    if (!selectedCharacterId) {
      setTeam([]);
      setBox([]);
      setItemsCount(0);
      setBallsCount(0);
      setEggsCount(0);
      setBattleCount(0);
      setLoadingTeam(false);
      setLoadingBox(false);
      return;
    }

    setLoadingTeam(true);
    setLoadingBox(true);

    (async () => {
      try {
        const basePath = ['players', player.id, 'characters', selectedCharacterId] as const;

        const [
          timeSnap,
          boxSnap,
          itensSnap,
          ballsSnap,
          eggsSnap,
          battleSnap,
        ] = await Promise.all([
          getDocs(query(collection(db, ...basePath, 'time'), orderBy('slotIndex', 'asc'))),
          getDocs(query(collection(db, ...basePath, 'box'), orderBy('createdAt', 'asc'), limit(MAX_BOX_DOCS))),
          getDocs(collection(db, ...basePath, 'itens')),
          getDocs(collection(db, ...basePath, 'pokeballs')),
          getDocs(collection(db, ...basePath, 'eggs')),
          getDocs(query(collection(db, ...basePath, 'battleHistory'), orderBy('createdAt', 'desc'), limit(100))),
        ]);

        if (cancelled) return;

        const teamRows: TeamSlot[] = timeSnap.docs
          .filter((d) => d.id !== '_meta')
          .map((d) => {
            const data = d.data() as any;
            const slotIndex = Number(data?.slotIndex ?? String(d.id).replace(/\D+/g, '')) || 0;
            return {
              slot: slotIndex,
              pokemonDocId: d.id,
              pokemon: parsePokemonFromDoc(d.id, data),
            };
          })
          .sort((a, b) => a.slot - b.slot);

        const boxRows: BoxEntry[] = boxSnap.docs
          .filter((d) => d.id !== '_meta')
          .map((d) => {
            const data = d.data() as any;
            return {
              id: d.id,
              createdAt: data?.createdAt ?? null,
              pokemon: parsePokemonFromDoc(d.id, data),
            };
          });

        const nextItemsCount = itensSnap.docs
          .filter((d) => d.id !== '_meta')
          .reduce((acc, d) => acc + Number((d.data() as any)?.quantity ?? 0), 0);

        const nextBallsCount = ballsSnap.docs
          .filter((d) => d.id !== '_meta')
          .reduce((acc, d) => acc + Number((d.data() as any)?.quantity ?? 0), 0);

        const nextEggsCount = eggsSnap.docs.filter((d) => d.id !== '_meta').length;
        const nextBattleCount = battleSnap.docs.length;

        setTeam(teamRows);
        setBox(boxRows);
        setItemsCount(nextItemsCount);
        setBallsCount(nextBallsCount);
        setEggsCount(nextEggsCount);
        setBattleCount(nextBattleCount);
      } catch (err) {
        console.error('[UserDetailsDrawer] Erro ao carregar detalhes do personagem:', err);
        if (!cancelled) {
          setTeam([]);
          setBox([]);
          setItemsCount(0);
          setBallsCount(0);
          setEggsCount(0);
          setBattleCount(0);
        }
      } finally {
        if (!cancelled) {
          setLoadingTeam(false);
          setLoadingBox(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [player.id, selectedCharacterId]);

  return (
    <>
      <div className="fixed inset-0 z-40 flex justify-end bg-black/40 backdrop-blur-sm">
        <div className="flex h-full w-full max-w-4xl flex-col border-l border-slate-800 bg-slate-950/95">
          <div className="flex items-start justify-between border-b border-slate-800 px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold">Gerenciamento do Jogador — {player.nomeJogador}</h2>
              <p className="text-xs text-slate-400">UID: {player.uid} • {player.email || '-'}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <span className="inline-flex items-center rounded-full bg-slate-800 px-2.5 py-0.5 font-medium text-slate-200 ring-1 ring-slate-600/60">
                  Conta: {player.playerType}
                </span>
                <span className="inline-flex items-center rounded-full bg-slate-800 px-2.5 py-0.5 font-medium text-slate-200 ring-1 ring-slate-600/60">
                  Criado: {formatDateTime(player.createdAt)}
                </span>
                <span className="inline-flex items-center rounded-full bg-slate-800 px-2.5 py-0.5 font-medium text-slate-200 ring-1 ring-slate-600/60">
                  Atualizado: {formatDateTime(player.updatedAt)}
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

          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <h3 className="text-sm font-semibold text-slate-200">Personagens do jogador</h3>
                <p className="text-xs text-slate-400">Total: {characters.length}</p>
              </div>

              {loadingChars ? (
                <p className="mt-2 text-xs text-slate-400">Carregando personagens...</p>
              ) : characters.length === 0 ? (
                <p className="mt-2 text-xs text-slate-400">Este jogador ainda não possui personagens.</p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {characters.map((char) => {
                    const active = char.id === selectedCharacterId;
                    return (
                      <button
                        key={char.id}
                        type="button"
                        onClick={() => setSelectedCharacterId(char.id)}
                        className={`rounded-md border px-3 py-2 text-left text-xs ${
                          active
                            ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-200'
                            : 'border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800'
                        }`}
                      >
                        <p className="font-semibold">{char.name}</p>
                        <p className="text-[11px] opacity-80">{char.region || '-'} • {char.classType || '-'}</p>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <h3 className="mb-2 text-sm font-semibold text-slate-200">Resumo do personagem selecionado</h3>
                {selectedCharacter ? (
                  <div className="space-y-1 text-xs text-slate-300">
                    <p><span className="text-slate-400">Nome:</span> {selectedCharacter.name}</p>
                    <p><span className="text-slate-400">ID:</span> {selectedCharacter.id}</p>
                    <p><span className="text-slate-400">Região:</span> {selectedCharacter.region || '-'}</p>
                    <p><span className="text-slate-400">Classe:</span> {selectedCharacter.classType || '-'}</p>
                    <p><span className="text-slate-400">KM acumulada:</span> {selectedCharacter.kmWalked ?? 0}</p>
                    <p><span className="text-slate-400">PokeCoins:</span> {selectedCharacter.pokeCoins ?? 0}</p>
                    <p><span className="text-slate-400">Criado:</span> {formatDateTime(selectedCharacter.createdAt)}</p>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">Selecione um personagem.</p>
                )}
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <h3 className="mb-2 text-sm font-semibold text-slate-200">Resumo operacional</h3>
                {selectedCharacterId ? (
                  <div className="grid grid-cols-2 gap-2 text-xs text-slate-300">
                    <p><span className="text-slate-400">No time:</span> {team.length}</p>
                    <p><span className="text-slate-400">Na box:</span> {box.length}</p>
                    <p><span className="text-slate-400">Itens:</span> {itemsCount}</p>
                    <p><span className="text-slate-400">Pokébolas:</span> {ballsCount}</p>
                    <p><span className="text-slate-400">Ovos:</span> {eggsCount}</p>
                    <p><span className="text-slate-400">Batalhas (últimas):</span> {battleCount}</p>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">Sem personagem selecionado.</p>
                )}
              </div>
            </section>

            <UserTeam team={team} loading={loadingTeam} />

            <UserBoxPreview
              box={box}
              loading={loadingBox}
              onOpenFullBox={() => setBoxModalOpen(true)}
            />

            <section className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs text-slate-300">
              <h3 className="text-sm font-semibold text-slate-200">Fontes de dados usadas</h3>
              <p><code>players/{player.id}</code> (perfil do jogador)</p>
              <p><code>players/{player.id}/characters</code> (personagens)</p>
              {selectedCharacterId ? (
                <>
                  <p><code>players/{player.id}/characters/{selectedCharacterId}/time</code></p>
                  <p><code>players/{player.id}/characters/{selectedCharacterId}/box</code></p>
                  <p><code>players/{player.id}/characters/{selectedCharacterId}/itens</code> e <code>pokeballs</code></p>
                </>
              ) : null}
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

