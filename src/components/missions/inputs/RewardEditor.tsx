"use client";

import { PhaseRewards, RewardKind } from "@/lib/missions/missionsTypes";
import JsonItemSearch from "./JsonItemSearch";
import JsonPokemonSearch from "./JsonPokemonSearch";

type Props = {
  value: PhaseRewards;
  onChange: (v: PhaseRewards) => void;
};

function toggle(arr: RewardKind[], k: RewardKind) {
  return arr.includes(k) ? arr.filter((x) => x !== k) : [...arr, k];
}

export default function RewardEditor({ value, onChange }: Props) {
  const tipos = value.tipos;

  function setTipos(next: RewardKind[]) {
    const v: PhaseRewards = { ...value, tipos: next };

    // Limpa detalhes quando desmarca o tipo (evita lixo)
    if (!next.includes("POKEMON")) delete v.pokemon;
    if (!next.includes("ITEM")) delete v.item;
    if (!next.includes("ECOIN")) delete v.ecoin;
    if (!next.includes("POKECOIN")) delete v.pokecoin;

    onChange(v);
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
      <h6 className="text-sm font-semibold text-white">Recompensas da Fase</h6>

      <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2">
        {(["POKEMON", "ITEM", "ECOIN", "POKECOIN"] as RewardKind[]).map((k) => (
          <label
            key={k}
            className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900/40 px-2 py-2 text-xs"
          >
            <input
              type="checkbox"
              checked={tipos.includes(k)}
              onChange={() => setTipos(toggle(tipos, k))}
              className="h-4 w-4"
            />
            <span className="text-slate-200 font-semibold">{k}</span>
          </label>
        ))}
      </div>

      {/* Detalhamento obrigatório */}
      <div className="mt-3 space-y-3">
        {tipos.includes("POKEMON") && (
          <div>
            <label className="text-[11px] text-slate-300">
              Recompensa Pokémon (JSON / fallback)
            </label>
            <div className="mt-1">
              <JsonPokemonSearch
                value={value.pokemon?.pokemonId ?? 0}
                onChange={(pokemonId) =>
                  onChange({ ...value, pokemon: { pokemonId } })
                }
              />
            </div>
          </div>
        )}

        {tipos.includes("ITEM") && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <label className="text-[11px] text-slate-300">
                Recompensa Item (JSON)
              </label>
              <div className="mt-1">
                <JsonItemSearch
                  value={value.item?.itemId ?? ""}
                  onChange={(itemId) =>
                    onChange({
                      ...value,
                      item: { itemId, quantidade: value.item?.quantidade ?? 1 },
                    })
                  }
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] text-slate-300">Quantidade</label>
              <input
                type="number"
                min={1}
                value={value.item?.quantidade ?? 1}
                onChange={(e) =>
                  onChange({
                    ...value,
                    item: {
                      itemId: value.item?.itemId ?? "",
                      quantidade: Number(e.target.value || 1),
                    },
                  })
                }
                className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm outline-none"
              />
            </div>
          </div>
        )}

        {tipos.includes("ECOIN") && (
          <div>
            <label className="text-[11px] text-slate-300">ECoin (valor numérico)</label>
            <input
              type="number"
              min={1}
              value={value.ecoin?.quantidade ?? ""}
              onChange={(e) =>
                onChange({ ...value, ecoin: { quantidade: Number(e.target.value || 0) } })
              }
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm outline-none"
            />
          </div>
        )}

        {tipos.includes("POKECOIN") && (
          <div>
            <label className="text-[11px] text-slate-300">Pokecoin (valor numérico)</label>
            <input
              type="number"
              min={1}
              value={value.pokecoin?.quantidade ?? ""}
              onChange={(e) =>
                onChange({ ...value, pokecoin: { quantidade: Number(e.target.value || 0) } })
              }
              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm outline-none"
            />
          </div>
        )}
      </div>
    </div>
  );
}
