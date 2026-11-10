"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

import { api } from "@/lib/api";
import type { SocialAccount } from "@/lib/types";

import { useSession } from "./session";
import { Button, ErrorText, Spinner } from "./ui";

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-5" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-5" aria-hidden>
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function YouTubeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-5" aria-hidden>
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

const PLATFORMS = [
  {
    id: "instagram",
    name: "Instagram",
    icon: InstagramIcon,
    note: "Business or Creator accounts",
    envKeys: ["META_APP_ID", "META_APP_SECRET", "INSTAGRAM_CONFIG_ID"],
  },
  {
    id: "facebook",
    name: "Facebook Pages",
    icon: FacebookIcon,
    note: "The Pages you manage",
    envKeys: ["META_APP_ID", "META_APP_SECRET"],
  },
  {
    id: "youtube",
    name: "YouTube",
    icon: YouTubeIcon,
    note: "Your channel, through Google sign-in",
    envKeys: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  },
] as const;

type State = "live" | "warn" | "ready" | "off";

const BRAND: Record<string, { glyph: string; glow: string }> = {
  instagram: {
    glyph: "bg-[linear-gradient(135deg,#feda75,#fa7e1e_30%,#d62976_60%,#962fbf_85%,#4f5bd5)] text-white",
    glow: "bg-[radial-gradient(60%_60%_at_20%_0%,rgb(214_41_118/0.22),transparent_70%)]",
  },
  facebook: {
    glyph: "bg-[#1877f2] text-white",
    glow: "bg-[radial-gradient(60%_60%_at_20%_0%,rgb(24_119_242/0.22),transparent_70%)]",
  },
  youtube: {
    glyph: "bg-[#ff0033] text-white",
    glow: "bg-[radial-gradient(60%_60%_at_20%_0%,rgb(255_0_51/0.18),transparent_70%)]",
  },
};

function Avatar({ src, size = "size-7" }: { src: string; size?: string }) {
  if (!src) return <div className={`${size} shrink-0 rounded-full bg-panel-2 ring-2 ring-panel`} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className={`${size} shrink-0 rounded-full object-cover ring-2 ring-panel`} />;
}

function StatusDot({ state, setup }: { state: State; setup?: boolean }) {
  if (state === "live")
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-accent">
        <span className="relative flex size-1.5">
          <span className="absolute inset-0 animate-ping-soft rounded-full bg-accent" />
          <span className="relative size-1.5 rounded-full bg-accent" />
        </span>
        Connected
      </span>
    );
  if (state === "warn") return <span className="text-xs font-medium text-warn">Reconnect needed</span>;
  if (state === "off") return <span className="text-xs text-mute">{setup ? "Needs setup" : "Unavailable"}</span>;
  return <span className="text-xs text-mute">Not connected</span>;
}

