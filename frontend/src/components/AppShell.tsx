"use client";

import { Bot, Coins, Film, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Plug, Plus, Sparkles, Users, WandSparkles, X, Zap } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import logoMark from "@/assets/postlume-mark.png";
import logoWordmark from "@/assets/postlume-wordmark.png";
import { api, setActiveOrg } from "@/lib/api";

import { SessionProvider, useSession } from "./session";
import { cx, PageLoading, Select } from "./ui";

const NAV = [
  { href: "/studio", label: "Create", icon: WandSparkles },
  { href: "/assistant", label: "Assistant", icon: Bot },
  { href: "/generate", label: "All models", icon: Sparkles },
  { href: "/library", label: "Library", icon: Film },
  { href: "/settings/plugins", label: "Plugins", icon: Plug },
  { href: "/settings/team", label: "Team", icon: Users },
  { href: "/billing", label: "Billing", icon: Coins },
];

const COLLAPSED_KEY = "postlume:sidebar-collapsed";

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {}
}

export function Logo({ compact = false, onClick }: { compact?: boolean; onClick?: () => void }) {
  return (
    <Link href="/studio" onClick={onClick} className="flex shrink-0 items-center gap-3">
      <Image src={logoMark} alt="Postlume" unoptimized priority className="h-8 w-auto" />
      <Image src={logoWordmark} alt="" unoptimized priority className={cx("h-8 w-auto", compact && "lg:hidden")} />
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
            <Select preserveCase value={me.activeOrganization?.id} onChange={(e) => switchOrg(Number(e.target.value))}>
              {me.organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
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

function Sidebar({
  collapsed,
  onToggle,
  drawerOpen,
  onCloseDrawer,
}: {
  collapsed: boolean;
  onToggle: () => void;
  drawerOpen: boolean;
  onCloseDrawer: () => void;
}) {
  const pathname = usePathname();

  return (
    <>
      {drawerOpen && <div onClick={onCloseDrawer} className="fixed inset-0 z-40 bg-black/60 lg:hidden" />}
      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-50 flex w-60 shrink-0 flex-col border-r border-white/[0.06] bg-bg transition-[width,translate] duration-200",
          "lg:sticky lg:top-0 lg:z-30 lg:h-screen lg:translate-x-0 lg:bg-bg/70 lg:backdrop-blur-xl",
          collapsed ? "lg:w-[72px]" : "lg:w-60",
          drawerOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className={cx("flex h-16 shrink-0 items-center justify-between px-5", collapsed && "lg:justify-center lg:px-0")}>
          <Logo compact={collapsed} onClick={onCloseDrawer} />
          <button onClick={onCloseDrawer} aria-label="Close menu" className="text-mute hover:text-ink lg:hidden">
            <X className="size-5" />
          </button>
        </div>
        <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 py-2">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={onCloseDrawer}
                title={collapsed ? label : undefined}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition",
                  collapsed && "lg:justify-center lg:px-0",
                  active ? "bg-white/[0.08] text-ink" : "text-mute hover:bg-white/[0.04] hover:text-ink",
                )}
              >
                <Icon className={cx("size-4 shrink-0", active && "text-accent")} />
                <span className={cx("truncate", collapsed && "lg:hidden")}>{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="hidden shrink-0 border-t border-white/[0.06] p-3 lg:block">
          <button
            onClick={onToggle}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cx(
              "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-mute transition hover:bg-white/[0.04] hover:text-ink",
              collapsed && "justify-center px-0",
            )}
          >
            {collapsed ? <PanelLeftOpen className="size-4 shrink-0" /> : <PanelLeftClose className="size-4 shrink-0" />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>
    </>
  );
}

function TopBar({ onOpenDrawer }: { onOpenDrawer: () => void }) {
  const { credits, can } = useSession();

  return (
    <header className="sticky top-0 z-20 border-b border-white/[0.06] bg-bg/70 backdrop-blur-xl">
      <div className="flex h-16 items-center gap-4 px-4 md:px-8">
        <button onClick={onOpenDrawer} aria-label="Open menu" className="text-mute hover:text-ink lg:hidden">
          <Menu className="size-5" />
        </button>
        <div className="lg:hidden">
          <Logo />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
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

function Shell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  function toggle() {
    writeCollapsed(!collapsed);
    setCollapsed(!collapsed);
  }

  return (
    <div className="bg-aurora flex min-h-screen">
      <Sidebar collapsed={collapsed} onToggle={toggle} drawerOpen={drawerOpen} onCloseDrawer={() => setDrawerOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onOpenDrawer={() => setDrawerOpen(true)} />
        <main className="mx-auto w-full min-w-0 max-w-[1500px] flex-1 px-4 py-6 md:px-8 md:py-10">{children}</main>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SessionProvider fallback={<PageLoading />}>
      <Shell>{children}</Shell>
    </SessionProvider>
  );
}
