"use client";

import { Copy, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useSession } from "@/components/session";
import { Badge, Button, Card, ErrorText, Input, PageHeader, Select, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import type { Members } from "@/lib/types";

const ROLE_HELP = {
  owner: "Everything, including billing and owners",
  admin: "Manage team, connections and plan",
  creator: "Chat, write stories and render videos",
  viewer: "View projects and videos",
};

export default function TeamPage() {
  const { me, can, switchOrg } = useSession();
  const [data, setData] = useState<Members | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("creator");
  const [newOrg, setNewOrg] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.members().then(setData).catch(setError), []);
  useEffect(() => {
    load();
  }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const inviteLink = (token: string) => `${window.location.origin}/invite/${token}`;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Team" subtitle={me.activeOrganization?.name} />
      <ErrorText error={error} />
      <Card>
        <h2 className="mb-4 font-medium">Members</h2>
        {!data ? (
          <Spinner />
        ) : (
          <ul className="divide-y divide-line">
            {data.members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{m.name || m.email}</p>
                  <p className="truncate text-xs text-mute">{m.email}</p>
                </div>
                {can("admin") && m.role !== "owner" && m.userId !== me.user.id ? (
                  <>
                    <Select
                      className="w-32"
                      value={m.role}
                      onChange={(e) => run(() => api.updateMember(m.id, e.target.value))}
                      disabled={busy}
                    >
                      {["admin", "creator", "viewer"].map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </Select>
                    <button
                      className="text-mute hover:text-bad"
                      title="Remove"
                      onClick={() => confirm(`Remove ${m.email}?`) && run(() => api.removeMember(m.id))}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </>
                ) : (
                  <Badge tone={m.role === "owner" ? "accent" : "default"}>{m.role}</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {can("admin") && (
        <Card className="space-y-4">
          <h2 className="font-medium">Invite someone</h2>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => api.invite(email, role).then(() => setEmail("")));
            }}
          >
            <Input type="email" required placeholder="teammate@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className="min-w-56 flex-1" />
            <Select value={role} onChange={(e) => setRole(e.target.value)} className="w-32">
              {["admin", "creator", "viewer"].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </Select>
            <Button variant="primary" loading={busy}>
              Create invite
            </Button>
          </form>
          <p className="text-xs text-mute">{ROLE_HELP[role as keyof typeof ROLE_HELP]}. Email delivery isn&apos;t set up yet, so copy the link and send it yourself.</p>
          {data && data.invitations.length > 0 && (
            <ul className="space-y-2">
              {data.invitations.map((i) => (
                <li key={i.id} className="flex items-center gap-3 rounded-lg border border-line bg-bg p-2 text-sm">
                  <span className="flex-1 truncate">{i.email}</span>
                  <Badge>{i.role}</Badge>
                  {i.token && (
                    <button
                      className="flex items-center gap-1 text-xs text-coral"
                      onClick={() => navigator.clipboard.writeText(inviteLink(i.token!))}
                    >
                      <Copy className="size-3.5" /> Copy link
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card className="space-y-3">
        <h2 className="font-medium">Create another organization</h2>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const res = await api.createOrg(newOrg);
              setNewOrg("");
              const newest = res.organizations.reduce((a, b) => (b.id > a.id ? b : a));
              await switchOrg(newest.id);
            });
          }}
        >
          <Input required placeholder="New studio name" value={newOrg} onChange={(e) => setNewOrg(e.target.value)} />
          <Button loading={busy}>Create</Button>
        </form>
      </Card>
    </div>
  );
}
