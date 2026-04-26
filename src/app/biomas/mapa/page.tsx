"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import RequireAuth from "@/components/RequireAuth";

/** Mantido para links antigos: redireciona para a página unificada de biomas. */
export default function BiomasMapaRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/biomas?view=mapa");
  }, [router]);

  return (
    <RequireAuth>
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">
        Abrindo mapa…
      </div>
    </RequireAuth>
  );
}
