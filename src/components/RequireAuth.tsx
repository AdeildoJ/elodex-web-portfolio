"use client";

import { ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getAuth,
  onAuthStateChanged,
  signOut,
  User as FirebaseUser,
} from "firebase/auth";
import { app } from "@/lib/firebase";

interface RequireAuthProps {
  children: ReactNode;
}

// Lista de e-mails de admin vinda do .env
// NEXT_PUBLIC_ADMIN_EMAILS=admin1@seuemail.com,admin2@seuemail.com
const ADMIN_EMAILS: string[] = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.trim())
  .filter(Boolean);

export default function RequireAuth({ children }: RequireAuthProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const auth = getAuth(app);

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setLoading(true);
      setErrorMsg(null);

      // 1) Não está logado → mandar pro login
      if (!user) {
        setCurrentUser(null);
        setLoading(false);
        router.replace("/login");
        return;
      }

      try {
        // 2) (Opcional) valida por e-mail (seu bloqueio extra)
        const email = user.email || "";
        const emailOk = ADMIN_EMAILS.length === 0 ? true : ADMIN_EMAILS.includes(email);

        if (!emailOk) {
          await signOut(auth);
          setCurrentUser(null);
          setLoading(false);
          router.replace("/login?error=not_admin_email");
          return;
        }

        // ✅ 3) CRÍTICO: forçar refresh do token para pegar claims atuais
        const tokenResult = await user.getIdTokenResult(true);
        const claims = tokenResult?.claims || {};
        const claimAdminOk = claims.admin === true;

        // 4) Se não tiver claim admin → bloquear acesso (porque Firestore Rules exigem isso)
        if (!claimAdminOk) {
          // Você pode escolher: só bloquear a UI, ou deslogar.
          // Aqui eu deslogo pra garantir que ninguém navegue no admin sem permissão real.
          await signOut(auth);
          setCurrentUser(null);
          setLoading(false);
          router.replace("/login?error=missing_admin_claim");
          return;
        }

        // 5) OK: admin de verdade (claim) → libera
        setCurrentUser(user);
        setLoading(false);
      } catch (err: any) {
        console.error("[RequireAuth] erro:", err);
        setErrorMsg(err?.message || "Falha ao validar permissões.");
        await signOut(auth);
        setCurrentUser(null);
        setLoading(false);
        router.replace("/login?error=auth_check_failed");
      }
    });

    return () => unsubscribe();
  }, [router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 text-slate-100">
        <div className="rounded-lg bg-slate-800 px-6 py-4 text-sm text-slate-200 shadow-lg">
          Verificando sessão de administrador...
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return null;
  }

  // (Opcional) se quiser mostrar erro em vez de redirect, mantenha isso,
  // mas hoje já redirecionamos.
  if (errorMsg) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 text-slate-100 p-6">
        <div className="max-w-md w-full rounded-lg border border-red-500/30 bg-slate-950/60 px-6 py-4">
          <div className="text-sm font-semibold text-red-200">Acesso negado</div>
          <div className="text-xs text-slate-300 mt-2">{errorMsg}</div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
