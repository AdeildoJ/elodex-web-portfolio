"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import type { ComponentType } from "react";
import { signOut } from "firebase/auth";

import { auth } from "@/lib/firebase";

type Item = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

function HomeIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={className}>
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5 10.5V20h14v-9.5" />
    </svg>
  );
}

function BookOpenIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={className}>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H20v15.5a.5.5 0 0 1-.5.5H7a3 3 0 0 0-3 3z" />
      <path d="M8 4v16" />
    </svg>
  );
}

function PanelsIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={className}>
      <rect x="3" y="4" width="18" height="6" rx="2" />
      <rect x="3" y="14" width="8" height="6" rx="2" />
      <rect x="13" y="14" width="8" height="6" rx="2" />
    </svg>
  );
}

function StoreIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={className}>
      <path d="M4 9h16" />
      <path d="M5 9.5 6.5 4h11L19 9.5V20H5z" />
      <path d="M9 20v-5h6v5" />
    </svg>
  );
}

function FolderIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={className}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z" />
    </svg>
  );
}

function UsersIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={className}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle cx="9.5" cy="7.5" r="3.5" />
      <path d="M20 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16.5 4.6a3.5 3.5 0 0 1 0 5.8" />
    </svg>
  );
}

function MapIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={className}>
      <path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z" />
      <path d="M9 4v13.5" />
      <path d="M15 6.5V20" />
    </svg>
  );
}

function ScrollIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={className}>
      <path d="M7 4h9a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H8a3 3 0 0 1 0-6h8" />
      <path d="M8 14h8" />
      <path d="M8 10h8" />
    </svg>
  );
}

function NpcIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={className}>
      <circle cx="12" cy="7.5" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
      <path d="M18.5 9.5 21 12l-2.5 2.5" />
    </svg>
  );
}

function ScenarioIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={className}>
      <path d="M3 19V5" />
      <path d="M21 19V5" />
      <path d="M3 19h18" />
      <path d="m7 15 3-3 2 2 5-5 2 2" />
    </svg>
  );
}

function BadgeIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={className}>
      <circle cx="12" cy="8" r="4" />
      <path d="m8.5 12.5-1 7 4.5-2.5 4.5 2.5-1-7" />
    </svg>
  );
}

function LogoutIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={className}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

const mainItems: Item[] = [
  { href: "/home", label: "Home", icon: HomeIcon },
  { href: "/pokedex", label: "Pokedex", icon: BookOpenIcon },
  { href: "/paineis", label: "Paineis", icon: PanelsIcon },
  { href: "/loja", label: "Loja", icon: StoreIcon },
];

const cadastroItems: Item[] = [
  { href: "/jogadores", label: "Jogadores", icon: UsersIcon },
  { href: "/biomas", label: "Biomas", icon: MapIcon },
  { href: "/missoes", label: "Missoes", icon: ScrollIcon },
  { href: "/npc", label: "NPC", icon: NpcIcon },
  { href: "/cenario", label: "Cenario", icon: ScenarioIcon },
  { href: "/insignias", label: "Insignias", icon: BadgeIcon },
];

function SidebarLink({
  item,
  expanded,
  active,
}: {
  item: Item;
  expanded: boolean;
  active: boolean;
}) {
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      title={item.label}
      className={`flex ${expanded ? "justify-start" : "justify-center"} items-center gap-3 rounded-md p-2 transition ${
        active ? "bg-white/14" : "hover:bg-white/10"
      }`}
    >
      <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
        active ? "text-cyan-200" : "text-white"
      }`}>
        <Icon className="h-5 w-5" />
      </span>

      <span
        className={`${expanded ? "inline" : "hidden"} whitespace-nowrap text-sm font-semibold text-white drop-shadow`}
      >
        {item.label}
      </span>
    </Link>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const cadastrosActive =
    pathname.startsWith("/cadastros") || cadastroItems.some((item) => pathname.startsWith(item.href));

  async function handleLogout() {
    await signOut(auth);
    router.replace("/login");
  }

  return (
    <aside
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      className={`sticky top-0 flex h-screen flex-col overflow-hidden border-r border-black/10 transition-[width] duration-300 ${
        expanded ? "w-60" : "w-16"
      }`}
      style={{
        background: "linear-gradient(180deg, #A78BFA 0%, #7C3AED 100%)",
      }}
    >
      <div className="flex items-center justify-center py-4">
        <Image src="/images/EloDexLogo.png" alt="EloDex" width={expanded ? 80 : 28} height={32} priority />
      </div>

      <nav className="mt-2 flex-1 space-y-1 px-2">
        {mainItems.map((item) => (
          <SidebarLink key={item.href} item={item} expanded={expanded} active={pathname.startsWith(item.href)} />
        ))}

        <Link
          href="/cadastros"
          title="Cadastros"
          className={`flex ${expanded ? "justify-start" : "justify-center"} items-center gap-3 rounded-md p-2 transition ${
            cadastrosActive ? "bg-white/14" : "hover:bg-white/10"
          }`}
        >
          <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
            cadastrosActive ? "text-cyan-200" : "text-white"
          }`}>
            <FolderIcon className="h-5 w-5" />
          </span>
          <span className={`${expanded ? "inline" : "hidden"} whitespace-nowrap text-sm font-semibold text-white drop-shadow`}>
            Cadastros
          </span>
        </Link>
      </nav>

      <div className="px-2 pb-3">
        <button
          onClick={handleLogout}
          title="Sair"
          className={`w-full rounded-md bg-black/30 p-2 text-white transition hover:bg-black/40 ${
            expanded ? "flex items-center justify-start gap-3" : "flex items-center justify-center"
          }`}
        >
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-white">
            <LogoutIcon className="h-5 w-5" />
          </span>
          <span className={`${expanded ? "inline" : "hidden"} text-sm font-semibold`}>Sair</span>
        </button>
      </div>
    </aside>
  );
}
