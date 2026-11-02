"use client";

import { Clapperboard, Coins, Film, LogOut, Plug, Plus, Users, WandSparkles } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { api, setActiveOrg } from "@/lib/api";

import { SessionProvider, useSession } from "./session";
import { cx, PageLoading } from "./ui";

const NAV = [
  { href: "/studio", label: "Studio", icon: WandSparkles },
  { href: "/library", label: "Library", icon: Film },
  { href: "/settings/connections", label: "Connections", icon: Plug },
  { href: "/settings/team", label: "Team", icon: Users },
  { href: "/billing", label: "Billing", icon: Coins },
];

export function Logo() {
  return (
    <Link href="/studio" className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="accent-gradient grid size-8 place-items-center rounded-lg">
        <Clapperboard className="size-4 text-white" />
      </span>
      <span className="text-lg">taleloop</span>
    </Link>
  );
}

function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { me, credits, switchOrg, can } = useSession();

  async function logout() {
    await api.logout();
    setActiveOrg(null);
    router.replace("/login");
  }

  return (
    <aside className="flex w-full shrink-0 flex-col gap-6 border-b border-line bg-panel/60 p-4 md:sticky md:top-0 md:h-screen md:w-60 md:border-b-0 md:border-r">
      <Logo />
      {can("creator") && (
        <Link
          href="/studio/new"
          className="accent-gradient flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white"
        >
          <Plus className="size-4" /> New video
        </Link>
      )}
      <nav className="flex flex-row flex-wrap gap-1 md:flex-col">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== "/studio" && pathname.startsWith(href)) || (href === "/studio" && pathname.startsWith("/studio"));
          return (
            <Link
              key={href}
              href={href}
              className={cx(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm",
                active ? "bg-panel-2 text-ink" : "text-mute hover:bg-panel-2 hover:text-ink",
              )}
            >
              <Icon className="size-4" /> {label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto space-y-3">
        <Link href="/billing" className="block rounded-lg border border-line bg-bg p-3">
          <p className="text-xs text-mute">Credits</p>
          <p className="text-xl font-semibold">{credits ?? "–"}</p>
        </Link>
        {me.organizations.length > 1 ? (
          <select
            value={me.activeOrganization?.id}
            onChange={(e) => switchOrg(Number(e.target.value))}
            className="w-full rounded-lg border border-line bg-bg px-2 py-1.5 text-sm"
          >
            {me.organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        ) : (
          <p className="truncate text-sm text-mute">{me.activeOrganization?.name}</p>
        )}
        <div className="flex items-center justify-between gap-2 text-xs text-mute">
          <span className="truncate">{me.user.email}</span>
          <button onClick={logout} className="rounded p-1 hover:bg-panel-2 hover:text-ink" title="Log out">
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SessionProvider fallback={<PageLoading />}>
      <div className="flex min-h-screen flex-col md:flex-row">
        <Sidebar />
        <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
      </div>
    </SessionProvider>
  );
}
