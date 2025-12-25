// src/components/users/UserFiltersBar.tsx
'use client';

import { FilterState } from './types';

interface Props {
  filters: FilterState;
  onChange: (next: FilterState) => void;
}

const UserFiltersBar: React.FC<Props> = ({ filters, onChange }) => {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Gerenciar Usuários
        </h1>
        <p className="text-sm text-slate-400">
          Visualize e acompanhe todos os treinadores cadastrados no EloDex.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Buscar por nome, e-mail ou ID..."
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 md:w-64"
        />

        <select
          value={filters.status}
          onChange={(e) =>
            onChange({
              ...filters,
              status: e.target.value as FilterState['status'],
            })
          }
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        >
          <option value="all">Status: Todos</option>
          <option value="active">Ativo</option>
          <option value="inactive">Inativo</option>
        </select>

        <select
          value={filters.accountType}
          onChange={(e) =>
            onChange({
              ...filters,
              accountType: e.target.value as FilterState['accountType'],
            })
          }
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        >
          <option value="all">Tipo: Todos</option>
          <option value="vip">VIP</option>
          <option value="common">Comum</option>
        </select>

        <label className="flex items-center gap-2 text-xs md:text-sm">
          <input
            type="checkbox"
            checked={filters.onlyExpiring}
            onChange={(e) =>
              onChange({ ...filters, onlyExpiring: e.target.checked })
            }
            className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-emerald-500"
          />
          Pokémon expiring
        </label>

        <label className="flex items-center gap-2 text-xs md:text-sm">
          <input
            type="checkbox"
            checked={filters.onlyBoxFull}
            onChange={(e) =>
              onChange({ ...filters, onlyBoxFull: e.target.checked })
            }
            className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-emerald-500"
          />
          Box cheia
        </label>
      </div>
    </div>
  );
};

export default UserFiltersBar;
