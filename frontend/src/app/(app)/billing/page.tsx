"use client";

import { useEffect, useState } from "react";

import { useSession } from "@/components/session";
import { Badge, Button, Card, cx, ErrorText, PageHeader, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import type { Billing } from "@/lib/types";

const ACTION_LABEL: Record<string, string> = {
  story_generate: "Story",
  video_render: "Video render",
  scene_regenerate: "Scene regenerate",
  video_reassemble: "Re-assemble",
  grant: "Credits added",
  refund: "Refund",
};

export default function BillingPage() {
  const { can, refreshCredits } = useSession();
  const [data, setData] = useState<Billing | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    api.billing().then(setData).catch(setError);
  }, []);

  async function choose(plan: string) {
    setBusy(plan);
    try {
      setData(await api.switchPlan(plan));
      await refreshCredits();
    } catch (e) {
      setError(e);
    } finally {
      setBusy("");
    }
  }

  if (!data) return error ? <ErrorText error={error} /> : <Spinner />;
  const q = data.quotes;

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader title="Billing" subtitle="Credits are charged per generation and refunded automatically when a render fails on our side." />
      <ErrorText error={error} />
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <p className="text-sm text-mute">Credits balance</p>
          <p className="mt-1 text-3xl font-semibold">{data.creditsBalance}</p>
        </Card>
        <Card>
          <p className="text-sm text-mute">Current plan</p>
          <p className="mt-1 text-3xl font-semibold">{data.planInfo.name}</p>
        </Card>
        <Card>
          <p className="text-sm text-mute">Provider cost so far</p>
          <p className="mt-1 text-3xl font-semibold">${data.providerCostUsd.toFixed(2)}</p>
        </Card>
      </div>

      <div>
        <h2 className="mb-3 font-medium">Plans <Badge tone="warn">demo switch, no payment</Badge></h2>
        <div className="grid gap-4 md:grid-cols-3">
          {Object.entries(data.plans).map(([id, p]) => (
            <Card key={id} className={cx("flex flex-col gap-3", id === data.plan && "border-violet")}>
              <div className="flex items-center justify-between">
                <p className="font-medium">{p.name}</p>
                {id === data.plan && <Badge tone="accent">Current</Badge>}
              </div>
              <p className="text-2xl font-semibold">{p.monthly_credits} <span className="text-sm font-normal text-mute">credits / month</span></p>
              <ul className="space-y-1 text-sm text-mute">
                <li>Tiers: {p.tiers.join(", ")}</li>
                <li>Videos up to {p.max_seconds}s</li>
              </ul>
              {can("admin") && (
                <Button className="mt-auto" variant={id === data.plan ? "secondary" : "primary"} loading={busy === id} onClick={() => choose(id)}>
                  {id === data.plan ? "Add this month's credits" : `Switch to ${p.name}`}
                </Button>
              )}
            </Card>
          ))}
        </div>
      </div>

      <Card>
        <h2 className="mb-3 font-medium">What things cost</h2>
        <div className="grid gap-2 text-sm md:grid-cols-2">
          <p>Story or rewrite: <b>{q.story_generate}</b> credit</p>
          <p>Re-assemble (voice, music, captions): <b>{q.video_reassemble}</b> credit</p>
          {(["lite", "standard", "premium"] as const).map((t) => (
            <p key={t}>
              <span className="capitalize">{t}</span> video: <b>{q.video_render_per_10s[t]}</b> credits per 10s
            </p>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 font-medium">Usage</h2>
        {data.usage.length === 0 ? (
          <p className="text-sm text-mute">No usage yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-mute">
                <tr>
                  <th className="py-2 pr-4 font-normal">When</th>
                  <th className="py-2 pr-4 font-normal">Action</th>
                  <th className="py-2 pr-4 font-normal">Detail</th>
                  <th className="py-2 pr-4 text-right font-normal">Credits</th>
                  <th className="py-2 text-right font-normal">Provider cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.usage.map((u) => (
                  <tr key={u.id}>
                    <td className="py-2 pr-4 whitespace-nowrap text-mute">{new Date(u.createdAt).toLocaleString()}</td>
                    <td className="py-2 pr-4">{ACTION_LABEL[u.action] ?? u.action} {u.refunded && <Badge tone="warn">refunded</Badge>}</td>
                    <td className="py-2 pr-4 text-mute">{u.note}</td>
                    <td className={cx("py-2 pr-4 text-right font-mono", u.credits < 0 ? "text-coral" : "text-ok")}>
                      {u.credits > 0 ? `+${u.credits}` : u.credits}
                    </td>
                    <td className="py-2 text-right font-mono text-mute">${u.estimatedCostUsd.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
