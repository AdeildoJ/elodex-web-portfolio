"use client";

import { useMemo } from "react";
import {
  Direcionamento,
  EventConfig,
  EventReward,
  EventCaptureTarget,
  EventCaptureMilestone,
  EventPvpMilestone,
} from "@/lib/missions/missionsTypes";
import JsonPokemonSearch from "../inputs/JsonPokemonSearch";
import JsonItemSearch from "../inputs/JsonItemSearch";

type Props = {
  direcionamento: Direcionamento;
  value: EventConfig;
  onChange: (next: EventConfig) => void;
};

// ✅ padrões tipados (impede "tipo: string")
const DEFAULT_ECOIN_REWARD: EventReward = { tipo: "ECOIN", quantidade: 1 };

const makeDefaultCaptureMilestone = (): EventCaptureMilestone => ({
  quantidadeMarco: 1,
  premio: { ...DEFAULT_ECOIN_REWARD },
});

const makeDefaultCaptureTarget = (): EventCaptureTarget => ({
  pokemonId: 0,
  quantidadeNecessaria: 1,
  marcos: [makeDefaultCaptureMilestone()],
});

const makeDefaultPvpMilestone = (): EventPvpMilestone => ({
  quantidadeVitorias: 1,
  premio: { ...DEFAULT_ECOIN_REWARD },
});

