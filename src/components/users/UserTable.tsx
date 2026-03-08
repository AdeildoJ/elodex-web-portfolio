'use client';

import type { Timestamp } from 'firebase/firestore';
import { PlayerSummary } from './types';

interface Props {
  players: PlayerSummary[];
  onSelectPlayer: (player: PlayerSummary) => void;
  loading?: boolean;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}

const formatDateTime = (ts?: Timestamp | null) => {
  if (!ts || !ts.toDate) return '-';
  return ts.toDate().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

const UserTable: React.FC<Props> = ({
  players,
  onSelectPlayer,
  loading,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
}) => {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 shadow-xl shadow-slate-950/40">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
            Lista de Jogadores
          </h2>
          <p className="text-xs text-slate-500">
            {loading ? 'Carregando jogadores...' : `${players.length} jogador(es) carregados`}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-900/80 text-xs uppercase text-slate-400">
            <tr>
              <th className="px-4 py-3">Jogador</th>
              <th className="px-4 py-3">Conta</th>
              <th className="px-4 py-3">Personagens</th>
              <th className="px-4 py-3">Principal</th>
              <th className="px-4 py-3">Atualizado</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-500">
                  Carregando jogadores...
                </td>
              </tr>
            )}

            {!loading && players.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-500">
                  Nenhum jogador encontrado com os filtros atuais.
                </td>
              </tr>
            )}

            {!loading &&
              players.map((player) => {
                const primary = player.primaryCharacter;
                return (
                  <tr key={player.id} className="border-t border-slate-800/80 hover:bg-slate-800/70">
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="font-medium">{player.nomeJogador || 'Sem nome'}</span>
                        <span className="text-xs text-slate-500">UID: {player.uid}</span>
                        <span className="text-xs text-slate-400">{player.email || '-'}</span>
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          player.playerType === 'VIP'
                            ? 'bg-amber-500/10 text-amber-300 ring-1 ring-amber-500/40'
                            : 'bg-slate-800 text-slate-200 ring-1 ring-slate-600/60'
                        }`}
                      >
                        {player.playerType}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-slate-300">{player.characterCount}</td>

                    <td className="px-4 py-3 text-slate-300">
                      {primary ? (
                        <div className="text-xs">
                          <p className="text-slate-100">{primary.name || primary.id}</p>
                          <p className="text-slate-400">
                            {primary.region || '-'} • {primary.classType || '-'}
                          </p>
                        </div>
                      ) : (
                        '-'
                      )}
                    </td>

                    <td className="px-4 py-3 text-slate-300">{formatDateTime(player.updatedAt || player.createdAt)}</td>

                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => onSelectPlayer(player)}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-emerald-50 shadow-sm shadow-emerald-900/60 transition hover:bg-emerald-500"
                      >
                        Gerenciar
                      </button>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {!loading && hasMore && onLoadMore && (
        <div className="border-t border-slate-800 px-4 py-3 text-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-60"
          >
            {loadingMore ? 'Carregando...' : 'Carregar mais'}
          </button>
        </div>
      )}
    </section>
  );
};

export default UserTable;

