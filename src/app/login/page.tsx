// src/app/login/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
} from "firebase/auth";
import { auth } from "@/lib/firebase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(false);

  // Se já estiver logado:
  // - se for ADMIN → vai direto para /home
  // - se NÃO for admin → faz signOut e mostra mensagem de acesso restrito
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) return;

      (async () => {
        try {
          const tokenResult = await user.getIdTokenResult();
          const isAdmin = tokenResult.claims.admin === true;

          if (isAdmin) {
            router.replace("/home");
          } else {
            await signOut(auth);
            setErro("Este acesso é exclusivo ao Professor EloDex.");
          }
        } catch (e) {
          console.error("Erro ao validar permissões:", e);
          setErro("Não foi possível validar suas permissões.");
          await signOut(auth);
        }
      })();
    });

    return () => unsub();
  }, [router]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    setLoading(true);

    try {
      const cred = await signInWithEmailAndPassword(
        auth,
        email.trim(),
        senha
      );

      const tokenResult = await cred.user.getIdTokenResult();
      const isAdmin = tokenResult.claims.admin === true;

      if (isAdmin) {
        router.replace("/home");
      } else {
        await signOut(auth);
        setErro("Este acesso é exclusivo ao Professor EloDex.");
      }
    } catch (err: any) {
      let msg = "E-mail ou senha inválidos.";
      if (err?.code === "auth/invalid-email") msg = "E-mail inválido.";
      if (err?.code === "auth/user-disabled") msg = "Usuário desativado.";
      if (err?.code === "auth/too-many-requests")
        msg = "Muitas tentativas. Tente novamente mais tarde.";
      setErro(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid grid-cols-1 md:grid-cols-2">
      {/* Lado esquerdo — Logo (fundo branco) */}
      <div className="hidden md:flex items-center justify-center bg-teal-100">
        <div className="text-center">
          <img
            src="/images/EloDexLogo.png"
            alt="EloDex"
            className="w-150 h-auto mx-auto select-none"
            draggable={false}
          />
          <p className="text-gray-500 mt-4">Módulo Web</p>
        </div>
      </div>

      {/* Lado direito — Fundo Pokémon + véu escuro + formulário */}
      <div className="relative flex items-center justify-center p-8">
        {/* Imagem de fundo */}
        <img
          src="/images/fundopokemon.png"
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          aria-hidden="true"
        />
        {/* Véu escuro para legibilidade */}
        <div className="absolute inset-0 bg-black/60" aria-hidden="true" />

        {/* Card do formulário (acima do véu) */}
        <form
          onSubmit={handleLogin}
          className="relative w-full max-w-sm bg-white rounded-xl p-6 shadow"
        >
          <h1 className="text-2xl font-semibold mb-4 text-center text-zinc-800">
            Bem-vindo ao EloDex!
          </h1>

          <label
            htmlFor="email"
            className="block text-sm font-medium mb-1 text-zinc-700"
          >
            E-mail
          </label>
          <input
            id="email"
            type="email"
            className="w-full border border-blue-500 rounded-md px-3 py-2 mb-3 outline-none
                       text-zinc-900 placeholder:text-zinc-400"
            placeholder="Digite seu e-mail…"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />

          <label
            htmlFor="senha"
            className="block text-sm font-medium mb-1 text-zinc-700"
          >
            Senha
          </label>
          <input
            id="senha"
            type="password"
            className="w-full border border-blue-500 rounded-md px-3 py-2 mb-3 outline-none
                       text-zinc-900 placeholder:text-zinc-400"
            placeholder="Digite sua senha…"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            required
            autoComplete="current-password"
          />

          {erro && <div className="text-red-600 text-sm mb-2">{erro}</div>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white rounded-md py-2 font-medium hover:opacity-90 transition disabled:opacity-60"
          >
            {loading ? "Entrando…" : "ENTRAR"}
          </button>

          <p className="text-center text-xs text-gray-500 mt-3">Versão: 0.1.0</p>
        </form>
      </div>
    </div>
  );
}