function RewardEditor({
  value,
  onChange,
}: {
  value: EventReward;
  onChange: (v: EventReward) => void;
}) {
  const tipo = value.tipo;

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="text-[11px] text-slate-300">Prêmio</label>
          <select
            value={tipo}
            onChange={(e) => {
              const t = e.target.value as EventReward["tipo"];
              if (t === "POKEMON") onChange({ tipo: "POKEMON", pokemonId: 0 });
              if (t === "ITEM") onChange({ tipo: "ITEM", itemId: "", quantidade: 1 });
              if (t === "ECOIN") onChange({ tipo: "ECOIN", quantidade: 1 });
            }}
            className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm outline-none"
          >
            <option value="POKEMON">Pokémon</option>
            <option value="ITEM">Item</option>
            <option value="ECOIN">Ecoin</option>
          </select>
        </div>

        {tipo === "POKEMON" && (
          <div className="md:col-span-2">
            <label className="text-[11px] text-slate-300">Pokémon (JSON)</label>
            <div className="mt-1">
              <JsonPokemonSearch
                value={value.pokemonId}
                onChange={(pokemonId) => onChange({ tipo: "POKEMON", pokemonId })}
              />
            </div>
          </div>
        )}

        {tipo === "ITEM" && (
          <>
            <div className="md:col-span-2">
              <label className="text-[11px] text-slate-300">Item (JSON)</label>
              <div className="mt-1">
                <JsonItemSearch
                  value={value.itemId}
                  onChange={(itemId) =>
                    onChange({ tipo: "ITEM", itemId, quantidade: value.quantidade || 1 })
                  }
                />
              </div>
            </div>
            <div>
              <label className="text-[11px] text-slate-300">Quantidade</label>
              <input
                type="number"
                min={1}
                value={value.quantidade}
                onChange={(e) =>
                  onChange({
                    tipo: "ITEM",
                    itemId: value.itemId,
                    quantidade: Number(e.target.value || 1),
                  })
                }
                className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm outline-none"
              />
            </div>
          </>
        )}

        {tipo === "ECOIN" && (
          <div className="md:col-span-2">
            <label className="text-[11px] text-slate-300">Quantidade (Ecoin)</label>
            <input
              type="number"
              min={1}
              value={value.quantidade}
              onChange={(e) =>
                onChange({ tipo: "ECOIN", quantidade: Number(e.target.value || 1) })
              }
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm outline-none"
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default function EventSection({ direcionamento, value, onChange }: Props) {
  const isPvp = value.tipoEvento === "PVP";

  const showRoubo = useMemo(() => {
    return direcionamento === "LADRAO" && value.tipoEvento === "PVP";
  }, [direcionamento, value.tipoEvento]);

  function setTipoEvento(next: "CAPTURA" | "PVP") {
    if (next === "CAPTURA") {
      onChange({
        tipoEvento: "CAPTURA",
        dataInicio: value.dataInicio,
        dataFim: value.dataFim,
        objetivos: [],
      });
    } else {
      onChange({
        tipoEvento: "PVP",
        dataInicio: value.dataInicio,
        dataFim: value.dataFim,
        quantidadeVitoriasNecessarias: 1,
        marcos: [],
        permiteRoubo: false, // ✅ padrão seguro; UI decide quando LADRAO marcar
      });
    }
  }

  function setPermiteRouboSafe(checked: boolean) {
    if (direcionamento !== "LADRAO") return;
    if (value.tipoEvento !== "PVP") return;
    onChange({ ...value, permiteRoubo: checked });
  }

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
      <h4 className="text-sm font-semibold text-white">Configuração do Evento</h4>

      {/* Datas */}
      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] text-slate-300">Data Início (obrigatório)</label>
          <input
            type="date"
            value={value.dataInicio}
            onChange={(e) => onChange({ ...value, dataInicio: e.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm outline-none"
          />
        </div>

        <div>
          <label className="text-[11px] text-slate-300">Data Fim (obrigatório)</label>
          <input
            type="date"
            value={value.dataFim}
            onChange={(e) => onChange({ ...value, dataFim: e.target.value })}
            className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm outline-none"
          />
          <p className="text-[10px] text-slate-400 mt-1">
            O evento encerra automaticamente às 23:59 da data final.
          </p>
        </div>
      </div>

      {/* Tipo */}
      <div className="mt-4">
        <label className="text-[11px] text-slate-300">Tipo do Evento</label>
        <select
          value={value.tipoEvento}
          onChange={(e) => setTipoEvento(e.target.value as any)}
          className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm outline-none"
        >
          <option value="CAPTURA">CAPTURA</option>
          <option value="PVP">PvP</option>
        </select>
      </div>

      {/* PvP: Permite roubo */}
      {isPvp && (
        <div className="mt-4">
          {showRoubo ? (
            <label className="flex items-center gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={value.tipoEvento === "PVP" ? value.permiteRoubo : false}
                onChange={(e) => setPermiteRouboSafe(e.target.checked)}
                className="h-4 w-4"
              />
              Permite roubo
            </label>
          ) : (
            <div className="text-[11px] text-slate-400">
              Permite roubo só aparece para direcionamento <b>LADRÃO</b>. (TREINADOR salva false)
            </div>
          )}
        </div>
      )}

      {/* CAPTURA */}
      {value.tipoEvento === "CAPTURA" && (
        <div className="mt-5">
          <div className="flex items-center justify-between">
            <h5 className="text-sm font-semibold text-white">Objetivos (CAPTURA)</h5>
            <button
              type="button"
              onClick={() => {
                onChange({
                  ...value,
                  objetivos: [...value.objetivos, makeDefaultCaptureTarget()],
                });
              }}
              className="px-3 py-2 rounded-md text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-500 transition"
            >
              + Adicionar Pokémon
            </button>
          </div>

          <div className="mt-3 space-y-3">
            {value.objetivos.map((obj, idx) => (
              <div key={idx} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-semibold text-white">Pokémon #{idx + 1}</div>
                  <button
                    type="button"
                    onClick={() => {
                      const next = value.objetivos.filter((_, i) => i !== idx);
                      onChange({ ...value, objetivos: next });
                    }}
                    className="px-3 py-2 rounded-md text-xs font-semibold bg-red-600/80 text-white hover:bg-red-600 transition"
                  >
                    Remover
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="md:col-span-2">
                    <label className="text-[11px] text-slate-300">Pokémon (JSON)</label>
                    <div className="mt-1">
                      <JsonPokemonSearch
                        value={obj.pokemonId}
                        onChange={(pokemonId) => {
                          const next = value.objetivos.map((o, i) =>
                            i === idx ? { ...o, pokemonId } : o
                          );
                          onChange({ ...value, objetivos: next });
                        }}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] text-slate-300">Quantidade necessária</label>
                    <input
                      type="number"
                      min={1}
                      value={obj.quantidadeNecessaria}
                      onChange={(e) => {
                        const q = Number(e.target.value || 1);
                        const next = value.objetivos.map((o, i) =>
                          i === idx ? { ...o, quantidadeNecessaria: q } : o
                        );
                        onChange({ ...value, objetivos: next });
                      }}
                      className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm outline-none"
                    />
                  </div>
                </div>

                {/* Marcos */}
                <div className="mt-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-white">Marcos</div>
                    <button
                      type="button"
                      onClick={() => {
                        const next = value.objetivos.map((o, i) => {
                          if (i !== idx) return o;
                          return { ...o, marcos: [...o.marcos, makeDefaultCaptureMilestone()] };
                        });
                        onChange({ ...value, objetivos: next });
                      }}
                      className="px-3 py-2 rounded-md text-xs font-semibold bg-slate-800 text-slate-100 hover:bg-slate-700 transition"
                    >
                      + Adicionar Marco
                    </button>
                  </div>

                  <div className="mt-2 space-y-3">
                    {obj.marcos.map((m, mi) => (
                      <div key={mi} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-semibold text-white">Marco #{mi + 1}</div>
                          <button
                            type="button"
                            onClick={() => {
                              const next = value.objetivos.map((o, i) => {
                                if (i !== idx) return o;
                                return { ...o, marcos: o.marcos.filter((_, j) => j !== mi) };
                              });
                              onChange({ ...value, objetivos: next });
                            }}
                            className="px-3 py-2 rounded-md text-xs font-semibold bg-red-600/80 text-white hover:bg-red-600 transition"
                          >
                            Remover
                          </button>
                        </div>

                        <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div>
                            <label className="text-[11px] text-slate-300">Quantidade do marco</label>
                            <input
                              type="number"
                              min={1}
                              value={m.quantidadeMarco}
                              onChange={(e) => {
                                const q = Number(e.target.value || 1);
                                const next = value.objetivos.map((o, i) => {
                                  if (i !== idx) return o;
                                  return {
                                    ...o,
                                    marcos: o.marcos.map((mm, j) =>
                                      j === mi ? { ...mm, quantidadeMarco: q } : mm
                                    ),
                                  };
                                });
                                onChange({ ...value, objetivos: next });
                              }}
                              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm outline-none"
                            />
                          </div>

                          <div className="md:col-span-2">
                            <label className="text-[11px] text-slate-300">Prêmio</label>
                            <div className="mt-1">
                              <RewardEditor
                                value={m.premio}
                                onChange={(premio) => {
                                  const next = value.objetivos.map((o, i) => {
                                    if (i !== idx) return o;
                                    return {
                                      ...o,
                                      marcos: o.marcos.map((mm, j) =>
                                        j === mi ? { ...mm, premio } : mm
                                      ),
                                    };
                                  });
                                  onChange({ ...value, objetivos: next });
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                    {obj.marcos.length === 0 && (
                      <div className="text-[11px] text-slate-400">Adicione pelo menos 1 marco.</div>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {value.objetivos.length === 0 && (
              <div className="text-[11px] text-slate-400">
                Adicione pelo menos 1 Pokémon objetivo.
              </div>
            )}
          </div>
        </div>
      )}

      {/* PVP */}
      {value.tipoEvento === "PVP" && (
        <div className="mt-5">
          <h5 className="text-sm font-semibold text-white">Objetivos (PvP)</h5>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] text-slate-300">Vitórias necessárias</label>
              <input
                type="number"
                min={1}
                value={value.quantidadeVitoriasNecessarias}
                onChange={(e) =>
                  onChange({
                    ...value,
                    quantidadeVitoriasNecessarias: Number(e.target.value || 1),
                    permiteRoubo: direcionamento === "LADRAO" ? value.permiteRoubo : false,
                  })
                }
                className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm outline-none"
              />
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <div className="text-sm font-semibold text-white">Marcos</div>
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...value,
                  marcos: [...value.marcos, makeDefaultPvpMilestone()],
                  permiteRoubo: direcionamento === "LADRAO" ? value.permiteRoubo : false,
                })
              }
              className="px-3 py-2 rounded-md text-xs font-semibold bg-slate-800 text-slate-100 hover:bg-slate-700 transition"
            >
              + Adicionar Marco
            </button>
          </div>

          <div className="mt-2 space-y-3">
            {value.marcos.map((m, idx) => (
              <div key={idx} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-white">Marco #{idx + 1}</div>
                  <button
                    type="button"
                    onClick={() =>
                      onChange({
                        ...value,
                        marcos: value.marcos.filter((_, i) => i !== idx),
                        permiteRoubo: direcionamento === "LADRAO" ? value.permiteRoubo : false,
                      })
                    }
                    className="px-3 py-2 rounded-md text-xs font-semibold bg-red-600/80 text-white hover:bg-red-600 transition"
                  >
                    Remover
                  </button>
                </div>

                <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="text-[11px] text-slate-300">Vitórias do marco</label>
                    <input
                      type="number"
                      min={1}
                      value={m.quantidadeVitorias}
                      onChange={(e) => {
                        const q = Number(e.target.value || 1);
                        const next = value.marcos.map((mm, i) =>
                          i === idx ? { ...mm, quantidadeVitorias: q } : mm
                        );
                        onChange({
                          ...value,
                          marcos: next,
                          permiteRoubo: direcionamento === "LADRAO" ? value.permiteRoubo : false,
                        });
                      }}
                      className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm outline-none"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="text-[11px] text-slate-300">Prêmio</label>
                    <div className="mt-1">
                      <RewardEditor
                        value={m.premio}
                        onChange={(premio) => {
                          const next = value.marcos.map((mm, i) =>
                            i === idx ? { ...mm, premio } : mm
                          );
                          onChange({
                            ...value,
                            marcos: next,
                            permiteRoubo: direcionamento === "LADRAO" ? value.permiteRoubo : false,
                          });
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {value.marcos.length === 0 && (
              <div className="text-[11px] text-slate-400">Adicione pelo menos 1 marco.</div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
