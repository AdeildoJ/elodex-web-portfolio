"use client";

import { useState } from "react";

import Sidebar from "@/components/Sidebar";
import RequireAuth from "@/components/RequireAuth";
import ItensPage from "@/components/itens/ItensPage";
import MonetizationAdmin from "@/components/monetization/MonetizationAdmin";

export default function LojaPage() {
  const [tab, setTab] = useState<"itens" | "vip" | "products" | "ecoin">("itens");

  return (
    <RequireAuth>
      <div className="flex min-h-screen bg-slate-950 text-slate-100">
        <Sidebar />
        <main className="flex-1 px-4 py-6">
          <header className="mb-4">
            <h1 className="text-xl font-bold tracking-tight md:text-2xl">Loja</h1>
            <p className="text-xs text-slate-300 md:text-sm">
              Gerencie itens vendaveis, planos VIP e produtos monetizaveis sem mexer nos fluxos do jogo.
            </p>
          </header>

          <div className="mb-4 flex flex-wrap gap-2">
            {[
              { id: "itens", label: "Itens do jogo" },
              { id: "vip", label: "Planos VIP" },
              { id: "products", label: "Produtos monetizaveis" },
              { id: "ecoin", label: "Pacotes de Ecoin" },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setTab(item.id as "itens" | "vip" | "products")}
                className={`rounded-md px-4 py-2 text-sm font-semibold transition ${
                  tab === item.id
                    ? "bg-emerald-600 text-white"
                    : "border border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {tab === "itens" ? <ItensPage /> : null}
          {tab === "vip" ? <MonetizationAdmin mode="vip" /> : null}
          {tab === "products" ? <MonetizationAdmin mode="products" /> : null}
          {tab === "ecoin" ? <MonetizationAdmin mode="ecoin" /> : null}
        </main>
      </div>
    </RequireAuth>
  );
}
