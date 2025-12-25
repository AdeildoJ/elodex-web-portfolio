"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";

const items = [
  { href: "/home", label: "Home", icon: "/icons/home.png" },
  { href: "/pokedex", label: "Pokédex", icon: "/icons/testes.png" },
  // 🔹 Novo item: Painéis
  { href: "/paineis", label: "Painéis", icon: "/icons/auditoria.png" },
  { href: "/usuarios", label: "Usuários", icon: "/icons/usuarios.png" },
  { href: "/missoes", label: "Missões", icon: "/icons/eventos.png" },
  { href: "/loja", label: "Loja", icon: "/icons/biblioteca.png" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);

  async function handleLogout() {
    await signOut(auth);
    router.replace("/login");
  }

  return (
    <aside
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      className={`h-screen sticky top-0 border-r border-black/10 
              transition-[width] duration-300
              ${expanded ? "w-56" : "w-16"} 
              overflow-hidden flex flex-col`}
      style={{
        background: "linear-gradient(180deg, #A78BFA 0%, #7C3AED 100%)",
      }}
    >
      {/* Logo */}
      <div className="flex items-center justify-center py-4">
        <Image
          src="/images/EloDexLogo.png"
          alt="EloDex"
          width={expanded ? 80 : 28}
          height={32}
          priority
        />
      </div>

      {/* Menu */}
      <nav className="px-2 space-y-1 mt-2 flex-1">
        {items.map((it) => {
          const active = pathname.startsWith(it.href);

          return (
            <Link
              key={it.href}
              href={it.href}
              title={it.label}
              className={`flex ${
                expanded ? "justify-start" : "justify-center"
              } 
                          items-center gap-3 p-2 rounded-md transition 
                          ${active ? "bg-white/20" : "hover:bg-white/10"}`}
            >
              <span className="inline-flex items-center justify-center w-9 h-9 rounded-md bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={it.icon}
                  alt=""
                  className="w-5 h-5 object-contain"
                />
              </span>

              <span
                className={`${
                  expanded ? "inline" : "hidden"
                } text-sm font-semibold text-white drop-shadow whitespace-nowrap`}
              >
                {it.label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Botão Sair */}
      <div className="px-2 pb-3">
        <button
          onClick={handleLogout}
          title="Sair"
          className={`w-full flex ${
            expanded ? "justify-start gap-3" : "justify-center"
          } 
                      items-center p-2 rounded-md 
                      bg-black/30 hover:bg-black/40 
                      text-white transition`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 2v10"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path
              d="M6.35 6.35a8 8 0 1 0 11.3 0"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>

          <span
            className={`${
              expanded ? "inline" : "hidden"
            } text-sm font-semibold`}
          >
            Sair
          </span>
        </button>
      </div>
    </aside>
  );
}
