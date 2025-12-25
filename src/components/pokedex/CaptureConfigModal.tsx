// src/components/pokedex/CaptureConfigModal.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  ALL_TYPES,
  PokemonSpecies,
  PokemonType,
} from "@/components/pokedex/pokedexTypes";
import movesJson from "@/data/moves.json";

type CaptureMethod = "selvagem" | "pesca" | "safari" | "roubo";

type StatKey =
  | "hp"
  | "attack"
  | "defense"
  | "specialAttack"
  | "specialDefense"
  | "speed";

interface MoveSummary {
  id: string; // id do golpe (slug)
  name: string;
  type: PokemonType | null;
  power: number | null;
  accuracy: number | null;
  pp: number | null;
  damageClass: "physical" | "special" | "status" | string;
  priority?: number | null;
}

interface PokemonCaptureConfig {
  speciesId: string;

  // especiais
  isSpecial: boolean;
  speciesName?: string;
  specialCount: number | null;
  specialMoves: (string | null)[]; // até 4 movimentos

  // encontro
  method: CaptureMethod;
  minLevel: number | null;
  maxLevel: number | null;
  encounterRate: number | null;
  shinyRate: number | null;

  // limites
  captureLimit: number | null;
  unlimitedCaptures: boolean;

  // tipos customizados (apenas especiais)
  customTypes: PokemonType[];

  // EVs / IVs especiais
  evs: Partial<Record<StatKey, number>>;
  ivs: Partial<Record<StatKey, number>>;
}

interface GeneralConfig {
  method: CaptureMethod;
  encounterRate: number | null;
  shinyRate: number | null;
  captureLimit: number | null;
  unlimitedCaptures: boolean;
}

type Step = "mode" | "individual" | "general";

interface CaptureConfigModalProps {
  open: boolean;
  onClose: () => void;
  markedPokemon: PokemonSpecies[];
  versionId: string;
}

const STAT_LABEL: Record<StatKey, string> = {
  hp: "HP",
  attack: "Atk",
  defense: "Def",
  specialAttack: "Sp. Atk",
  specialDefense: "Sp. Def",
  speed: "Speed",
};

const captureMethodLabel: Record<CaptureMethod, string> = {
  selvagem: "Selvagem",
  pesca: "Pesca",
  safari: "Safari",
  roubo: "Roubo",
};

const typeLabel = (t: PokemonType) =>
  t.charAt(0).toUpperCase() + t.slice(1);

const DEFAULT_GENERAL_CONFIG: GeneralConfig = {
  method: "selvagem",
  encounterRate: 10,
  shinyRate: 0.05,
  captureLimit: 10,
  unlimitedCaptures: false,
};

const DEFAULT_CAPTURE_CONFIG = (speciesId: string): PokemonCaptureConfig => ({
  speciesId,
  isSpecial: false,
  specialCount: null,
  specialMoves: [null, null, null, null],
  method: "selvagem",
  minLevel: 1,
  maxLevel: 40,
  encounterRate: 10,
  shinyRate: 0.05,
  captureLimit: 10,
  unlimitedCaptures: false,
  customTypes: [],
  evs: {},
  ivs: {},
});

