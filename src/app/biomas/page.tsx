"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { collection, getDocs } from "firebase/firestore";

import RequireAuth from "@/components/RequireAuth";
import Sidebar from "@/components/Sidebar";
import BiomeCadastroModal from "@/components/biomas/BiomeCadastroModal";
import BiomeMapEditor from "@/components/biomas/BiomeMapEditor";
import { db } from "@/lib/firebase";

type BiomeListRow = { id: string; name: string; order: number };

function BiomasPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = searchParams.get("view");

  const [tab, setTab] = useState<"cadastro" | "mapa">(() => (view === "mapa" ? "mapa" : "cadastro"));

  useEffect(() => {
    setTab(view === "mapa" ? "mapa" : "cadastro");
  }, [view]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingBiomeId, setEditingBiomeId] = useState<string | null>(null);
  const [biomeList, setBiomeList] = useState<BiomeListRow[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [mapRefreshToken, setMapRefreshToken] = useState(0);

  const loadBiomeList = useCallback(async () => {
    setListLoading(true);
    try {
      const snap = await getDocs(collection(db, "biomes"));
      const rows: BiomeListRow[] = [];
      snap.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        const id = String(data.id || d.id || "")
          .trim()
          .toLowerCase();
        if (!id) return;
        rows.push({
          id,
          name: String(data.name || id),
          order: Math.max(0, Math.trunc(Number(data.order ?? 0))),
        });
      });
      rows.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "pt-BR"));
      setBiomeList(rows);
    } catch (e) {
      console.error(e);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "cadastro") void loadBiomeList();
  }, [tab, loadBiomeList]);

  function goTab(next: "cadastro" | "mapa") {
    setTab(next);
    router.replace(next === "mapa" ? "/biomas?view=mapa" : "/biomas", { scroll: false });
  }

  function openNewBiome() {
    setEditingBiomeId(null);
    setModalOpen(true);
  }

  function openEditBiome(id: string) {
    setEditingBiomeId(id);
    setModalOpen(true);
  }

  function handleModalClose() {
    setModalOpen(false);
    setEditingBiomeId(null);
  }

  function handleSaved() {
    void loadBiomeList();
    setMapRefreshToken((t) => t + 1);
    handleModalClose();
  }

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <Sidebar />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col px-4 py-6 md:px-8">
        <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-slate-800 pb-4">
          <button
            type="button"
            onClick={() => goTab("cadastro")}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
              tab === "cadastro"
                ? "bg-violet-600 text-white"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}
          >
            Cadastro de Biomas
          </button>
          <button
            type="button"
            onClick={() => goTab("mapa")}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
              tab === "mapa"
                ? "bg-violet-600 text-white"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}
          >
            Mapa e rotas
          </button>
          <span className="text-xs text-slate-500">Mesma página — o menu lateral permanece visível.</span>
        </div>

        {tab === "cadastro" && (
          <>
            <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h1 className="text-xl font-bold tracking-tight text-white md:text-2xl">Cadastro de Biomas</h1>
                <p className="mt-1 max-w-xl text-sm text-slate-400">
                  O bioma guarda conteúdo (captura, NPCs, cenário, clima). KM e requisitos de viagem ficam na aba{" "}
                  <button type="button" onClick={() => goTab("mapa")} className="text-cyan-400 underline">
                    Mapa e rotas
                  </button>
                  .
                </p>
              </div>
              <button
                type="button"
                onClick={openNewBiome}
                className="inline-flex shrink-0 items-center justify-center rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-900/20 hover:bg-emerald-500"
              >
                + Novo Bioma
              </button>
            </header>

            <section className="mt-8 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
              <h2 className="text-sm font-semibold text-slate-200">Biomas cadastrados</h2>
              <p className="mt-1 text-xs text-slate-500">Clique em Editar para abrir o formulário do bioma.</p>
              {listLoading && <p className="mt-4 text-sm text-slate-400">Carregando…</p>}
              {!listLoading && !biomeList.length && (
                <p className="mt-4 text-sm text-slate-500">Nenhum bioma ainda. Use &quot;+ Novo Bioma&quot;.</p>
              )}
              {!listLoading && biomeList.length > 0 && (
                <ul className="mt-4 divide-y divide-slate-800">
                  {biomeList.map((b) => (
                    <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                      <div>
                        <p className="text-sm font-medium text-white">{b.name}</p>
                        <p className="text-[11px] text-slate-500">
                          Ordem {b.order} · id <span className="font-mono text-slate-400">{b.id}</span>
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => openEditBiome(b.id)}
                        className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
                      >
                        Editar
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}

        {tab === "mapa" && (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col" id="mapa-biomas">
            <BiomeMapEditor refreshToken={mapRefreshToken} onEditBiome={openEditBiome} />
          </div>
        )}

        <BiomeCadastroModal
          open={modalOpen}
          onClose={handleModalClose}
          onSaved={handleSaved}
          editingBiomeId={editingBiomeId}
        />
      </main>
    </div>
  );
}

export default function BiomasPage() {
  return (
    <RequireAuth>
      <Suspense
        fallback={
          <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-300">
            Carregando biomas…
          </div>
        }
      >
        <BiomasPageInner />
      </Suspense>
    </RequireAuth>
  );
}
