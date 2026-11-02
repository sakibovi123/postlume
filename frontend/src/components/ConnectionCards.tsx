"use client";

import { Camera, Flag, Play } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { SocialAccount } from "@/lib/types";

import { useSession } from "./session";
import { Badge, Button, Card, ErrorText, Spinner } from "./ui";

const PLATFORMS = [
  {
    id: "instagram",
    name: "Instagram",
    icon: Camera,
    note: "Business or Creator accounts only.",
  },
  { id: "facebook", name: "Facebook Page", icon: Flag, note: "Connect the Pages you manage." },
  { id: "youtube", name: "YouTube", icon: Play, note: "Your channel, via Google sign-in." },
] as const;

export function ConnectionCards({ compact = false }: { compact?: boolean }) {
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

  async function disconnect(id: number) {
    if (!confirm("Disconnect this account?")) return;
    try {
      await api.disconnect(id);
      await load();
    } catch (e) {
      setError(e);
    }
  }

  if (!accounts) return error ? <ErrorText error={error} /> : <Spinner />;

  return (
    <div className={compact ? "grid gap-3 md:grid-cols-3" : "grid gap-4 lg:grid-cols-3"}>
      {PLATFORMS.map(({ id, name, icon: Icon, note }) => {
        const mine = accounts.filter((a) => a.platform === id);
        const needsReconnect = mine.some((a) => a.status === "needs_reconnect");
        return (
          <Card key={id} className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-medium">
                <Icon className="size-5" /> {name}
              </div>
              {mine.length > 0 && (needsReconnect ? <Badge tone="warn">Reconnect needed</Badge> : <Badge tone="ok">Connected</Badge>)}
            </div>
            <p className="text-xs text-mute">{note}</p>
            {mine.length > 0 && (
              <ul className="space-y-2">
                {mine.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 rounded-lg border border-line bg-bg p-2">
                    {a.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.avatarUrl} alt="" className="size-8 rounded-full object-cover" />
                    ) : (
                      <div className="size-8 rounded-full bg-panel-2" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{a.displayName || a.handle}</p>
                      <p className="truncate text-xs text-mute">{a.handle}</p>
                    </div>
                    {can("admin") && !compact && (
                      <button onClick={() => disconnect(a.id)} className="text-xs text-mute hover:text-bad">
                        Disconnect
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-auto">
              {can("admin") ? (
                <a href={api.connectUrl(id)}>
                  <Button className="w-full" variant={mine.length ? "secondary" : "primary"}>
                    {needsReconnect ? "Reconnect" : mine.length ? "Connect another" : "Connect"}
                  </Button>
                </a>
              ) : (
                <p className="text-xs text-mute">Ask an admin to connect accounts.</p>
              )}
              {!configured[id] && (
                <p className="mt-2 text-xs text-warn">OAuth keys for {name} aren&apos;t set in backend/.env yet.</p>
              )}
            </div>
          </Card>
        );
      })}
      <ErrorText error={error} />
    </div>
  );
}