function clampNumber(
  value: number | null | undefined,
  min: number,
  max: number
): number | null {
  if (value == null || Number.isNaN(Number(value))) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

function formatMoveName(name: string) {
  return name
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatMoveSummary(move: MoveSummary | undefined): string {
  if (!move) return "";
  const pieces: string[] = [];

  if (move.power != null) pieces.push(`Pwr ${move.power}`);
  if (move.accuracy != null) pieces.push(`Acc ${move.accuracy}%`);
  if (move.pp != null) pieces.push(`PP ${move.pp}`);

  if (move.damageClass) {
    if (move.damageClass === "physical") pieces.push("Físico");
    else if (move.damageClass === "special") pieces.push("Especial");
    else if (move.damageClass === "status") pieces.push("Status");
    else pieces.push(String(move.damageClass));
  }

  if (move.type) pieces.push(typeLabel(move.type));
  if (move.priority && move.priority !== 0) {
    const sign = move.priority > 0 ? "+" : "";
    pieces.push(`Prio ${sign}${move.priority}`);
  }

  return pieces.join(" • ");
}

// tenta excluir Z-Moves e G-Max/Giga moves
function isZOrMaxMove(data: any): boolean {
  const name = (data?.name ?? "").toString().toLowerCase();

  if (name.startsWith("g-max-")) return true;
  if (name.includes("z-move")) return true;

  // alguns padrões conhecidos de Z-Moves
  if (name.startsWith("breakneck-blitz")) return true;
  if (name.startsWith("all-out-pummeling")) return true;
  if (name.startsWith("supersonic-skystrike")) return true;
  if (name.startsWith("acid-downpour")) return true;
  if (name.startsWith("tectonic-rage")) return true;
  if (name.startsWith("continental-crush")) return true;
  if (name.startsWith("savage-spin-out")) return true;
  if (name.startsWith("never-ending-nightmare")) return true;
  if (name.startsWith("corkscrew-crash")) return true;
  if (name.startsWith("inferno-overdrive")) return true;
  if (name.startsWith("hydro-vortex")) return true;
  if (name.startsWith("bloom-doom")) return true;
  if (name.startsWith("gigavolt-havoc")) return true;
  if (name.startsWith("shattered-psyche")) return true;
  if (name.startsWith("subzero-slammer")) return true;
  if (name.startsWith("devastating-drake")) return true;
  if (name.startsWith("black-hole-eclipse")) return true;
  if (name.startsWith("twinkle-tackle")) return true;
  if (name.endsWith("-z")) return true;

  return false;
}

export default function CaptureConfigModal({
  open,
  onClose,
  markedPokemon,
  versionId,
}: CaptureConfigModalProps) {
  const [step, setStep] = useState<Step>("mode");

  const [configs, setConfigs] = useState<Record<string, PokemonCaptureConfig>>(
    {}
  );

  const [generalConfig, setGeneralConfig] = useState<GeneralConfig>({
    ...DEFAULT_GENERAL_CONFIG,
  });

  // lista de movimentos
  const [moves, setMoves] = useState<MoveSummary[]>([]);
  const [movesLoading, setMovesLoading] = useState(false);
  const [movesLoadedOnce, setMovesLoadedOnce] = useState(false);

  const markedCount = markedPokemon.length;

  // Sempre que abrir: garante configs básicas
  useEffect(() => {
    if (!open) return;

    setStep("mode");

    setConfigs((prev) => {
      const next: Record<string, PokemonCaptureConfig> = { ...prev };
      for (const pk of markedPokemon) {
  if (!next[pk.id]) {
    next[pk.id] = {
      ...DEFAULT_CAPTURE_CONFIG(pk.id),
      speciesName: pk.name, // 👈 salva o nome aqui
    };
  } else if (!next[pk.id].speciesName) {
    // se já existia config, mas sem nome, preenche agora
    next[pk.id].speciesName = pk.name;
  }
}
      // remove espécies que não estão mais marcadas
      for (const key of Object.keys(next)) {
        if (!markedPokemon.some((pk) => pk.id === key)) {
          delete next[key];
        }
      }
      return next;
    });
  }, [open, markedPokemon]);

  // Carga preguiçosa da lista de movimentos (JSON):
  // só quando existir pelo menos 1 Pokémon especial
  useEffect(() => {
    if (!open) return;
    if (movesLoadedOnce || moves.length > 0 || movesLoading) return;

    const anySpecial = Object.values(configs).some((cfg) => cfg.isSpecial);
    if (!anySpecial) return;

    let cancelled = false;

    async function loadMovesFromJson() {
      try {
        setMovesLoading(true);

        const list: MoveSummary[] = [];
        const allMoves = movesJson as Record<string, any>;

        for (const [id, data] of Object.entries(allMoves)) {
          if (isZOrMaxMove(data)) continue;

          list.push({
            id,
            name: data.name ?? id,
            type: (data.type ?? null) as PokemonType | null,
            power:
              typeof data.power === "number"
                ? data.power
                : data.power != null
                ? Number(data.power)
                : null,
            accuracy:
              typeof data.accuracy === "number"
                ? data.accuracy
                : data.accuracy != null
                ? Number(data.accuracy)
                : null,
            pp:
              typeof data.pp === "number"
                ? data.pp
                : data.pp != null
                ? Number(data.pp)
                : null,
            damageClass: data.damageClass ?? "status",
            priority:
              typeof data.priority === "number"
                ? data.priority
                : data.priority != null
                ? Number(data.priority)
                : null,
          });
        }

        list.sort((a, b) => a.name.localeCompare(b.name));

        if (cancelled) return;
        setMoves(list);
        setMovesLoadedOnce(true);
      } catch (err) {
        console.error("Erro ao carregar lista de movimentos (JSON):", err);
      } finally {
        if (!cancelled) setMovesLoading(false);
      }
    }

    loadMovesFromJson();

    return () => {
      cancelled = true;
    };
  }, [open, configs, movesLoadedOnce, moves.length, movesLoading]);

  const movesById = useMemo(() => {
    const map = new Map<string, MoveSummary>();
    for (const m of moves) map.set(m.id, m);
    return map;
  }, [moves]);

  function updateConfig(
    speciesId: string,
    patch: Partial<PokemonCaptureConfig>
  ) {
    setConfigs((prev) => {
      const current = prev[speciesId];
      if (!current) return prev;
      return {
        ...prev,
        [speciesId]: { ...current, ...patch },
      };
    });
  }

  function updateConfigStat(
    speciesId: string,
    kind: "evs" | "ivs",
    stat: StatKey,
    value: number | null
  ) {
    setConfigs((prev) => {
      const current = prev[speciesId];
      if (!current) return prev;

      const block = { ...(current[kind] || {}) };
      if (value == null) {
        delete block[stat];
      } else {
        block[stat] = value;
      }

      return {
        ...prev,
        [speciesId]: {
          ...current,
          [kind]: block,
        },
      };
    });
  }

  function setSpecialMove(
    speciesId: string,
    index: number,
    moveId: string | null
  ) {
    setConfigs((prev) => {
      const current = prev[speciesId];
      if (!current) return prev;

      const specialMoves = [...current.specialMoves];
      specialMoves[index] = moveId;

      return {
        ...prev,
        [speciesId]: {
          ...current,
          specialMoves,
        },
      };
    });
  }

  function toggleCustomType(speciesId: string, type: PokemonType) {
    setConfigs((prev) => {
      const current = prev[speciesId];
      if (!current) return prev;

      const exists = current.customTypes.includes(type);
      const customTypes = exists
        ? current.customTypes.filter((t) => t !== type)
        : [...current.customTypes, type];

      return {
        ...prev,
        [speciesId]: {
          ...current,
          customTypes,
        },
      };
    });
  }

  function applyGeneralToAll() {
    setConfigs((prev) => {
      const next: Record<string, PokemonCaptureConfig> = {};
      for (const [id, cfg] of Object.entries(prev)) {
        next[id] = {
          ...cfg,
          method: generalConfig.method,
          encounterRate: generalConfig.encounterRate,
          shinyRate: generalConfig.shinyRate,
          unlimitedCaptures: generalConfig.unlimitedCaptures,
          captureLimit: generalConfig.unlimitedCaptures
            ? null
            : generalConfig.captureLimit,
        };
      }
      return next;
    });
  }

  // SALVAR em pokedexConfig (ID unificado versionId_speciesId)
    // SALVAR em pokedexConfig (ID unificado quando houver versionId)
  async function handleSave() {
    try {
      const entries = Object.values(configs);

      await Promise.all(
        entries.map(async (cfg) => {
          const hasVersion = !!versionId && versionId.trim() !== "";

          // se tiver versionId, usa versionId_speciesId
          // se não tiver, volta pro ID antigo só com speciesId
          const docId = hasVersion
            ? `${versionId}_${cfg.speciesId}`
            : String(cfg.speciesId);

          const ref = doc(db, "pokedexConfig", docId);

          const normalizedCaptureLimit =
            cfg.unlimitedCaptures || cfg.captureLimit == null
              ? null
              : cfg.captureLimit;

          const normalizedSpecialCount = cfg.isSpecial
            ? cfg.specialCount ?? null
            : null;

          const payload: any = {
            speciesId: Number.isNaN(Number(cfg.speciesId))
              ? cfg.speciesId
              : Number(cfg.speciesId),

            speciesName: cfg.speciesName ?? null,
            method: cfg.method,
            minLevel: cfg.minLevel ?? null,
            maxLevel: cfg.maxLevel ?? null,
            encounterRate: cfg.encounterRate ?? null,
            shinyRate: cfg.shinyRate ?? null,
            captureLimit: normalizedCaptureLimit,
            unlimitedCaptures: cfg.unlimitedCaptures,

            isSpecial: cfg.isSpecial,
            specialCount: normalizedSpecialCount,
            customTypes: cfg.isSpecial ? cfg.customTypes : [],

            evs: cfg.evs ?? {},
            ivs: cfg.ivs ?? {},

            specialMoves: cfg.isSpecial
              ? cfg.specialMoves.filter((m) => !!m)
              : [],

            updatedAt: serverTimestamp(),
          };

          // só manda versionId se ele EXISTIR de verdade
          if (hasVersion) {
            payload.versionId = versionId;
          }

          await setDoc(ref, payload, { merge: true });
        })
      );

      console.log(
        "Configurações de captura salvas em pokedexConfig:",
        configs
      );
      onClose();
    } catch (error) {
      console.error(
        "Erro ao salvar configurações de captura em pokedexConfig:",
        error
      );
      alert(
        "Não foi possível salvar as configurações de captura. Veja o console para detalhes."
      );
    }
  }

  if (!open) return null;

  const speciesList = markedPokemon.map((pk) => ({
    ...pk,
    config: configs[pk.id] ?? DEFAULT_CAPTURE_CONFIG(pk.id),
  }));

  const anySpecial = Object.values(configs).some((cfg) => cfg.isSpecial);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-3 py-6">
      <div className="w-full max-w-5xl max-h-[90vh] rounded-2xl bg-slate-950 border border-slate-800 shadow-xl flex flex-col">
        {/* Cabeçalho */}
        <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">
              Configurar Capturas
            </h2>
            <p className="text-[11px] text-slate-400">
              {markedCount === 0
                ? "Nenhum Pokémon marcado. Marque espécies na Pokédex para configurá-las."
                : `${markedCount} Pokémon marcado(s) para configuração.`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 text-sm"
          >
            ✕
          </button>
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-sm">
          {markedCount === 0 && (
            <p className="text-xs text-slate-400">
              Nenhum Pokémon foi marcado. Utilize a opção &quot;Marcar&quot;
              nos cards da Pokédex ou os filtros de marcação para selecionar
              as espécies antes de configurar as capturas.
            </p>
          )}

          {markedCount > 0 && (
            <>
              {/* Stepper */}
              <div className="flex flex-wrap gap-2 text-[11px] mb-2">
                <button
                  type="button"
                  onClick={() => setStep("mode")}
                  className={`px-2.5 py-1 rounded-full border ${
                    step === "mode"
                      ? "bg-emerald-500 text-slate-900 border-emerald-400"
                      : "bg-slate-900 text-slate-200 border-slate-700"
                  }`}
                >
                  1. Modo
                </button>
                <button
                  type="button"
                  onClick={() => setStep("individual")}
                  className={`px-2.5 py-1 rounded-full border ${
                    step === "individual"
                      ? "bg-emerald-500 text-slate-900 border-emerald-400"
                      : "bg-slate-900 text-slate-200 border-slate-700"
                  }`}
                >
                  2. Ajustes por Pokémon
                </button>
                <button
                  type="button"
                  onClick={() => setStep("general")}
                  className={`px-2.5 py-1 rounded-full border ${
                    step === "general"
                      ? "bg-emerald-500 text-slate-900 border-emerald-400"
                      : "bg-slate-900 text-slate-200 border-slate-700"
                  }`}
                >
                  3. Aplicar em massa
                </button>
              </div>

              {/* STEP 1: Modo */}
              {step === "mode" && (
                <div className="space-y-3">
                  <p className="text-xs text-slate-300">
                    Escolha como você deseja configurar as capturas dos
                    Pokémon marcados.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setStep("individual")}
                      className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-3 text-left hover:border-emerald-500/70 hover:bg-slate-900"
                    >
                      <h3 className="text-[13px] font-semibold text-white mb-1">
                        Configurar individualmente
                      </h3>
                      <p className="text-[11px] text-slate-300">
                        Ajuste nível, taxas de encontro, limite de capturas e
                        modos especiais para cada Pokémon marcado.
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setStep("general")}
                      className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-3 text-left hover:border-emerald-500/70 hover:bg-slate-900"
                    >
                      <h3 className="text-[13px] font-semibold text-white mb-1">
                        Aplicar configuração geral
                      </h3>
                      <p className="text-[11px] text-slate-300">
                        Define um padrão de método, taxa de encontro e limite
                        de capturas para todos os Pokémon marcados de uma vez.
                      </p>
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 2: Individual */}
              {step === "individual" && (
                <div className="space-y-4">
                  {speciesList.map((pk) => {
                    const cfg = pk.config;
                    return (
                      <details
                        key={pk.id}
                        className="rounded-lg border border-slate-800 bg-slate-900/70"
                      >
                        <summary className="flex items-center justify-between gap-2 px-3 py-2 cursor-pointer select-none">
                          <div>
                            <div className="text-[13px] font-semibold text-white">
                              #{pk.id} {pk.name}
                            </div>
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {pk.types?.map((t) => (
                                <span
                                  key={t}
                                  className="px-2 py-0.5 rounded-full bg-slate-800 text-[10px]"
                                >
                                  {typeLabel(t)}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            {cfg.isSpecial && (
                              <span className="rounded-full bg-amber-500/20 text-amber-300 text-[11px] px-2 py-0.5">
                                Especial
                                {cfg.specialCount != null
                                  ? ` (${cfg.specialCount})`
                                  : ""}
                              </span>
                            )}
                            <span className="text-[11px] text-slate-400">
                              Limite:{" "}
                              {cfg.unlimitedCaptures ||
                              cfg.captureLimit == null
                                ? "Ilimitado"
                                : cfg.captureLimit}
                            </span>
                            <span className="text-[11px] text-slate-400">
                              Método: {captureMethodLabel[cfg.method]}
                            </span>
                            <span className="text-[11px] text-slate-500">
                              Clique para expandir
                            </span>
                          </div>
                        </summary>

                        <div className="border-t border-slate-800 px-3 py-3 space-y-3 text-[12px]">
                          {/* Flag Especial */}
                          <div className="flex items-center justify-between gap-2">
                            <label className="inline-flex items-center gap-2 text-xs text-slate-200">
                              <input
                                type="checkbox"
                                checked={cfg.isSpecial}
                                onChange={(e) =>
                                  updateConfig(pk.id, {
                                    isSpecial: e.target.checked,
                                  })
                                }
                                className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-900"
                              />
                              <span>Configuração especial</span>
                            </label>
                            <span className="text-[11px] text-slate-400">
                              Níveis: {cfg.minLevel ?? 1} - {cfg.maxLevel ?? 100}
                            </span>
                          </div>

                          {/* Método / níveis / taxas */}
                          <div className="grid gap-2 md:grid-cols-4">
                            <div>
                              <label className="block text-[11px] text-slate-400 mb-1">
                                Método de encontro
                              </label>
                              <select
                                value={cfg.method}
                                onChange={(e) =>
                                  updateConfig(pk.id, {
                                    method: e.target.value as CaptureMethod,
                                  })
                                }
                                className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-xs"
                              >
                                {Object.entries(captureMethodLabel).map(
                                  ([value, label]) => (
                                    <option key={value} value={value}>
                                      {label}
                                    </option>
                                  )
                                )}
                              </select>
                            </div>

                            <div>
                              <label className="block text-[11px] text-slate-400 mb-1">
                                Nível Mínimo
                              </label>
                              <input
                                type="number"
                                min={1}
                                max={100}
                                className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-xs"
                                value={cfg.minLevel ?? ""}
                                onChange={(e) =>
                                  updateConfig(pk.id, {
                                    minLevel:
                                      e.target.value === ""
                                        ? null
                                        : Number(e.target.value),
                                  })
                                }
                              />
                            </div>

                            <div>
                              <label className="block text-[11px] text-slate-400 mb-1">
                                Nível Máximo
                              </label>
                              <input
                                type="number"
                                min={1}
                                max={100}
                                className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-xs"
                                value={cfg.maxLevel ?? ""}
                                onChange={(e) =>
                                  updateConfig(pk.id, {
                                    maxLevel:
                                      e.target.value === ""
                                        ? null
                                        : Number(e.target.value),
                                  })
                                }
                              />
                            </div>

                            <div>
                              <label className="block text-[11px] text-slate-400 mb-1">
                                Chance de aparecer (%)
                              </label>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-xs"
                                value={cfg.encounterRate ?? ""}
                                onChange={(e) =>
                                  updateConfig(pk.id, {
                                    encounterRate:
                                      e.target.value === ""
                                        ? null
                                        : Number(e.target.value),
                                  })
                                }
                              />
                            </div>
                          </div>

                          <div className="grid gap-2 md:grid-cols-3">
                            <div>
                              <label className="block text-[11px] text-slate-400 mb-1">
                                Limite de capturas
                              </label>
                              <div className="flex items-center gap-2">
                                <input
                                  type="number"
                                  min={1}
                                  className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-xs"
                                  value={cfg.captureLimit ?? ""}
                                  disabled={cfg.unlimitedCaptures}
                                  onChange={(e) =>
                                    updateConfig(pk.id, {
                                      captureLimit:
                                        e.target.value === ""
                                          ? null
                                          : Number(e.target.value),
                                    })
                                  }
                                />
                                <label className="inline-flex items-center gap-1 text-[11px] text-slate-300 whitespace-nowrap">
                                  <input
                                    type="checkbox"
                                    checked={cfg.unlimitedCaptures}
                                    onChange={(e) =>
                                      updateConfig(pk.id, {
                                        unlimitedCaptures: e.target.checked,
                                      })
                                    }
                                    className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-900"
                                  />
                                  Ilimitado
                                </label>
                              </div>
                              {cfg.isSpecial &&
                                !cfg.unlimitedCaptures &&
                                cfg.captureLimit != null && (
                                  <p className="mt-1 text-[10px] text-slate-500">
                                    Especiais configurados:{" "}
                                    {cfg.specialCount ?? 0} de no máximo{" "}
                                    {cfg.captureLimit}.
                                  </p>
                                )}
                            </div>

                            <div>
                              <label className="block text-[11px] text-slate-400 mb-1">
                                Chance de Shiny (%)
                              </label>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                step={0.01}
                                className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-xs"
                                value={cfg.shinyRate ?? ""}
                                onChange={(e) =>
                                  updateConfig(pk.id, {
                                    shinyRate:
                                      e.target.value === ""
                                        ? null
                                        : Number(e.target.value),
                                  })
                                }
                              />
                            </div>

                            <div>
                              <label className="block text-[11px] text-slate-400 mb-1">
                                Tipos customizados (modo especial)
                              </label>
                              {cfg.isSpecial ? (
                                <>
                                  <p className="text-[10px] text-slate-400 mb-1">
                                    Opção avançada: redefinir os tipos desta
                                    espécie apenas para encontros configurados
                                    aqui.
                                  </p>
                                  <div className="flex flex-wrap gap-1">
                                    {ALL_TYPES.map((t) => {
                                      const active =
                                        cfg.customTypes.includes(t);
                                      return (
                                        <button
                                          key={t}
                                          type="button"
                                          onClick={() =>
                                            toggleCustomType(pk.id, t)
                                          }
                                          className={`px-2 py-0.5 rounded-full text-[10px] border ${
                                            active
                                              ? "bg-amber-500/20 text-amber-200 border-amber-400/70"
                                              : "bg-slate-900 text-slate-200 border-slate-700 hover:bg-slate-800"
                                          }`}
                                        >
                                          {typeLabel(t)}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </>
                              ) : (
                                <p className="text-[11px] text-slate-400">
                                  Usando tipos oficiais da espécie:{" "}
                                  {pk.types
                                    ?.map((t) => typeLabel(t))
                                    .join(" / ") || "—"}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Config especial */}
                          {cfg.isSpecial && (
                            <div className="space-y-3 border-t border-slate-800 pt-3 mt-1">
                              <div className="grid gap-2 md:grid-cols-3">
                                <div>
                                  <label className="block text-[11px] text-slate-400 mb-1">
                                    Quantidade de versões especiais
                                  </label>
                                  <input
                                    type="number"
                                    min={1}
                                    className="w-full rounded-md bg-slate-900 border border-amber-500/60 px-2 py-1 text-xs text-amber-100"
                                    value={cfg.specialCount ?? ""}
                                    onChange={(e) =>
                                      updateConfig(pk.id, {
                                        specialCount:
                                          e.target.value === ""
                                            ? null
                                            : Number(e.target.value),
                                      })
                                    }
                                  />
                                </div>
                              </div>

                              <div>
                                <label className="block text-[11px] text-slate-400 mb-1">
                                  Golpes especiais (até 4)
                                </label>
                                <div className="space-y-2">
                                  {cfg.specialMoves.map((moveId, slotIndex) => {
                                    const move = moveId
                                      ? movesById.get(moveId)
                                      : undefined;
                                    return (
                                      <div
                                        key={slotIndex}
                                        className="flex flex-col gap-1 sm:flex-row sm:items-center"
                                      >
                                        <div className="flex-1">
                                          <select
                                            className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-xs"
                                            value={moveId ?? ""}
                                            onChange={(e) =>
                                              setSpecialMove(
                                                pk.id,
                                                slotIndex,
                                                e.target.value || null
                                              )
                                            }
                                          >
                                            <option value="">
                                              (sem golpe definido)
                                            </option>
                                            {moves.map((m) => (
                                              <option
                                                key={m.id}
                                                value={m.id}
                                              >
                                                {formatMoveName(m.name)}
                                              </option>
                                            ))}
                                          </select>
                                        </div>

                                        <div className="text-[11px] text-slate-400 sm:flex-1">
                                          {move ? (
                                            <span>
                                              {formatMoveSummary(move)}
                                            </span>
                                          ) : (
                                            <span className="text-slate-500">
                                              Escolha um golpe para este slot
                                              especial.
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                                {movesLoading && (
                                  <p className="text-[10px] text-slate-400 mt-1">
                                    Carregando golpes em memória...
                                  </p>
                                )}
                                {!movesLoading && moves.length === 0 && (
                                  <p className="text-[10px] text-slate-400 mt-1">
                                    Nenhum golpe carregado ainda. Assim que
                                    houver Pokémon especial configurado, o
                                    catálogo será carregado do JSON.
                                  </p>
                                )}
                              </div>

                              {/* EVs / IVs especiais */}
                              <div className="grid gap-3 md:grid-cols-2">
                                <div>
                                  <div className="text-[11px] text-slate-300 mb-1">
                                    EVs especiais
                                  </div>
                                  <div className="grid grid-cols-3 gap-1">
                                    {(
                                      [
                                        "hp",
                                        "attack",
                                        "defense",
                                        "specialAttack",
                                        "specialDefense",
                                        "speed",
                                      ] as StatKey[]
                                    ).map((stat) => (
                                      <div
                                        key={stat}
                                        className="space-y-0.5"
                                      >
                                        <label className="block text-[9px] text-slate-400">
                                          {STAT_LABEL[stat]}
                                        </label>
                                        <input
                                          type="number"
                                          min={0}
                                          max={252}
                                          className="w-full rounded-md bg-slate-900 border border-slate-700 px-1.5 py-0.5 text-[10px]"
                                          value={cfg.evs?.[stat] ?? ""}
                                          onChange={(e) =>
                                            updateConfigStat(
                                              pk.id,
                                              "evs",
                                              stat,
                                              clampNumber(
                                                e.target.value
                                                  ? Number(e.target.value)
                                                  : null,
                                                0,
                                                252
                                              )
                                            )
                                          }
                                        />
                                      </div>
                                    ))}
                                  </div>
                                </div>

                                <div>
                                  <div className="text-[11px] text-slate-300 mb-1">
                                    IVs especiais
                                  </div>
                                  <div className="grid grid-cols-3 gap-1">
                                    {(
                                      [
                                        "hp",
                                        "attack",
                                        "defense",
                                        "specialAttack",
                                        "specialDefense",
                                        "speed",
                                      ] as StatKey[]
                                    ).map((stat) => (
                                      <div
                                        key={stat}
                                        className="space-y-0.5"
                                      >
                                        <label className="block text-[9px] text-slate-400">
                                          {STAT_LABEL[stat]}
                                        </label>
                                        <input
                                          type="number"
                                          min={0}
                                          max={31}
                                          className="w-full rounded-md bg-slate-900 border border-slate-700 px-1.5 py-0.5 text-[10px]"
                                          value={cfg.ivs?.[stat] ?? ""}
                                          onChange={(e) =>
                                            updateConfigStat(
                                              pk.id,
                                              "ivs",
                                              stat,
                                              clampNumber(
                                                e.target.value
                                                  ? Number(e.target.value)
                                                  : null,
                                                0,
                                                31
                                              )
                                            )
                                          }
                                        />
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </details>
                    );
                  })}
                </div>
              )}

              {/* STEP 3: Geral */}
              {step === "general" && (
                <div className="space-y-3">
                  <p className="text-xs text-slate-300">
                    Defina um padrão geral de método, taxa de encontro e
                    limite de capturas para os Pokémon marcados. Você ainda
                    pode ajustar individualmente depois.
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">
                        Método de encontro (padrão)
                      </label>
                      <select
                        value={generalConfig.method}
                        onChange={(e) =>
                          setGeneralConfig((prev) => ({
                            ...prev,
                            method: e.target.value as CaptureMethod,
                          }))
                        }
                        className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-xs"
                      >
                        {Object.entries(captureMethodLabel).map(
                          ([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          )
                        )}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">
                        Taxa de encontro (%) padrão
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-xs"
                        value={generalConfig.encounterRate ?? ""}
                        onChange={(e) =>
                          setGeneralConfig((prev) => ({
                            ...prev,
                            encounterRate: clampNumber(
                              e.target.value
                                ? Number(e.target.value)
                                : null,
                              1,
                              100
                            ),
                          }))
                        }
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">
                        Chance de Shiny (%) padrão
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.01}
                        className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-xs"
                        value={generalConfig.shinyRate ?? ""}
                        onChange={(e) =>
                          setGeneralConfig((prev) => ({
                            ...prev,
                            shinyRate: clampNumber(
                              e.target.value
                                ? Number(e.target.value)
                                : null,
                              0,
                              100
                            ),
                          }))
                        }
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">
                        Limite de capturas padrão
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          disabled={generalConfig.unlimitedCaptures}
                          className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-xs"
                          value={generalConfig.captureLimit ?? ""}
                          onChange={(e) =>
                            setGeneralConfig((prev) => ({
                              ...prev,
                              captureLimit: clampNumber(
                                e.target.value
                                  ? Number(e.target.value)
                                  : null,
                                1,
                                9999
                              ),
                            }))
                          }
                        />
                        <label className="inline-flex items-center gap-1 text-[11px] text-slate-300 whitespace-nowrap">
                          <input
                            type="checkbox"
                            checked={generalConfig.unlimitedCaptures}
                            onChange={(e) =>
                              setGeneralConfig((prev) => ({
                                ...prev,
                                unlimitedCaptures: e.target.checked,
                              }))
                            }
                            className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-900"
                          />
                          Ilimitado
                        </label>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={applyGeneralToAll}
                    className="mt-2 rounded-md bg-emerald-500 px-3 py-1.5 text-[11px] font-semibold text-slate-900 hover:bg-emerald-400"
                  >
                    Aplicar estes valores para todos os Pokémon marcados
                  </button>

                  {anySpecial && (
                    <p className="mt-2 text-[10px] text-amber-300">
                      Atenção: as configurações <strong>especiais</strong> de
                      cada Pokémon (golpes, EVs, IVs, tipos personalizados) não
                      são alteradas pelo modo geral.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Rodapé */}
        <div className="px-5 py-3 border-t border-slate-800 flex items-center justify-between text-[11px] bg-slate-900/80">
          <span className="text-slate-300">
            <strong>{markedCount}</strong> Pokémon marcados para captura
            nesta versão.
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-md border border-slate-700 text-xs text-slate-200 hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white"
            >
              Salvar configurações
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
