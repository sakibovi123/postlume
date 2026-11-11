"use client";

import { Building2, Check, Copy, Crown, Eye, Link2, Mail, Shield, Sparkles, Trash2, UserPlus, Users } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { useSession } from "@/components/session";
import { Button, Card, cx, ErrorText, Input, PageHeader, Select } from "@/components/ui";
import { api } from "@/lib/api";
import type { Members, Role } from "@/lib/types";

const ROLES: Record<Role, { label: string; help: string; icon: typeof Crown; tone: string }> = {
  owner: { label: "Owner", help: "Everything, including billing and owners", icon: Crown, tone: "text-accent bg-accent/10 border-accent/30" },
  admin: { label: "Admin", help: "Manage team, plugins and plan", icon: Shield, tone: "text-hot bg-hot/10 border-hot/30" },
  creator: { label: "Creator", help: "Chat, write stories and render videos", icon: Sparkles, tone: "text-accent-2 bg-accent-2/10 border-accent-2/30" },
  viewer: { label: "Viewer", help: "View projects and videos", icon: Eye, tone: "text-mute bg-white/[0.06] border-white/10" },
};
const ASSIGNABLE: Role[] = ["admin", "creator", "viewer"];

const AVATAR_GRADIENTS = [
  "from-[#9ff5e4] to-[#38b6ff]",
  "from-[#ffb199] to-[#ff7a59]",
  "from-[#7dd3fc] to-[#a78bfa]",
  "from-[#fcd34d] to-[#fb923c]",
  "from-[#86efac] to-[#22d3ee]",
  "from-[#f9a8d4] to-[#c084fc]",
];

function Avatar({ seed, label, dashed }: { seed: string; label: string; dashed?: boolean }) {
  if (dashed) {
    return (
      <div className="grid size-10 shrink-0 place-items-center rounded-full border border-dashed border-white/20 text-mute">
        <Mail className="size-4" />
      </div>
    );
  }
  const hash = [...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return (
    <div
      className={cx(
        "grid size-10 shrink-0 place-items-center rounded-full bg-gradient-to-br text-sm font-semibold text-black/80",
        AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length],
      )}
    >
      {label.slice(0, 1).toUpperCase()}
    </div>
  );
}

function RolePill({ role }: { role: Role }) {
  const { label, icon: Icon, tone } = ROLES[role];
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium", tone)}>
      <Icon className="size-3.5" />
      {label}
    </span>
  );
}

function SectionTitle({ icon: Icon, title, subtitle, aside }: { icon: typeof Crown; title: string; subtitle?: string; aside?: ReactNode }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.04]">
          <Icon className="size-4 text-accent" />
        </div>
        <div>
          <h2 className="font-medium leading-tight">{title}</h2>
          {subtitle && <p className="mt-1 text-xs text-mute">{subtitle}</p>}
        </div>
      </div>
      {aside}
    </div>
  );
}

function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
        copied ? "border-ok/40 bg-ok/10 text-ok" : "border-white/10 bg-white/[0.04] text-ink hover:border-accent/40 hover:text-accent",
      )}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}

function RowSkeleton() {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="skeleton size-10 rounded-full" />
      <div className="flex-1 space-y-2">
        <div className="skeleton h-3 w-32 rounded" />
        <div className="skeleton h-2.5 w-48 rounded" />
      </div>
    </div>
  );
}

