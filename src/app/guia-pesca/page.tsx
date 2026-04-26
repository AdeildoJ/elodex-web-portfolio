"use client";

import Link from "next/link";

import RequireAuth from "@/components/RequireAuth";
import Sidebar from "@/components/Sidebar";

export default function GuiaPescaPage() {
  return (
    <RequireAuth>
      <div className="flex min-h-screen bg-slate-950 text-white">
        <Sidebar />
        <main className="flex-1 overflow-x-hidden px-6 py-8 md:px-10">
          <div className="mx-auto max-w-3xl space-y-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Documentacao</p>
              <h1 className="mt-2 text-2xl font-black tracking-tight md:text-3xl">Guia: pesca (DV)</h1>
              <p className="mt-3 text-sm text-slate-300">
                Mapa rapido de como encaixar bioma, pescador, grupos e produtos monetizados.
              </p>
            </div>

            <section className="rounded-2xl border border-white/10 bg-slate-900/50 p-5 text-sm leading-relaxed text-slate-200">
              <h2 className="text-lg font-bold text-white">Fluxo resumido</h2>
              <ol className="mt-3 list-decimal space-y-2 pl-5">
                <li>
                  <strong>Bioma</strong>: encontros normais e array <code className="text-cyan-200">fishingSpecies</code> (e, se
                  existir, <code className="text-cyan-200">fishingGroupIds</code>) vindo do Pokedex/Admin.
                </li>
                <li>
                  <strong>Grupos de pesca</strong>: tabela em <Link className="text-cyan-300 underline" href="/pesca-grupos">Pesca
                  — Grupos</Link> (<code className="text-cyan-200">fishingGroups</code>).
                </li>
                <li>
                  <strong>NPC Pescador</strong>: em <Link className="text-cyan-300 underline" href="/npc">NPC</Link>, role
                  pescador; use <code className="text-cyan-200">fishingGroupId</code> (legado) ou{" "}
                  <code className="text-cyan-200">fishingGroupIds</code> para unir tabelas.
                </li>
                <li>
                  <strong>Isca/Anzol (loja)</strong>: em <Link className="text-cyan-300 underline" href="/loja">Loja</Link>, produto
                  tipo Isca/Anzol; o item em <code className="text-cyan-200">itemsConfig</code> alinha com o id do produto, grupos
                  e especies alvo.
                </li>
              </ol>
            </section>

            <p className="text-xs text-slate-500">
              Modo pesca &quot;normal&quot; (Slowpoke / radar) e modo pelo pescador podem conviver: o app une grupos e metadados
              conforme o fluxo de Explorar.
            </p>
          </div>
        </main>
      </div>
    </RequireAuth>
  );
}
