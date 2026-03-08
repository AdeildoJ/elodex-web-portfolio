'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection,
  DocumentData,
  getDocs,
  limit,
  orderBy,
  query,
  QueryDocumentSnapshot,
  startAfter,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import Sidebar from '@/components/Sidebar';
import { CharacterSummary, FilterState, PlayerSummary } from './types';
import UserFiltersBar from './UserFiltersBar';
import UserTable from './UserTable';
import UserDetailsDrawer from './UserDetailsDrawer';

const PAGE_SIZE = 20;

function toNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function loadCharactersSummary(uid: string, selectedCharacterId?: string | null) {
  const charsCol = collection(db, 'players', uid, 'characters');
  const charsSnap = await getDocs(query(charsCol, orderBy('createdAt', 'asc')));

  const chars: CharacterSummary[] = charsSnap.docs.map((d) => {
    const data = d.data() as any;
    return {
      id: d.id,
      name: String(data?.name || d.id),
      region: data?.region ?? null,
      classType: data?.classType ?? null,
      createdAt: (data?.createdAt as Timestamp) ?? null,
      updatedAt: (data?.updatedAt as Timestamp) ?? null,
      kmWalked: toNumber(data?.kmWalked ?? data?.totalKm ?? data?.distanceKm ?? 0),
      pokeCoins: toNumber(data?.pokeCoins ?? 0),
      level: toNumber(data?.level ?? 1, 1),
    };
  });

  const primary =
    (selectedCharacterId ? chars.find((c) => c.id === selectedCharacterId) : null) ||
    chars[0] ||
    null;

  return { chars, primary };
}

const UsuariosPageContent: React.FC = () => {
  const [players, setPlayers] = useState<PlayerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);

  const [filters, setFilters] = useState<FilterState>({
    search: '',
    status: 'all',
    accountType: 'all',
    hasCharacters: 'all',
  });
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerSummary | null>(null);

  const mapSnapshotToRows = useCallback(async (docs: QueryDocumentSnapshot<DocumentData>[]) => {
    const mapped = await Promise.all(
      docs.map(async (docSnap) => {
        const d = docSnap.data() as any;
        const uid = docSnap.id;
        const selectedCharacterId = (d?.selectedCharacterId ?? null) as string | null;
        const { chars, primary } = await loadCharactersSummary(uid, selectedCharacterId);

        const playerTypeRaw = String(d?.playerType || 'FREE').toUpperCase();
        const playerType = playerTypeRaw === 'VIP' ? 'VIP' : 'FREE';

        const statusRaw = String(d?.status || 'active').toLowerCase();
        const status = statusRaw === 'inactive' ? 'inactive' : 'active';

        const row: PlayerSummary = {
          id: uid,
          uid,
          nomeJogador: String(d?.nomeJogador || d?.displayName || 'Sem nome'),
          email: String(d?.email || '-'),
          playerType,
          status,
          createdAt: (d?.createdAt as Timestamp) ?? null,
          updatedAt: (d?.updatedAt as Timestamp) ?? null,
          selectedCharacterId,
          characterCount: chars.length,
          primaryCharacter: primary,
        };

        return row;
      })
    );

    return mapped;
  }, []);

  const loadFirstPage = useCallback(async () => {
    setLoading(true);
    try {
      const qPlayers = query(collection(db, 'players'), orderBy('__name__', 'asc'), limit(PAGE_SIZE + 1));
      const snapshot = await getDocs(qPlayers);

      const docs = snapshot.docs;
      const nextHasMore = docs.length > PAGE_SIZE;
      const visibleDocs = nextHasMore ? docs.slice(0, PAGE_SIZE) : docs;
      const mapped = await mapSnapshotToRows(visibleDocs);

      setPlayers(mapped);
      setHasMore(nextHasMore);
      setCursor(visibleDocs.length ? visibleDocs[visibleDocs.length - 1] : null);
    } catch (err) {
      console.error('[UsuariosPage] Erro ao carregar jogadores:', err);
      setPlayers([]);
      setHasMore(false);
      setCursor(null);
    } finally {
      setLoading(false);
    }
  }, [mapSnapshotToRows]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const qPlayers = query(
        collection(db, 'players'),
        orderBy('__name__', 'asc'),
        startAfter(cursor),
        limit(PAGE_SIZE + 1)
      );
      const snapshot = await getDocs(qPlayers);
      const docs = snapshot.docs;
      const nextHasMore = docs.length > PAGE_SIZE;
      const visibleDocs = nextHasMore ? docs.slice(0, PAGE_SIZE) : docs;
      const mapped = await mapSnapshotToRows(visibleDocs);

      setPlayers((prev) => [...prev, ...mapped]);
      setHasMore(nextHasMore);
      setCursor(visibleDocs.length ? visibleDocs[visibleDocs.length - 1] : cursor);
    } catch (err) {
      console.error('[UsuariosPage] Erro ao carregar mais jogadores:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore, mapSnapshotToRows]);

  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage]);

  const filteredPlayers = useMemo(() => {
    const list = players.filter((p) => {
      if (filters.status !== 'all' && p.status !== filters.status) return false;
      if (filters.accountType !== 'all' && p.playerType !== filters.accountType) return false;
      if (filters.hasCharacters === 'with' && p.characterCount <= 0) return false;
      if (filters.hasCharacters === 'without' && p.characterCount > 0) return false;

      if (filters.search.trim()) {
        const s = filters.search.toLowerCase();
        const inName = p.nomeJogador.toLowerCase().includes(s);
        const inEmail = p.email.toLowerCase().includes(s);
        const inUid = p.uid.toLowerCase().includes(s);
        if (!inName && !inEmail && !inUid) return false;
      }

      return true;
    });

    return [...list].sort((a, b) => {
      const ta = a.updatedAt?.toMillis?.() ?? a.createdAt?.toMillis?.() ?? 0;
      const tb = b.updatedAt?.toMillis?.() ?? b.createdAt?.toMillis?.() ?? 0;
      return tb - ta;
    });
  }, [players, filters]);

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <Sidebar />

      <main className="flex-1 p-4 md:p-6 lg:p-8">
        <header className="mb-6">
          <UserFiltersBar filters={filters} onChange={setFilters} />
        </header>

        <UserTable
          players={filteredPlayers}
          loading={loading}
          hasMore={hasMore}
          loadingMore={loadingMore}
          onLoadMore={loadMore}
          onSelectPlayer={(p) => setSelectedPlayer(p)}
        />

        {selectedPlayer && (
          <UserDetailsDrawer player={selectedPlayer} onClose={() => setSelectedPlayer(null)} />
        )}
      </main>
    </div>
  );
};

export default UsuariosPageContent;
