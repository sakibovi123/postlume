"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { api, ApiError, getActiveOrg, setActiveOrg } from "@/lib/api";
import type { Me, Role } from "@/lib/types";

interface Session {
  me: Me;
  credits: number | null;
  refresh: () => Promise<void>;
  refreshCredits: () => Promise<void>;
  can: (role: Role) => boolean;
  switchOrg: (id: number) => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);
const RANK: Record<Role, number> = { viewer: 0, creator: 1, admin: 2, owner: 3 };

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}

export function SessionProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [credits, setCredits] = useState<number | null>(null);

  const refreshCredits = useCallback(async () => {
    try {
      setCredits((await api.billing()).creditsBalance);
    } catch {
      setCredits(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await api.me();
      const stored = getActiveOrg();
      if (data.activeOrganization && stored !== String(data.activeOrganization.id)) setActiveOrg(data.activeOrganization.id);
      setMe(data);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        router.replace("/login");
        return;
      }
      if (e instanceof ApiError && e.status === 404) {
        setActiveOrg(null);
        router.replace("/login");
        return;
      }
      throw e;
    }
  }, [router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    refresh();
    refreshCredits();
    const onCredits = () => refreshCredits();
    window.addEventListener("taleloop:credits", onCredits);
    return () => window.removeEventListener("taleloop:credits", onCredits);
  }, [refresh, refreshCredits]);

  const switchOrg = useCallback(
    async (id: number) => {
      setActiveOrg(id);
      setMe(await api.switchOrg(id));
      await refreshCredits();
      router.push("/studio");
    },
    [router, refreshCredits],
  );

  if (!me) return <>{fallback}</>;
  const role = me.activeOrganization?.role ?? "viewer";
  const can = (min: Role) => RANK[role] >= RANK[min];
  return (
    <SessionContext.Provider value={{ me, credits, refresh, refreshCredits, can, switchOrg }}>{children}</SessionContext.Provider>
  );
}