export function PluginRows({
  accounts,
  configured,
  canManage,
  compact = false,
  showSetup = false,
  onDisconnect,
  footer,
}: {
  accounts: SocialAccount[];
  configured: Record<string, boolean>;
  canManage: boolean;
  compact?: boolean;
  showSetup?: boolean;
  onDisconnect?: (account: SocialAccount) => void;
  footer?: ReactNode;
}) {
  const rows = PLATFORMS.map((platform) => {
    const mine = accounts.filter((a) => a.platform === platform.id);
    const live = mine.some((a) => a.status === "active");
    const needsReconnect = mine.some((a) => a.status === "needs_reconnect");
    const available = Boolean(configured[platform.id]) || mine.length > 0;
    const state: State = needsReconnect ? "warn" : live ? "live" : available ? "ready" : "off";
    return { ...platform, mine, live, needsReconnect, available, state };
  });

  const liveCount = rows.filter((r) => r.live).length;
  const nextToConnect = rows.findIndex((r) => r.available && r.mine.length === 0);
  const missing = rows.filter((r) => !configured[r.id]);
  const connect = (id: string) => window.location.assign(api.connectUrl(id));
  const label = (r: (typeof rows)[number]) => (r.needsReconnect ? "Reconnect" : r.mine.length ? "Add another" : "Connect");

  if (compact) {
    return (
      <div className="space-y-2">
        {rows.map((row, i) => {
          const Icon = row.icon;
          return (
            <div key={row.id} className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3">
              <div className={`grid size-9 shrink-0 place-items-center rounded-xl ${row.available ? BRAND[row.id].glyph : "bg-panel-2 text-mute"}`}>
                <Icon />
              </div>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${row.available ? "text-ink" : "text-mute"}`}>{row.name}</p>
                <StatusDot state={row.state} />
              </div>
              {row.available && canManage && (
                <Button
                  className="shrink-0"
                  variant={row.needsReconnect || i === nextToConnect ? "primary" : "secondary"}
                  onClick={() => connect(row.id)}
                >
                  {label(row)}
                </Button>
              )}
            </div>
          );
        })}
        {footer}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center gap-4">
        <div className="flex gap-1" aria-hidden>
          {rows.map((r) => (
            <span
              key={r.id}
              className={`h-1.5 w-8 rounded-full transition-colors ${
                r.live ? "bg-accent shadow-[0_0_10px_rgb(214_255_61/0.6)]" : r.needsReconnect ? "bg-warn" : "bg-white/10"
              }`}
            />
          ))}
        </div>
        <p className="text-sm text-mute">
          {liveCount === 0 ? "No channels connected yet" : `${liveCount} of ${rows.length} channels connected`}
        </p>
      </div>

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row, i) => {
          const Icon = row.icon;
          const primary = row.needsReconnect || i === nextToConnect;
          return (
            <li
              key={row.id}
              className={`relative flex flex-col overflow-hidden rounded-3xl border p-5 ${
                row.state === "off"
                  ? "border-dashed border-white/10 bg-transparent"
                  : row.state === "warn"
                    ? "glass border-warn/40!"
                    : row.state === "live"
                      ? "glass border-accent/30!"
                      : "glass"
              }`}
            >
              {row.available && <div aria-hidden className={`pointer-events-none absolute inset-0 ${BRAND[row.id].glow}`} />}

              <div className="relative flex items-start justify-between gap-3">
                <div
                  className={`grid size-12 place-items-center rounded-2xl [&_svg]:size-6 ${
                    row.available ? `${BRAND[row.id].glyph} shadow-lg shadow-black/40` : "border border-dashed border-white/15 text-mute"
                  }`}
                >
                  <Icon />
                </div>
                <StatusDot state={row.state} setup={showSetup} />
              </div>

              <div className="relative mt-5">
                <h2 className={`text-base font-semibold tracking-tight ${row.available ? "text-ink" : "text-mute"}`}>{row.name}</h2>
                <p className="mt-1 text-sm text-mute">{row.note}</p>
              </div>

              {row.mine.length > 0 && (
                <ul className="relative mt-4 space-y-1">
                  {row.mine.map((a) => (
                    <li key={a.id} className="group flex items-center gap-2.5 rounded-xl bg-black/25 px-2.5 py-2">
                      <Avatar src={a.avatarUrl} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{a.displayName || a.handle}</p>
                        {a.displayName && a.handle && <p className="truncate text-xs text-mute">{a.handle}</p>}
                      </div>
                      {a.status === "needs_reconnect" && <span className="size-1.5 shrink-0 rounded-full bg-warn" title="Reconnect needed" />}
                      {canManage && onDisconnect && (
                        <button
                          onClick={() => onDisconnect(a)}
                          className="shrink-0 rounded-md px-1.5 py-1 text-xs text-mute opacity-0 transition group-hover:opacity-100 hover:text-bad focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-accent max-sm:opacity-100"
                        >
                          Disconnect
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <div className="relative mt-auto pt-6">
                {!row.available ? (
                  <p className="text-xs text-mute">
                    {showSetup ? (
                      <>
                        Add <span className="font-mono text-ink/80">{row.envKeys.join(", ")}</span> to backend/.env
                      </>
                    ) : (
                      "Not available yet"
                    )}
                  </p>
                ) : canManage ? (
                  <Button className="w-full" variant={primary ? "primary" : "secondary"} onClick={() => connect(row.id)}>
                    {label(row)}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {!canManage && <p className="mt-5 text-xs text-mute">Ask an admin to connect or remove channels.</p>}

      {showSetup && missing.length > 0 && (
        <details className="mt-8 rounded-2xl border border-white/[0.06] px-4 py-3 text-xs text-mute">
          <summary className="cursor-pointer select-none">Developer setup for {missing.map((r) => r.name).join(", ")}</summary>
          <p className="mt-3">Add these to backend/.env, then restart the API.</p>
          <ul className="mt-2 space-y-1 font-mono text-[11px] leading-5">
            {missing.map((r) => (
              <li key={r.id} className="break-words">
                {r.envKeys.join(", ")}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="mt-4">{footer}</div>
    </div>
  );
}

export function PluginList({ compact = false }: { compact?: boolean }) {
  const { can } = useSession();
  const [accounts, setAccounts] = useState<SocialAccount[] | null>(null);
  const [configured, setConfigured] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.social();
      setAccounts(data.accounts);
      setConfigured(data.configured);
    } catch (e) {
      setError(e);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    load();
  }, [load]);

  async function disconnect(account: SocialAccount) {
    if (!confirm(`Disconnect ${account.displayName || account.handle}?`)) return;
    try {
      await api.disconnect(account.id);
      await load();
    } catch (e) {
      setError(e);
    }
  }

  if (!accounts) return error ? <ErrorText error={error} /> : <Spinner />;

  return (
    <PluginRows
      accounts={accounts}
      configured={configured}
      canManage={can("admin")}
      compact={compact}
      showSetup={process.env.NODE_ENV === "development" && can("admin")}
      onDisconnect={disconnect}
      footer={<ErrorText error={error} />}
    />
  );
}
