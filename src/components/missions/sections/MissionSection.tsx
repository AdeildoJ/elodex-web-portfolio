"use client";

import {
  Direcionamento,
  MissionPhase,
  PhaseObjective,
} from "@/lib/missions/missionsTypes";
import RewardEditor from "../inputs/RewardEditor";
import JsonItemSearch from "../inputs/JsonItemSearch";
import JsonPokemonSearch from "../inputs/JsonPokemonSearch";
import NpcUploader from "../inputs/NpcUploader";

type Props = {
  direcionamento: Direcionamento;
  fases: MissionPhase[];
  onAddPhase: () => void;
  onRemoveLastPhase: () => void;
  onUpdatePhase: (indice: number, patch: Partial<MissionPhase>) => void;
};

function asItem(obj: PhaseObjective) {
  return obj.tipo === "ITEM" ? obj : null;
}
function asPokemon(obj: PhaseObjective) {
  return obj.tipo === "POKEMON" ? obj : null;
}
function asPvp(obj: PhaseObjective) {
  return obj.tipo === "PVP" ? obj : null;
}

export default function MissionSection({
  direcionamento,
  fases,
  onAddPhase,
  onRemoveLastPhase,
  onUpdatePhase,
}: Props) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-white">Fases da Missão</h4>
          <p className="text-[11px] text-slate-400">
            Missões sempre possuem fases sequenciais. Não existe pular fase.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={onRemoveLastPhase}
            className="px-3 py-2 rounded-md text-xs font-semibold bg-slate-800 text-slate-100 hover:bg-slate-700 transition"
          >
            - Remover última
          </button>
          <button
            onClick={onAddPhase}
            className="px-3 py-2 rounded-md text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-500 transition"
          >
            + Adicionar fase
          </button>
        </div>
      </div>

      <div className="mt-4 space-y-4">
        {fases.map((fase) => {
          const itemObj = asItem(fase.objetivo);
          const pokemonObj = asPokemon(fase.objetivo);
          const pvpObj = asPvp(fase.objetivo);

          return (
            <div
              key={fase.indice}
              className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"
            >
              <div className="flex items-center justify-between">
                <h5 className="text-sm font-semibold text-white">
                  Fase {fase.indice}
                </h5>

                <span className="text-[10px] uppercase tracking-wider text-slate-400">
                  Objetivo • Recompensa • NPC • Diálogos
                </span>
              </div>

              {/* OBJETIVO */}
              <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-[11px] text-slate-300">OBJETIVO</label>
                  <select
                    value={fase.objetivo.tipo}
                    onChange={(e) => {
                      const tipo = e.target.value as PhaseObjective["tipo"];

                      if (tipo === "ITEM") {
                        onUpdatePhase(fase.indice, {
                          objetivo: { tipo: "ITEM", itemId: "" },
                        });
                        return;
                      }

                      if (tipo === "POKEMON") {
                        onUpdatePhase(fase.indice, {
                          objetivo: {
                            tipo: "POKEMON",
                            pokemonId: 0,
                            acao: "CAPTURAR",
                          },
                        });
                        return;
                      }

                      onUpdatePhase(fase.indice, {
                        objetivo: {
                          tipo: "PVP",
                          quantidadeVitorias: 1,
                          permiteRoubo: false,
                        },
                      });
                    }}
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm outline-none"
                  >
                    <option value="ITEM">ITEM</option>
                    <option value="POKEMON">POKÉMON</option>
                    <option value="PVP">PvP</option>
                  </select>
                </div>

                {itemObj && (
                  <div className="md:col-span-2">
                    <label className="text-[11px] text-slate-300">
                      ITEM (buscar no JSON)
                    </label>
                    <div className="mt-1">
                      <JsonItemSearch
                        value={itemObj.itemId}
                        onChange={(itemId) =>
                          onUpdatePhase(fase.indice, {
                            objetivo: { tipo: "ITEM", itemId },
                          })
                        }
                      />
                    </div>
                  </div>
                )}

                {pokemonObj && (
                  <>
                    <div>
                      <label className="text-[11px] text-slate-300">AÇÃO</label>
                      <select
                        value={pokemonObj.acao}
                        onChange={(e) =>
                          onUpdatePhase(fase.indice, {
                            objetivo: {
                              tipo: "POKEMON",
                              pokemonId: pokemonObj.pokemonId,
                              acao: e.target.value as "CAPTURAR" | "DERROTAR",
                            },
                          })
                        }
                        className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm outline-none"
                      >
                        <option value="CAPTURAR">Capturar</option>
                        <option value="DERROTAR">Derrotar</option>
                      </select>
                    </div>

                    <div className="md:col-span-2">
                      <label className="text-[11px] text-slate-300">
                        POKÉMON (JSON / fallback)
                      </label>
                      <div className="mt-1">
                        <JsonPokemonSearch
                          value={pokemonObj.pokemonId}
                          onChange={(pokemonId) =>
                            onUpdatePhase(fase.indice, {
                              objetivo: {
                                tipo: "POKEMON",
                                pokemonId,
                                acao: pokemonObj.acao,
                              },
                            })
                          }
                        />
                      </div>
                    </div>
                  </>
                )}

                {pvpObj && (
                  <>
                    <div>
                      <label className="text-[11px] text-slate-300">
                        VITÓRIAS NECESSÁRIAS
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={pvpObj.quantidadeVitorias}
                        onChange={(e) =>
                          onUpdatePhase(fase.indice, {
                            objetivo: {
                              tipo: "PVP",
                              quantidadeVitorias: Number(e.target.value || 0),
                              permiteRoubo: pvpObj.permiteRoubo,
                            },
                          })
                        }
                        className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm outline-none"
                      />
                    </div>

                    {direcionamento === "LADRAO" ? (
                      <div className="md:col-span-2 flex items-center gap-2 mt-6">
                        <input
                          id={`roubo-${fase.indice}`}
                          type="checkbox"
                          checked={pvpObj.permiteRoubo}
                          onChange={(e) =>
                            onUpdatePhase(fase.indice, {
                              objetivo: {
                                tipo: "PVP",
                                quantidadeVitorias: pvpObj.quantidadeVitorias,
                                permiteRoubo: e.target.checked,
                              },
                            })
                          }
                          className="h-4 w-4"
                        />
                        <label
                          htmlFor={`roubo-${fase.indice}`}
                          className="text-sm text-slate-200"
                        >
                          Permite roubo (apenas autoriza; não configura lógica do roubo)
                        </label>
                      </div>
                    ) : (
                      <div className="md:col-span-2 mt-6 text-[11px] text-slate-400">
                        Roubo só existe para direcionamento <b>LADRÃO</b>.
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* RECOMPENSAS */}
              <div className="mt-4">
                <RewardEditor
                  value={fase.recompensas}
                  onChange={(recompensas) =>
                    onUpdatePhase(fase.indice, { recompensas })
                  }
                />
              </div>

              {/* HISTÓRIA + NPC */}
              <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-3">
                <div className="lg:col-span-2">
                  <label className="text-[11px] text-slate-300">
                    HISTÓRIA DA FASE (obrigatória)
                  </label>
                  <textarea
                    value={fase.historia.texto}
                    onChange={(e) =>
                      onUpdatePhase(fase.indice, {
                        historia: { ...fase.historia, texto: e.target.value },
                      })
                    }
                    className="mt-1 w-full min-h-[110px] rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm outline-none"
                    placeholder="Narração completa da fase..."
                  />
                </div>

                <div>
                  <label className="text-[11px] text-slate-300">
                    NPC (upload obrigatório)
                  </label>
                  <div className="mt-1">
                    <NpcUploader
                      value={fase.historia.npc.imagemUrl}
                      onChange={(url) =>
                        onUpdatePhase(fase.indice, {
                          historia: {
                            ...fase.historia,
                            npc: { imagemUrl: url },
                          },
                        })
                      }
                      storagePathHint={`missionsEvents/npcs/FASE-${fase.indice}`}
                    />
                  </div>
                </div>
              </div>

              {/* DIÁLOGOS */}
              <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                <h6 className="text-sm font-semibold text-white">Diálogos</h6>

                <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-slate-300">
                      Quantidade total de falas
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={fase.historia.dialogos.quantidadeFalas}
                      onChange={(e) =>
                        onUpdatePhase(fase.indice, {
                          historia: {
                            ...fase.historia,
                            dialogos: {
                              ...fase.historia.dialogos,
                              quantidadeFalas: Number(e.target.value || 0),
                            },
                          },
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm outline-none"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] text-slate-300">
                      Quantidade de balões
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={fase.historia.dialogos.quantidadeBaloes}
                      onChange={(e) => {
                        const qtd = Math.max(1, Number(e.target.value || 1));
                        const current = fase.historia.dialogos.baloes;
                        const next = Array.from({ length: qtd }).map((_, i) => ({
                          ordem: i + 1,
                          texto: current[i]?.texto ?? "",
                        }));

                        onUpdatePhase(fase.indice, {
                          historia: {
                            ...fase.historia,
                            dialogos: {
                              ...fase.historia.dialogos,
                              quantidadeBaloes: qtd,
                              baloes: next,
                            },
                          },
                        });
                      }}
                      className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm outline-none"
                    />
                  </div>
                </div>

                <div className="mt-3 space-y-2">
                  {fase.historia.dialogos.baloes.map((b) => (
                    <div key={b.ordem}>
                      <label className="text-[11px] text-slate-300">
                        Balão {b.ordem}
                      </label>
                      <textarea
                        value={b.texto}
                        onChange={(e) => {
                          const next = fase.historia.dialogos.baloes.map((x) =>
                            x.ordem === b.ordem
                              ? { ...x, texto: e.target.value }
                              : x
                          );

                          onUpdatePhase(fase.indice, {
                            historia: {
                              ...fase.historia,
                              dialogos: {
                                ...fase.historia.dialogos,
                                baloes: next,
                              },
                            },
                          });
                        }}
                        className="mt-1 w-full min-h-[70px] rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm outline-none"
                        placeholder="Texto do balão..."
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
