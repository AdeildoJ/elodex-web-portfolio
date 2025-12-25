'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  getDocs,
  orderBy,
  query,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import Sidebar from '@/components/Sidebar';
import {
  FilterState,
  PlayerSummary,
} from './types';
import UserFiltersBar from './UserFiltersBar';
import UserTable from './UserTable';
import UserDetailsDrawer from "./UserDetailsDrawer";

const UsuariosPageContent: React.FC = () => {
  const [players, setPlayers] = useState<PlayerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<FilterState>({
    search: '',
    status: 'all',
    accountType: 'all',
    onlyExpiring: false,
    onlyBoxFull: false,
  });
  const [selectedPlayer, setSelectedPlayer] =
    useState<PlayerSummary | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadUsers = async () => {
      try {
        setLoading(true);
        const qUsers = query(
          collection(db, 'users'),
          orderBy('createdAt', 'desc')
        );
        const snapshot = await getDocs(qUsers);

        if (cancelled) return;

        const data: PlayerSummary[] = snapshot.docs.map((doc) => {
          const d = doc.data() as any;
          return {
            id: doc.id,
            displayName: d.displayName ?? 'Sem nome',
            email: d.email ?? '-',
            status: (d.status ?? 'active') as any,
            accountType: (d.accountType ?? 'common') as any,
            createdAt: d.createdAt ?? null,
            boxCurrent: d.boxCurrent ?? 0,
            boxTotalLimit: d.boxTotalLimit ?? d.boxLimit ?? 0,
            ecoinBalance: d.ecoinBalance ?? 0,
            itemsCount: d.itemsCount ?? 0,
            hasExpiringPokemon: d.hasExpiringPokemon ?? false,
            boxIsFull: d.boxIsFull ?? false,
            lastLoginAt: d.lastLoginAt ?? null,
            region: d.region ?? null,
            characterClass: d.characterClass ?? null,
            starterSpeciesId: d.starterSpeciesId ?? null,
            level: d.level ?? 1,
            xp: d.xp ?? 0,
            kmWalked: d.kmWalked ?? 0,
            pokedexSeen: d.pokedexSeen ?? 0,
            pokedexCaught: d.pokedexCaught ?? 0,
            missionsCompleted: d.missionsCompleted ?? 0,
            badges: d.badges ?? 0,
          };
        });

        setPlayers(data);
      } catch (err) {
        console.error('[UsuariosPage] Erro ao carregar usuários:', err);
        if (!cancelled) setPlayers([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadUsers();

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredPlayers = useMemo(() => {
    return players.filter((p) => {
      if (filters.status !== 'all' && p.status !== filters.status) {
        return false;
      }
      if (
        filters.accountType !== 'all' &&
        p.accountType !== filters.accountType
      ) {
        return false;
      }
      if (filters.onlyExpiring && !p.hasExpiringPokemon) return false;
      if (filters.onlyBoxFull && !p.boxIsFull) return false;

      if (filters.search.trim()) {
        const s = filters.search.toLowerCase();
        const matchesName = p.displayName.toLowerCase().includes(s);
        const matchesEmail = p.email.toLowerCase().includes(s);
        const matchesId = p.id.toLowerCase().includes(s);
        if (!matchesName && !matchesEmail && !matchesId) return false;
      }

      return true;
    });
  }, [players, filters]);

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <Sidebar />

      <main className="flex-1 p-4 md:p-6 lg:p-8">
        <header className="mb-6">
          <UserFiltersBar
            filters={filters}
            onChange={setFilters}
          />
        </header>

        <UserTable
          players={filteredPlayers}
          loading={loading}
          onSelectPlayer={(p) => setSelectedPlayer(p)}
        />

        {selectedPlayer && (
          <UserDetailsDrawer
            player={selectedPlayer}
            onClose={() => setSelectedPlayer(null)}
          />
        )}
      </main>
    </div>
  );
};

export default UsuariosPageContent;
