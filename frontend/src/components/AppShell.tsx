"use client";

import { Coins, Film, LogOut, Plug, Plus, Sparkles, Users, WandSparkles, Zap } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { api, setActiveOrg } from "@/lib/api";

import { SessionProvider, useSession } from "./session";
import { cx, PageLoading } from "./ui";

const NAV = [
  { href: "/studio", label: "Create", icon: WandSparkles },
  { href: "/generate", label: "All models", icon: Sparkles },
  { href: "/library", label: "Library", icon: Film },
  { href: "/settings/connections", label: "Connections", icon: Plug },
  { href: "/settings/team", label: "Team", icon: Users },
  { href: "/billing", label: "Billing", icon: Coins },
];

export function Logo() {
  return (
    <Link href="/studio" className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="accent-gradient grid size-8 place-items-center rounded-xl shadow-[0_0_24px_-4px_rgb(214_255_61/0.6)]">
        <Zap className="size-4 fill-black" />
      </span>
      <span className="text-lg">taleloop</span>
    </Link>
  );
}

function UserMenu() {
  const router = useRouter();
  const { me, switchOrg } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  async function logout() {
    await api.logout();
    setActiveOrg(null);
    router.replace("/login");
  }

  const initial = (me.user.name || me.user.email).slice(0, 1).toUpperCase();
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="grid size-9 place-items-center rounded-full bg-linear-to-br from-hot to-accent text-sm font-semibold text-black"
      >
        {initial}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-64 animate-scale-in space-y-3 rounded-2xl border border-white/10 bg-panel p-3 shadow-2xl">
          <div className="px-1">
            <p className="truncate text-sm font-medium">{me.user.name || me.user.email}</p>
            <p className="truncate text-xs text-mute">{me.user.email}</p>
          </div>
          {me.organizations.length > 1 ? (
            <select
              value={me.activeOrganization?.id}
              onChange={(e) => switchOrg(Number(e.target.value))}
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-2 py-1.5 text-sm"
            >
              {me.organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="truncate rounded-xl bg-white/[0.04] px-3 py-2 text-xs text-mute">{me.activeOrganization?.name}</p>
          )}
          <button onClick={logout} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-mute hover:bg-white/[0.06] hover:text-ink">
            <LogOut className="size-4" /> Log out
          </button>
        </div>
      )}
    </div>
  );
}

function TopBar() {
  const pathname = usePathname();
  const { credits, can } = useSession();

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-bg/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1500px] items-center gap-4 px-4 md:px-8">
        <Logo />
        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto md:justify-center">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cx(
                  "flex shrink-0 items-center gap-2 rounded-full px-3.5 py-1.5 text-sm transition",
                  active ? "bg-white/[0.08] text-ink" : "text-mute hover:text-ink",
                )}
              >
                <Icon className={cx("size-4", active && "text-accent")} />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/billing"
            className="hidden items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm hover:border-accent/40 sm:flex"
          >
            <Zap className="size-3.5 fill-accent text-accent" />
            <span className="font-semibold tabular-nums">{credits ?? "–"}</span>
          </Link>
          {can("creator") && (
            <Link
              href="/studio"
              className="accent-gradient flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold transition hover:brightness-110"
            >
              <Plus className="size-4" strokeWidth={2.5} /> <span className="hidden sm:inline">New video</span>
            </Link>
          )}
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SessionProvider fallback={<PageLoading />}>
      <div className="bg-aurora flex min-h-screen flex-col">
        <TopBar />
        <main className="mx-auto w-full min-w-0 max-w-[1500px] flex-1 px-4 py-6 md:px-8 md:py-10">{children}</main>
      </div>
    </SessionProvider>
  );
}
