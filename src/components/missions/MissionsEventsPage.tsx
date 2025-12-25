"use client";

import { useEffect, useMemo, useState } from "react";
import { MissionEventDoc, TipoDocumento } from "@/lib/missions/missionsTypes";
import {
  createMissionEvent,
  listMissionsEvents,
  removeMissionEvent,
  updateMissionEvent,
} from "@/lib/missions/missionsFirestore";
import MissionEventForm from "./MissionEventForm";

type Filter = "MISSOES" | "EVENTOS";

export default function MissionsEventsPage() {
  const [filter, setFilter] = useState<Filter>("MISSOES");

  const [items, setItems] = useState<MissionEventDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<MissionEventDoc | null>(null);

  // ✅ NOVO: controla se o modal é de MISSÃO ou EVENTO
  const [modalMode, setModalMode] = useState<TipoDocumento>("MISSAO");

  async function reload() {
    try {
      setLoading(true);
      setError(null);
      const list = await listMissionsEvents();
      setItems(list);
    } catch (e: any) {
      setError(e?.message || "Falha ao carregar missões/eventos.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  const filtered = useMemo(() => {
    const tipo: TipoDocumento = filter === "MISSOES" ? "MISSAO" : "EVENTO";
    return items.filter((x) => x.tipo === tipo);
  }, [items, filter]);

  function openCreateMission() {
    setEditing(null);
    setModalMode("MISSAO");
    setModalOpen(true);
  }

  function openCreateEvent() {
    setEditing(null);
    setModalMode("EVENTO");
    setModalOpen(true);
  }

  function openEdit(doc: MissionEventDoc) {
    setEditing(doc);
    // ✅ IMPORTANTE: quando edita, respeita o tipo do documento
    setModalMode(doc.tipo);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditing(null);
    setModalMode("MISSAO");
  }

  async function onToggleActive(docItem: MissionEventDoc) {
    if (!docItem.id) return;
    await updateMissionEvent(docItem.id, { isActive: !docItem.isActive });
    await reload();
  }

  async function onDelete(docItem: MissionEventDoc) {
    if (!docItem.id) return;
    const ok = confirm(
      `Excluir "${docItem.titulo}"? Essa ação não pode ser desfeita.`
    );
    if (!ok) return;
    await removeMissionEvent(docItem.id);
    await reload();
  }

  async function onSubmit(saved: MissionEventDoc) {
    if (editing?.id) {
      await updateMissionEvent(editing.id, saved);
    } else {
      await createMissionEvent(saved);
    }
    closeModal();
    await reload();
  }

  const modalTitle =
    modalMode === "EVENTO"
      ? editing
        ? "Editar Evento"
        : "Criar Evento"
      : editing
      ? "Editar Missão"
      : "Criar Missão";

  const modalSubtitle =
    modalMode === "EVENTO"
      ? "Configure datas, tipo (CAPTURA/PvP), objetivos e marcos de recompensa."
      : "Configure fases, objetivos, NPC e recompensas.";

  return (
    <div className="w-full">
      <header className="flex flex-col gap-1 mb-4">
        <h1 className="text-xl md:text-2xl font-bold tracking-tight">
          Missões & Eventos
        </h1>
        <p className="text-xs md:text-sm text-slate-300">
          Tela administrativa de configuração (sem execução de regras do jogo).
        </p>
      </header>

      {/* Tabs/Filtro */}
      <div className="flex gap-2 mb-4">
        <button
          className={`px-4 py-2 rounded-md text-sm font-semibold transition ${
            filter === "MISSOES"
              ? "bg-emerald-600 text-white"
              : "bg-slate-800 text-slate-200 hover:bg-slate-700"
          }`}
          onClick={() => setFilter("MISSOES")}
        >
          MISSÕES
        </button>

        <button
          className={`px-4 py-2 rounded-md text-sm font-semibold transition ${
            filter === "EVENTOS"
              ? "bg-emerald-600 text-white"
              : "bg-slate-800 text-slate-200 hover:bg-slate-700"
          }`}
          onClick={() => setFilter("EVENTOS")}
        >
          EVENTOS
        </button>

        <div className="flex-1" />

        {/* ✅ AGORA O BOTÃO DE EVENTO FUNCIONA */}
        {filter === "MISSOES" ? (
          <button
            onClick={openCreateMission}
            className="px-4 py-2 rounded-md text-sm font-semibold bg-slate-100 text-slate-900 hover:bg-white transition"
          >
            + Criar Missão
          </button>
        ) : (
          <button
            onClick={openCreateEvent}
            className="px-4 py-2 rounded-md text-sm font-semibold bg-slate-100 text-slate-900 hover:bg-white transition"
          >
            + Criar Evento
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-900/20 px-3 py-2 text-xs text-red-100 mb-3">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-300">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-slate-300">
          {filter === "MISSOES" ? (
            <>Nenhuma missão cadastrada ainda.</>
          ) : (
            <>Nenhum evento cadastrado ainda.</>
          )}
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((x) => (
            <div
              key={x.id}
              className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-slate-400">
                      {x.tipo}
                    </span>
                    <span className="text-[10px] uppercase tracking-wider text-slate-400">
                      •
                    </span>
                    <span className="text-[10px] uppercase tracking-wider text-slate-400">
                      {x.direcionamento}
                    </span>
                    <span className="text-[10px] uppercase tracking-wider text-slate-400">
                      •
                    </span>
                    <span
                      className={`text-[10px] uppercase tracking-wider ${
                        x.isActive ? "text-emerald-300" : "text-slate-400"
                      }`}
                    >
                      {x.isActive ? "ATIVO" : "INATIVO"}
                    </span>
                  </div>

                  <h2 className="text-sm font-semibold text-white truncate mt-1">
                    {x.titulo}
                  </h2>

                  <p className="text-[11px] text-slate-300 mt-1 line-clamp-2">
                    {x.descricaoGeral}
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                  <button
                    onClick={() => onToggleActive(x)}
                    className="px-3 py-2 rounded-md text-xs font-semibold bg-slate-800 text-slate-100 hover:bg-slate-700 transition"
                  >
                    {x.isActive ? "Desativar" : "Ativar"}
                  </button>

                  {/* ✅ AGORA EDITAR FUNCIONA PARA MISSÃO E EVENTO */}
                  <button
                    onClick={() => openEdit(x)}
                    className="px-3 py-2 rounded-md text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-500 transition"
                  >
                    Editar
                  </button>

                  <button
                    onClick={() => onDelete(x)}
                    className="px-3 py-2 rounded-md text-xs font-semibold bg-red-600/80 text-white hover:bg-red-600 transition"
                  >
                    Excluir
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ✅ MODAL COM SCROLL */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60">
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-4xl max-h-[90vh] rounded-2xl border border-slate-800 bg-slate-950 shadow-xl flex flex-col">
              {/* Header fixo */}
              <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-slate-800">
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    {modalTitle}
                  </h3>
                  <p className="text-[11px] text-slate-400">{modalSubtitle}</p>
                </div>

                <button
                  onClick={closeModal}
                  className="text-[11px] text-slate-300 hover:text-white underline underline-offset-2"
                >
                  Fechar
                </button>
              </div>

              {/* Corpo com scroll */}
              <div className="flex-1 overflow-y-auto p-4">
                <MissionEventForm
                  mode={modalMode}
                  initial={editing}
                  onCancel={closeModal}
                  onSubmit={onSubmit}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
