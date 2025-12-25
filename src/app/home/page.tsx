"use client";

import RequireAuth from "@/components/RequireAuth";
import Sidebar from "@/components/Sidebar";

export default function HomePage() {
  return (
    <RequireAuth>
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="flex-1 p-6">
          <h1 className="text-2xl font-bold mb-2">Página em desenvolvimento</h1>
          <p>
            Em breve esta tela será o painel principal do EloDex Admin
            (dashboard de jogadores, pokémon e eventos).
          </p>
        </main>
      </div>
    </RequireAuth>
  );
}
