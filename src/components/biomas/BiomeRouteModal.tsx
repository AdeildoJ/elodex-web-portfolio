"use client";

import { useEffect, useMemo, useState } from "react";

import itemsJson from "@/data/items.json";
import movesJson from "@/data/moves.json";
import pokemonSpeciesJson from "@/data/pokemon/pokemonSpecies.json";
import { defaultRouteId, type BiomeRouteRecord } from "@/lib/biomeRoutes";
import { FilteredMultiNumber, FilteredMultiString, type CatalogSpeciesOption } from "@/components/biomas/CatalogMultiPickers";

type BiomeOption = { id: string; name: string };

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2">
      <span className="text-xs font-medium text-slate-300">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition ${
          checked ? "border-emerald-400/60 bg-emerald-500/30" : "border-slate-700 bg-slate-800"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}

export type BiomeRouteModalProps = {
  open: boolean;
  onClose: () => void;
  onSave: (route: BiomeRouteRecord) => Promise<void> | void;
  biomes: BiomeOption[];
  /** Rota existente ou null ao criar pela conexão. */
  initial: BiomeRouteRecord | null;
  connectFrom: string;
  connectTo: string;
};

export default function BiomeRouteModal({
  open,
  onClose,
  onSave,
  biomes,
  initial,
  connectFrom,
  connectTo,
}: BiomeRouteModalProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [routeId, setRouteId] = useState("");
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [bidirectional, setBidirectional] = useState(false);
  const [kmCost, setKmCost] = useState(0);
  const [requiredItemIds, setRequiredItemIds] = useState<string[]>([]);
  const [requiredMoveIds, setRequiredMoveIds] = useState<string[]>([]);
  const [requiredPokemonIds, setRequiredPokemonIds] = useState<number[]>([]);
  const [requiresTicket, setRequiresTicket] = useState(false);
  const [consumeTicketOnEnter, setConsumeTicketOnEnter] = useState(false);
  const [status, setStatus] = useState<"active" | "inactive">("active");
  const fromLocked = !!initial || !!connectFrom.trim();
  const toLocked = !!initial || !!connectTo.trim();

  const speciesOptions = useMemo((): CatalogSpeciesOption[] => {
    const root = pokemonSpeciesJson as Record<string, { id?: number; name?: string }>;
    return Object.values(root)
      .map((row) => {
        const id = Number(row.id || 0);
        const name = String(row.name || "").trim();
        if (!id || !name) return null;
        return { id, label: `#${id} ${name}` };
      })
      .filter((v): v is CatalogSpeciesOption => v != null)
      .sort((a, b) => a.id - b.id);
  }, []);

  const moveOptions = useMemo(() => {
    const root = movesJson as Record<string, { name?: string }>;
    return Object.entries(root)
      .map(([id, row]) => ({ id, label: String(row?.name || id) }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, []);

  const itemOptions = useMemo(() => {
    const root = itemsJson as Record<string, { id?: string; name?: string }>;
    return Object.values(root)
      .map((row) => {
        const id = String(row.id || "").trim().toLowerCase();
        if (!id) return null;
        return { id, label: `${id} — ${String(row.name || id)}` };
      })
      .filter((v): v is { id: string; label: string } => v != null)
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, []);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (initial) {
      setRouteId(initial.id);
      setFromId(initial.fromBiomeId);
      setToId(initial.toBiomeId);
      setBidirectional(initial.bidirectional);
      setKmCost(initial.kmCost);
      setRequiredItemIds(initial.requiredItemIds);
      setRequiredMoveIds(initial.requiredMoveIds);
      setRequiredPokemonIds(initial.requiredPokemonIds);
      setRequiresTicket(initial.requiresTicket);
      setConsumeTicketOnEnter(initial.consumeTicketOnEnter);
      setStatus(initial.status);
    } else {
      const a = connectFrom.trim().toLowerCase();
      const b = connectTo.trim().toLowerCase();
      setRouteId(defaultRouteId(a, b));
      setFromId(a);
      setToId(b);
      setBidirectional(false);
      setKmCost(0);
      setRequiredItemIds([]);
      setRequiredMoveIds([]);
      setRequiredPokemonIds([]);
      setRequiresTicket(false);
      setConsumeTicketOnEnter(false);
      setStatus("active");
    }
  }, [open, initial, connectFrom, connectTo]);

  function validate(): string | null {
    if (!fromId || !toId) return "Origem e destino são obrigatórios.";
    if (fromId === toId) return "Origem e destino devem ser diferentes.";
    if (kmCost < 0 || !Number.isFinite(kmCost)) return "Custo KM deve ser um número ≥ 0.";
    return null;
  }

  async function handleSave() {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const rec: BiomeRouteRecord = {
        id: routeId.trim() || defaultRouteId(fromId, toId),
        fromBiomeId: fromId.trim().toLowerCase(),
        toBiomeId: toId.trim().toLowerCase(),
        bidirectional,
        kmCost: Math.max(0, Math.trunc(kmCost)),
        requiredItemIds,
        requiredMoveIds,
        requiredPokemonIds,
        requiresTicket,
        ticketItemId: "",
        consumeTicketOnEnter,
        status,
      };
      await onSave(rec);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar rota.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const biomeLabel = (id: string) => biomes.find((b) => b.id === id)?.name ?? id;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/65 px-3 py-6">
      <div
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="route-modal-title"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-800 px-5 py-4">
          <h2 id="route-modal-title" className="text-lg font-semibold text-white">
            Configurar Rota
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
            aria-label="Fechar"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>
          )}

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-400">
                Origem <span className="text-red-400">*</span>
              </label>
              {fromLocked ? (
                <select
                  value={fromId}
                  disabled
                  className="w-full cursor-not-allowed rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300"
                >
                  <option value={fromId}>{biomeLabel(fromId)}</option>
                </select>
              ) : (
                <select
                  value={fromId}
                  onChange={(e) => setFromId(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                >
                  <option value="">Selecione…</option>
                  {biomes.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-400">
                Destino <span className="text-red-400">*</span>
              </label>
              {toLocked ? (
                <select
                  value={toId}
                  disabled
                  className="w-full cursor-not-allowed rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300"
                >
                  <option value={toId}>{biomeLabel(toId)}</option>
                </select>
              ) : (
                <select
                  value={toId}
                  onChange={(e) => setToId(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                >
                  <option value="">Selecione…</option>
                  {biomes
                    .filter((b) => b.id !== fromId)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                </select>
              )}
            </div>

            <div className="space-y-2">
              <span className="text-xs font-medium text-slate-400">
                Direção <span className="text-red-400">*</span>
              </span>
              <div className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
                  <input
                    type="radio"
                    name="dir"
                    checked={!bidirectional}
                    onChange={() => setBidirectional(false)}
                  />
                  Ida apenas
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
                  <input
                    type="radio"
                    name="dir"
                    checked={bidirectional}
                    onChange={() => setBidirectional(true)}
                  />
                  Ida e volta
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-400">
                Custo KM <span className="text-red-400">*</span>
              </label>
              <input
                type="number"
                min={0}
                value={kmCost}
                onChange={(e) => setKmCost(Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              />
            </div>

            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Requisitos da Rota</p>

            <FilteredMultiString
              label="Item necessário"
              options={itemOptions}
              values={requiredItemIds}
              onChange={setRequiredItemIds}
            />
            <FilteredMultiString
              label="Movimento necessário"
              options={moveOptions.map((m) => ({ id: m.id, label: m.label }))}
              values={requiredMoveIds}
              onChange={setRequiredMoveIds}
            />
            <FilteredMultiNumber
              label="Pokémon necessário"
              options={speciesOptions}
              values={requiredPokemonIds}
              onChange={setRequiredPokemonIds}
            />

            <Toggle label="Exige ticket global de bioma" checked={requiresTicket} onChange={setRequiresTicket} />
            {requiresTicket && (
              <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/8 px-3 py-2 text-xs text-cyan-100">
                Esta rota usa o ticket único/global vendido na loja de monetização. Não é necessário selecionar item específico.
              </div>
            )}
            <Toggle label="Consumir ticket ao entrar" checked={consumeTicketOnEnter} onChange={setConsumeTicketOnEnter} />

            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-400">
                Status da Rota <span className="text-red-400">*</span>
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value === "inactive" ? "inactive" : "active")}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              >
                <option value="active">Ativa</option>
                <option value="inactive">Inativa</option>
              </select>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-800 bg-slate-950/95 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {saving ? "Salvando…" : "Salvar Rota"}
          </button>
        </div>
      </div>
    </div>
  );
}
