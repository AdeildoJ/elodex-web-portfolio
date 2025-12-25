"use client";

import RequireAuth from "@/components/RequireAuth";
import Sidebar from "@/components/Sidebar";
import MissionsEventsPage from "@/components/missions/MissionsEventsPage";

export default function MissoesPage() {
  return (
    <RequireAuth>
      <div className="flex min-h-screen bg-slate-900 text-slate-100">
        <Sidebar />
        <main className="flex-1 px-4 py-6">
          <MissionsEventsPage />
        </main>
      </div>
    </RequireAuth>
  );
}