export default function TeamPage() {
  const { me, can, switchOrg } = useSession();
  const [data, setData] = useState<Members | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("creator");
  const [newOrg, setNewOrg] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [justInvited, setJustInvited] = useState<{ email: string; token: string } | null>(null);

  const load = useCallback(() => api.members().then(setData).catch(setError), []);
  useEffect(() => {
    load();
  }, [load]);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  const inviteLink = (token: string) => `${window.location.origin}/invite/${token}`;
  const isAdmin = can("admin");
  const pending = data?.invitations ?? [];

  return (
    <div className="w-full space-y-6">
      <PageHeader
        title="Team"
        subtitle={`Manage who has access to ${me.activeOrganization?.name ?? "your studio"}.`}
        actions={
          data && (
            <div className="flex gap-2">
              <Stat value={data.members.length} label={data.members.length === 1 ? "member" : "members"} />
              {pending.length > 0 && <Stat value={pending.length} label="pending" />}
            </div>
          )
        }
      />
      <ErrorText error={error} />

      {isAdmin && (
        <Card className="relative overflow-hidden">
          <div className="pointer-events-none absolute -right-20 -top-24 size-64 rounded-full bg-accent/10 blur-3xl" />
          <SectionTitle icon={UserPlus} title="Invite a teammate" subtitle="They'll join with the role you pick below." />
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              run("invite", async () => {
                const res = await api.invite(email, role);
                setJustInvited({ email: res.email, token: res.token });
                setEmail("");
              });
            }}
          >
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-mute" />
              <Input type="email" required placeholder="teammate@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className="pl-10" />
            </div>

            <div role="radiogroup" aria-label="Role" className="grid gap-2 sm:grid-cols-3">
              {ASSIGNABLE.map((r) => {
                const { label, help, icon: Icon } = ROLES[r];
                const active = role === r;
                return (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setRole(r)}
                    className={cx(
                      "rounded-2xl border p-3 text-left transition",
                      active ? "border-accent/60 bg-accent/[0.07] ring-4 ring-accent/10" : "border-white/[0.08] bg-white/[0.02] hover:border-white/20",
                    )}
                  >
                    <span className={cx("flex items-center gap-2 text-sm font-medium", active ? "text-accent" : "text-ink")}>
                      <Icon className="size-4" />
                      {label}
                      {active && <Check className="ml-auto size-3.5" />}
                    </span>
                    <span className="mt-1 block text-xs leading-snug text-mute">{help}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-1.5 text-xs text-mute">
                <Link2 className="size-3.5" />
                You&apos;ll get a link to share. Email delivery is coming soon.
              </p>
              <Button variant="primary" loading={busy === "invite"}>
                <UserPlus className="size-4" />
                Create invite
              </Button>
            </div>
          </form>

          {justInvited && (
            <div className="mt-5 flex animate-fade-up flex-wrap items-center gap-3 rounded-2xl border border-ok/30 bg-ok/[0.06] p-3">
              <div className="grid size-8 place-items-center rounded-full bg-ok/15 text-ok">
                <Check className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm">Invite ready for {justInvited.email}</p>
                <p className="truncate font-mono text-xs text-mute">{inviteLink(justInvited.token)}</p>
              </div>
              <CopyLinkButton url={inviteLink(justInvited.token)} />
            </div>
          )}
        </Card>
      )}

      <Card>
        <SectionTitle icon={Users} title="Members" subtitle="People with access to this studio." />
        {!data ? (
          <div className="divide-y divide-white/[0.06]">
            <RowSkeleton />
            <RowSkeleton />
          </div>
        ) : (
          <ul className="-mx-2">
            {data.members.map((m) => {
              const isMe = m.userId === me.user.id;
              const editable = isAdmin && m.role !== "owner" && !isMe;
              return (
                <li key={m.id} className="group flex flex-wrap items-center gap-3 rounded-2xl px-2 py-2.5 transition hover:bg-white/[0.03]">
                  <Avatar seed={m.email} label={m.name || m.email} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-sm font-medium">
                      {m.name || m.email.split("@")[0]}
                      {isMe && <span className="rounded-full bg-white/[0.08] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-mute">You</span>}
                    </p>
                    <p className="truncate text-xs text-mute">{m.email}</p>
                  </div>
                  {editable ? (
                    <div className="flex items-center gap-1">
                      <Select
                        className="w-32 !py-1.5"
                        value={m.role}
                        onChange={(e) => run(`role-${m.id}`, () => api.updateMember(m.id, e.target.value))}
                        disabled={busy !== null}
                      >
                        {ASSIGNABLE.map((r) => (
                          <option key={r} value={r}>
                            {ROLES[r].label}
                          </option>
                        ))}
                      </Select>
                      <button
                        className="grid size-8 place-items-center rounded-full text-mute opacity-60 transition hover:bg-bad/10 hover:text-bad group-hover:opacity-100"
                        title={`Remove ${m.email}`}
                        aria-label={`Remove ${m.email}`}
                        onClick={() => confirm(`Remove ${m.email} from the team?`) && run(`remove-${m.id}`, () => api.removeMember(m.id))}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  ) : (
                    <RolePill role={m.role} />
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {isAdmin && pending.length > 0 && (
          <div className="mt-5 border-t border-white/[0.06] pt-5">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-mute">Pending invites</p>
            <ul className="-mx-2">
              {pending.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 rounded-2xl px-2 py-2.5 hover:bg-white/[0.03]">
                  <Avatar seed={i.email} label={i.email} dashed />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{i.email}</p>
                    <p className="text-xs text-mute">Waiting to accept</p>
                  </div>
                  <RolePill role={i.role} />
                  {i.token && <CopyLinkButton url={inviteLink(i.token)} />}
                </li>
              ))}
            </ul>
          </div>
        )}

        {data && data.members.length === 1 && pending.length === 0 && isAdmin && (
          <p className="mt-4 rounded-2xl border border-dashed border-white/10 p-4 text-center text-sm text-mute">
            It&apos;s just you for now. Invite a teammate above to collaborate.
          </p>
        )}
      </Card>

      <Card>
        <SectionTitle icon={Building2} title="New organization" subtitle="Spin up a separate studio with its own team, projects and billing." />
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run("org", async () => {
              const res = await api.createOrg(newOrg);
              setNewOrg("");
              const newest = res.organizations.reduce((a, b) => (b.id > a.id ? b : a));
              await switchOrg(newest.id);
            });
          }}
        >
          <Input required placeholder="Studio name" value={newOrg} onChange={(e) => setNewOrg(e.target.value)} className="min-w-56 flex-1" />
          <Button loading={busy === "org"}>Create & switch</Button>
        </form>
      </Card>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="glass rounded-2xl px-4 py-2 text-center">
      <p className="text-lg font-semibold leading-none">{value}</p>
      <p className="mt-1 text-[11px] uppercase tracking-wider text-mute">{label}</p>
    </div>
  );
}
