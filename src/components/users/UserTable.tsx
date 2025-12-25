'use client';

import type { Timestamp } from 'firebase/firestore';
import { PlayerSummary } from './types';

interface Props {
  players: PlayerSummary[];
  onSelectPlayer: (player: PlayerSummary) => void;
  loading?: boolean;
}

const formatDate = (ts?: Timestamp | null) => {
  if (!ts || !ts.toDate) return '-';
  return ts.toDate().toLocaleDateString('pt-BR');
};

const UserTable: React.FC<Props> = ({ players, onSelectPlayer, loading }) => {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 shadow-xl shadow-slate-950/40">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
            Lista de Usuários
          </h2>
          <p className="text-xs text-slate-500">
            {loading ? 'Carregando jogadores...' : `${players.length} jogador(es) encontrados`}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-900/80 text-xs uppercase text-slate-400">
            <tr>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">E-mail</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Cadastro</th>
              <th className="px-4 py-3">Box</th>
              <th className="px-4 py-3">ECoin</th>
              <th className="px-4 py-3">Itens</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-6 text-center text-sm text-slate-500"
                >
                  Carregando usuários...
                </td>
              </tr>
            )}

            {!loading && players.length === 0 && (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-6 text-center text-sm text-slate-500"
                >
                  Nenhum jogador encontrado com os filtros atuais.
                </td>
              </tr>
            )}

            {!loading &&
              players.map((player) => (
                <tr
                  key={player.id}
                  className="border-t border-slate-800/80 hover:bg-slate-800/70"
                >
                  <td className="px-4 py-3">
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {player.displayName}
                      </span>
                      <span className="text-xs text-slate-500">
                        ID: {player.id}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {player.email}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        player.accountType === 'vip'
                          ? 'bg-amber-500/10 text-amber-300 ring-1 ring-amber-500/40'
                          : 'bg-slate-800 text-slate-200 ring-1 ring-slate-600/60'
                      }`}
                    >
                      {player.accountType === 'vip' ? 'VIP' : 'Comum'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        player.status === 'active'
                          ? 'bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/40'
                          : 'bg-rose-500/10 text-rose-300 ring-1 ring-rose-500/40'
                      }`}
                    >
                      {player.status === 'active' ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {formatDate(player.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {player.boxCurrent ?? 0} / {player.boxTotalLimit ?? 0}
                    {player.hasExpiringPokemon && (
                      <span className="ml-2 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">
                        Expiring
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {player.ecoinBalance ?? 0}
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {player.itemsCount ?? 0} itens
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => onSelectPlayer(player)}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-emerald-50 shadow-sm shadow-emerald-900/60 transition hover:bg-emerald-500"
                    >
                      Ver ficha
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default UserTable;
