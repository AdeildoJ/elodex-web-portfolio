"use client";

import { useMemo, useRef, useState } from "react";
import {
  Direcionamento,
  EventConfig,
  MissionEventDoc,
  MissionPhase,
  TipoDocumento,
} from "@/lib/missions/missionsTypes";

import MissionSection from "./sections/MissionSection";
import EventSection from "./sections/EventSection";

type Props = {
  mode: TipoDocumento; // "MISSAO" | "EVENTO"
  initial: MissionEventDoc | null;
  onCancel: () => void;
  onSubmit: (doc: MissionEventDoc) => void;
};

function makeEmptyPhase(indice: number): MissionPhase {
  return {
    indice,
    objetivo: { tipo: "ITEM", itemId: "" },
    recompensas: { tipos: [] },
    historia: {
      texto: "",
      npc: { imagemUrl: "" },
      dialogos: {
        quantidadeFalas: 1,
        quantidadeBaloes: 1,
        baloes: [{ ordem: 1, texto: "" }],
      },
    },
  };
}

function makeEmptyEvent(): EventConfig {
  return {
    tipoEvento: "CAPTURA",
    dataInicio: "",
    dataFim: "",
    objetivos: [],
  };
}

export default function MissionEventForm({ mode, initial, onCancel, onSubmit }: Props) {
  const [titulo, setTitulo] = useState(initial?.titulo ?? "");
  const [direcionamento, setDirecionamento] = useState<Direcionamento>(
    initial?.direcionamento ?? "TREINADOR"
  );
  const [descricaoGeral, setDescricaoGeral] = useState(initial?.descricaoGeral ?? "");
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);

  const [saveAttempted, setSaveAttempted] = useState(false);
  const errorsRef = useRef<HTMLDivElement | null>(null);

  // ==========================
  // MISSÃO
  // ==========================
  const [fases, setFases] = useState<MissionPhase[]>(
    initial?.missao?.fases?.length ? initial.missao.fases : [makeEmptyPhase(1)]
  );

  function addPhase() {
    setFases((prev) => [...prev, makeEmptyPhase(prev.length + 1)]);
  }

  function removeLastPhase() {
    setFases((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }

  function updatePhase(indice: number, patch: Partial<MissionPhase>) {
    setFases((prev) =>
      prev.map((f) => (f.indice === indice ? ({ ...f, ...patch } as MissionPhase) : f))
    );
  }

  // ==========================
  // EVENTO
  // ==========================
  const [evento, setEvento] = useState<EventConfig>(
    (initial?.evento as EventConfig) ?? makeEmptyEvent()
  );

  // Se direcionamento virar TREINADOR e evento for PVP, força permiteRoubo = false
  function setDirecionamentoSafe(next: Direcionamento) {
    setDirecionamento(next);

    setEvento((prev) => {
      if (prev.tipoEvento === "PVP" && next === "TREINADOR") {
        return { ...prev, permiteRoubo: false };
      }
      return prev;
    });

    // Para MISSÃO: se objetivo PVP e virou TREINADOR, também força permiteRoubo false
    setFases((prev) =>
      prev.map((f) => {
        if (f.objetivo.tipo === "PVP" && next === "TREINADOR") {
          return {
            ...f,
            objetivo: { ...f.objetivo, permiteRoubo: false },
          };
        }
        return f;
      })
    );
  }

  const errors = useMemo(() => {
    const e: string[] = [];
    if (!titulo.trim()) e.push("Título é obrigatório.");
    if (!descricaoGeral.trim())
      e.push(mode === "EVENTO" ? "Descrição do evento é obrigatória." : "Descrição geral é obrigatória.");

    if (mode === "EVENTO") {
      if (!evento.dataInicio) e.push("Evento: Data Início é obrigatória.");
      if (!evento.dataFim) e.push("Evento: Data Fim é obrigatória.");

      if (evento.tipoEvento === "CAPTURA") {
        if (!evento.objetivos.length) e.push("Evento CAPTURA: adicione pelo menos 1 Pokémon objetivo.");

        for (const obj of evento.objetivos) {
          if (!obj.pokemonId || obj.pokemonId <= 0) e.push("Evento CAPTURA: Pokémon objetivo inválido.");
          if (!obj.quantidadeNecessaria || obj.quantidadeNecessaria <= 0)
            e.push("Evento CAPTURA: quantidade necessária inválida.");
          if (!obj.marcos.length) e.push("Evento CAPTURA: cada Pokémon deve ter pelo menos 1 marco.");

          for (const m of obj.marcos) {
            if (!m.quantidadeMarco || m.quantidadeMarco <= 0)
              e.push("Evento CAPTURA: marco com quantidade inválida.");
            if (!m.premio) e.push("Evento CAPTURA: marco sem prêmio.");
          }
        }
      }

      if (evento.tipoEvento === "PVP") {
        if (!evento.quantidadeVitoriasNecessarias || evento.quantidadeVitoriasNecessarias <= 0) {
          e.push("Evento PvP: quantidade de vitórias necessárias é obrigatória.");
        }
        if (!evento.marcos.length) e.push("Evento PvP: adicione pelo menos 1 marco.");
        for (const m of evento.marcos) {
          if (!m.quantidadeVitorias || m.quantidadeVitorias <= 0)
            e.push("Evento PvP: marco com vitórias inválidas.");
          if (!m.premio) e.push("Evento PvP: marco sem prêmio.");
        }
      }
    }

    if (mode === "MISSAO") {
      if (!fases.length) e.push("Missão: deve existir pelo menos 1 fase.");

      for (const fase of fases) {
        if (!fase.historia.texto.trim()) e.push(`Fase ${fase.indice}: História é obrigatória.`);
        if (!fase.historia.npc.imagemUrl.trim()) e.push(`Fase ${fase.indice}: NPC (upload) é obrigatório.`);

        // diálogos
        if (!fase.historia.dialogos.quantidadeFalas || fase.historia.dialogos.quantidadeFalas <= 0)
          e.push(`Fase ${fase.indice}: quantidade de falas inválida.`);

        if (!fase.historia.dialogos.quantidadeBaloes || fase.historia.dialogos.quantidadeBaloes <= 0)
          e.push(`Fase ${fase.indice}: quantidade de balões inválida.`);

        if (fase.historia.dialogos.baloes.length !== fase.historia.dialogos.quantidadeBaloes)
          e.push(
            `Fase ${fase.indice}: você precisa preencher exatamente ${fase.historia.dialogos.quantidadeBaloes} balões.`
          );

        for (const b of fase.historia.dialogos.baloes) {
          if (!b.texto.trim()) {
            e.push(`Fase ${fase.indice}: balão ${b.ordem} está vazio.`);
            break;
          }
        }

        // objetivo mínimo
        if (fase.objetivo.tipo === "ITEM" && !fase.objetivo.itemId) e.push(`Fase ${fase.indice}: selecione um item.`);
        if (fase.objetivo.tipo === "POKEMON" && (!fase.objetivo.pokemonId || fase.objetivo.pokemonId <= 0))
          e.push(`Fase ${fase.indice}: selecione um pokémon válido.`);
        if (fase.objetivo.tipo === "PVP" && (!fase.objetivo.quantidadeVitorias || fase.objetivo.quantidadeVitorias <= 0))
          e.push(`Fase ${fase.indice}: informe vitórias necessárias.`);
      }
    }

    return e;
  }, [titulo, descricaoGeral, mode, evento, fases]);

  function handleSave() {
    setSaveAttempted(true);

    if (errors.length) {
      errorsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    const base: MissionEventDoc = {
      tipo: mode,
      titulo: titulo.trim(),
      direcionamento,
      descricaoGeral: descricaoGeral.trim(),
      isActive,
    };

    if (mode === "MISSAO") {
      // força permiteRoubo false em fases PVP se for TREINADOR
      const fasesSafe = fases.map((f) => {
        if (f.objetivo.tipo === "PVP" && direcionamento === "TREINADOR") {
          return { ...f, objetivo: { ...f.objetivo, permiteRoubo: false } };
        }
        return f;
      });

      onSubmit({ ...base, missao: { fases: fasesSafe } });
      return;
    }

    // EVENTO
    if (evento.tipoEvento === "PVP" && direcionamento === "TREINADOR") {
      onSubmit({ ...base, evento: { ...evento, permiteRoubo: false } as EventConfig });
      return;
    }

    onSubmit({ ...base, evento });
  }

  return (
    <div className="space-y-4">
      {saveAttempted && errors.length > 0 && (
        <div
          ref={errorsRef}
          className="rounded-xl border border-red-500/40 bg-red-900/20 p-3 text-xs text-red-100"
        >
          <b>Corrija antes de salvar:</b>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            {errors.slice(0, 12).map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
          {errors.length > 12 && (
            <div className="mt-2 text-[11px] text-red-200">
              + {errors.length - 12} erros adicionais...
            </div>
          )}
        </div>
      )}

      {/* Campos raiz (sempre presentes) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-2">
          <label className="text-[11px] text-slate-300">TÍTULO (obrigatório)</label>
          <input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm outline-none"
          />
        </div>

        <div>
          <label className="text-[11px] text-slate-300">DIRECIONAMENTO</label>
          <select
            value={direcionamento}
            onChange={(e) => setDirecionamentoSafe(e.target.value as Direcionamento)}
            className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm outline-none"
          >
            <option value="TREINADOR">TREINADOR</option>
            <option value="LADRAO">LADRÃO</option>
          </select>
        </div>

        <div className="md:col-span-3">
          <label className="text-[11px] text-slate-300">
            {mode === "EVENTO" ? "DESCRIÇÃO DO EVENTO (obrigatório)" : "DESCRIÇÃO GERAL (obrigatório)"}
          </label>
          <textarea
            value={descricaoGeral}
            onChange={(e) => setDescricaoGeral(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm outline-none"
          />
        </div>

        <div className="md:col-span-3 flex items-center gap-2">
          <input
            id="isActive"
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-4 w-4"
          />
          <label htmlFor="isActive" className="text-sm text-slate-200">
            Ativo no sistema
          </label>
        </div>
      </div>

      {/* Seções dinâmicas */}
      {mode === "EVENTO" ? (
        <EventSection direcionamento={direcionamento} value={evento} onChange={setEvento} />
      ) : (
        <MissionSection
          direcionamento={direcionamento}
          fases={fases}
          onAddPhase={addPhase}
          onRemoveLastPhase={removeLastPhase}
          onUpdatePhase={updatePhase}
        />
      )}

      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-md text-sm font-semibold bg-slate-800 text-slate-100 hover:bg-slate-700 transition"
        >
          Cancelar
        </button>

        <button
          onClick={handleSave}
          className="px-4 py-2 rounded-md text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-500 transition"
        >
          {mode === "EVENTO" ? "Salvar Evento" : "Salvar Missão"}
        </button>
      </div>
    </div>
  );
}
