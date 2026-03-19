"use client";

import Link from "next/link";

import RequireAuth from "@/components/RequireAuth";
import Sidebar from "@/components/Sidebar";

type CadastroCard = {
  href: string;
  title: string;
  description: string;
  accent: string;
};

const cards: CadastroCard[] = [
  {
    href: "/jogadores",
    title: "JOGADORES",
    description: "Gerencie os jogadores cadastrados e seus dados principais.",
    accent: "from-cyan-400 to-blue-500",
  },
  {
    href: "/npc",
    title: "NPC",
    description: "Centralize o cadastro e a organizacao dos NPCs do jogo.",
    accent: "from-emerald-400 to-teal-500",
  },
  {
    href: "/biomas",
    title: "BIOMA",
    description: "Configure os biomas, encontros, NPCs e cenarios de batalha.",
    accent: "from-lime-400 to-green-500",
  },
  {
    href: "/missoes",
    title: "MISSOES",
    description: "Cadastre missoes e organize a progressao de eventos.",
    accent: "from-amber-400 to-orange-500",
  },
  {
    href: "/cenario",
    title: "CENARIO",
    description: "Organize os cenarios visuais usados no jogo e nos GYMs.",
    accent: "from-fuchsia-400 to-violet-500",
  },
  {
    href: "/insignias",
    title: "INSIGNIAS",
    description: "Cadastre as insignias que podem ser vinculadas aos GYMs.",
    accent: "from-sky-400 to-cyan-500",
  },
];

export default function CadastrosPage() {
  return (
    <RequireAuth>
      <div className="flex min-h-screen bg-slate-950 text-white">
        <Sidebar />

        <main className="flex-1 overflow-x-hidden">
          <section className="relative isolate px-6 py-8 md:px-10 md:py-10">
            <div className="absolute inset-x-0 top-0 -z-10 h-64 bg-[radial-gradient(circle_at_top_left,_rgba(45,212,191,0.28),_transparent_42%),radial-gradient(circle_at_top_right,_rgba(59,130,246,0.24),_transparent_38%)]" />

            <div className="mx-auto max-w-7xl">
              <div className="mb-8 rounded-[28px] border border-white/10 bg-white/5 p-6 shadow-2xl shadow-cyan-950/20 backdrop-blur">
                <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300">Cadastros</p>
                <h1 className="mt-3 text-3xl font-black tracking-tight text-white md:text-4xl">
                  Escolha o tipo de cadastro
                </h1>
                <p className="mt-3 max-w-2xl text-sm text-slate-300 md:text-base">
                  Esta area funciona como menu central, igual ao fluxo que voce pediu: clique no modulo e siga
                  direto para o cadastro correspondente.
                </p>
              </div>

              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {cards.map((card) => (
                  <Link
                    key={card.href}
                    href={card.href}
                    className="group relative overflow-hidden rounded-[28px] border border-white/10 bg-slate-900/75 p-6 shadow-xl shadow-black/20 transition duration-200 hover:-translate-y-1 hover:border-cyan-300/40 hover:bg-slate-900"
                  >
                    <div className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${card.accent}`} />

                    <div className="inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-bold tracking-[0.25em] text-slate-300">
                      MODULO
                    </div>

                    <h2 className="mt-5 text-2xl font-black tracking-tight text-white">{card.title}</h2>
                    <p className="mt-3 min-h-16 text-sm leading-6 text-slate-300">{card.description}</p>

                    <div className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-cyan-300">
                      Abrir cadastro
                      <span className="transition group-hover:translate-x-1">→</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        </main>
      </div>
    </RequireAuth>
  );
}
