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
        <h1 className="text-2xl font-semibold tracking-tight">Gerenciamento de Jogadores</h1>
        <p className="text-sm text-slate-400">
          Painel administrativo dos jogadores reais do app mobile.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Buscar por nome, e-mail ou UID..."
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 md:w-72"
        />

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
          <option value="all">Conta: Todas</option>
          <option value="FREE">FREE</option>
          <option value="VIP">VIP</option>
        </select>

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
          value={filters.hasCharacters}
          onChange={(e) =>
            onChange({
              ...filters,
              hasCharacters: e.target.value as FilterState['hasCharacters'],
            })
          }
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        >
          <option value="all">Personagens: Todos</option>
          <option value="with">Com personagens</option>
          <option value="without">Sem personagens</option>
        </select>
      </div>
    </div>
  );
};

export default UserFiltersBar;
