"use client";

import { ArrowUp, Bot, Clapperboard, MessageSquareText, PenLine, Wand2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Orb } from "@/components/fx";
import { useSession } from "@/components/session";
import { Badge, Chip, ErrorText, Spinner } from "@/components/ui";
import { StatusBadge } from "@/components/video-bits";
import { api } from "@/lib/api";
import type { ProjectSummary } from "@/lib/types";

const STARTERS = [
  "I need a horror story with 5 episodes, 60 seconds each",
  "A cozy kids bedtime story, one 45 second video",
  "A 3-part sci-fi mystery for YouTube, 90 seconds each",
  "A motivational story about an old runner's last race",
];

function ago(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function AssistantHome() {
  const router = useRouter();
  const { can } = useSession();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);

  useEffect(() => {
    api
      .projects()
      .then((ps) => setProjects(ps.filter((p) => p.series || !p.latestVideo)))
      .catch((e) => (setError(e), setProjects([])));
  }, []);

  async function start(value = text) {
    const idea = value.trim();
    if (!idea || busy) return;
    setBusy(true);
    setError(null);
    try {
      const p = await api.createProject({ title: idea.slice(0, 60) });
      await api.sendMessage(p.id, idea);
      router.push(`/assistant/${p.id}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-12">
      {busy && (
        <div className="fixed inset-0 z-50 grid animate-fade-in place-items-center bg-bg/85 backdrop-blur-xl">
          <div className="flex flex-col items-center gap-6">
            <Orb icon={Bot} />
            <p className="text-shimmer text-xl font-semibold">Starting your conversation</p>
          </div>
        </div>
      )}

      <div className="animate-fade-up pt-4 text-center">
        <span className="accent-gradient mx-auto grid size-12 place-items-center rounded-2xl shadow-[0_8px_30px_-8px_rgb(214_255_61/0.6)]">
          <Bot className="size-6" />
        </span>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight md:text-5xl">
          Your AI <span className="text-gradient">content creator</span>
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-mute">
          Tell it what you want. It writes every episode, makes the videos and edits them when you ask, all in one chat.
        </p>
      </div>

      {can("creator") && (
        <div className="animate-fade-up space-y-4 [animation-delay:100ms]">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              start();
            }}
            className="rounded-[28px] bg-linear-to-br from-accent/40 via-white/10 to-hot/30 p-px transition focus-within:from-accent focus-within:to-hot/60"
          >
            <div className="flex items-end gap-3 rounded-[27px] bg-panel/95 p-4 backdrop-blur-xl md:p-5">
              <textarea
                rows={3}
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    start();
                  }
                }}
                placeholder="Hey assistant, I need a horror story…"
                className="min-h-20 flex-1 resize-none bg-transparent pt-1 text-base text-ink outline-none placeholder:text-mute/60 md:text-lg"
              />
              <button
                disabled={!text.trim() || busy}
                title="Send"
                className="accent-gradient grid size-11 shrink-0 place-items-center rounded-2xl transition hover:brightness-110 disabled:opacity-30"
              >
                <ArrowUp className="size-5" strokeWidth={2.5} />
              </button>
            </div>
          </form>
          <div className="flex flex-wrap justify-center gap-2">
            {STARTERS.map((s) => (
              <Chip key={s} onClick={() => start(s)} disabled={busy}>
                <Wand2 className="size-3.5 text-accent" /> {s}
              </Chip>
            ))}
          </div>
          <ErrorText error={error} />
        </div>
      )}

      <div className="grid animate-fade-up gap-3 [animation-delay:200ms] sm:grid-cols-3">
        {[
          { icon: MessageSquareText, title: "Chat your idea", text: "It asks for episodes and length if you don't say." },
          { icon: PenLine, title: "Full story written", text: "Every episode, with the same characters throughout." },
          { icon: Clapperboard, title: "Videos made and edited", text: "All at once or one by one. Edit by just asking." },
        ].map((s) => (
          <div key={s.title} className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
            <s.icon className="size-4 text-accent" />
            <p className="mt-3 text-sm font-medium">{s.title}</p>
            <p className="mt-1 text-xs leading-snug text-mute">{s.text}</p>
          </div>
        ))}
      </div>

      <div>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.14em] text-mute">Your conversations</h2>
        {!projects ? (
          <Spinner />
        ) : projects.length === 0 ? (
          <p className="rounded-3xl border border-dashed border-white/10 p-8 text-center text-sm text-mute">
            No conversations yet. Start one above.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {projects.map((p) => (
              <Link
                key={p.id}
                href={`/assistant/${p.id}`}
                className="group flex items-center gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3 transition hover:-translate-y-0.5 hover:border-accent/30"
              >
                <div className="size-14 shrink-0 overflow-hidden rounded-xl bg-white/[0.04]">
                  {p.latestVideo?.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.latestVideo.thumbnailUrl} alt="" className="size-full object-cover" />
                  ) : (
                    <div className="grid size-full place-items-center bg-linear-to-br from-accent/15 to-hot/10">
                      <Bot className="size-5 text-accent" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium group-hover:text-accent">{p.series?.title ?? p.title}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-mute">
                    {p.series ? (
                      <Badge>
                        {p.series.episodeCount} episode{p.series.episodeCount > 1 ? "s" : ""} · {p.series.episodeSeconds}s
                      </Badge>
                    ) : (
                      <Badge>Planning</Badge>
                    )}
                    {p.latestVideo && <StatusBadge status={p.latestVideo.status} />}
                    <span>{ago(p.updatedAt)}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
