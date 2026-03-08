"use client";

import Sidebar from "@/components/Sidebar";
import RequireAuth from "@/components/RequireAuth";
import ItensPage from "@/components/itens/ItensPage";

export default function LojaPage() {
  return (
    <RequireAuth>
      <div className="flex min-h-screen bg-slate-950 text-slate-100">
        <Sidebar />
        <main className="flex-1 px-4 py-6">
          <header className="mb-4">
            <h1 className="text-xl md:text-2xl font-bold tracking-tight">Loja</h1>
            <p className="text-xs md:text-sm text-slate-300">
              Gerencie itens vendáveis, preços e modos de venda.
            </p>
          </header>

          <ItensPage />
        </main>
      </div>
    </RequireAuth>
  );
}
