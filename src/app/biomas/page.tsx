"use client";

import RequireAuth from "@/components/RequireAuth";
import Sidebar from "@/components/Sidebar";
import BiomesPage from "@/components/biomas/BiomesPage";

export default function BiomasPage() {
  return (
    <RequireAuth>
      <div className="flex min-h-screen bg-slate-950 text-slate-100">
        <Sidebar />
        <main className="flex-1 px-4 py-6">
          <header className="mb-4">
            <h1 className="text-xl md:text-2xl font-bold tracking-tight">Biomas</h1>
            <p className="text-xs md:text-sm text-slate-300">
              Configure nome, descricao, imagem e servicos disponiveis por bioma.
            </p>
          </header>
          <BiomesPage />
        </main>
      </div>
    </RequireAuth>
  );
}
