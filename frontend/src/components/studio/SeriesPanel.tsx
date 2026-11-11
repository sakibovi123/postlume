"use client";

import { Clapperboard, Film, MessageSquareText, PenLine, Play, ScrollText, Sparkles, Wand2 } from "lucide-react";
import { useState } from "react";

import { Orb } from "@/components/fx";
import { useSession } from "@/components/session";
import { VideoPanel } from "@/components/studio/VideoPanel";
import { Badge, Button, Card, cx } from "@/components/ui";
import { aspectClass, isActive, StatusBadge } from "@/components/video-bits";
import type { Billing, ProjectDetail, Story, StylesInfo, Video } from "@/lib/types";

type Episode = { n: number; title: string; synopsis: string; story?: Story; video?: Video };

function episodesOf(project: ProjectDetail): Episode[] {
  const series = project.series;
  const outline = series?.outline?.episodes ?? [];
  const count = series?.episodeCount ?? Math.max(0, ...project.stories.map((s) => s.episode));
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    const story = project.stories.find((s) => s.episode === n);
    const video = project.videos.find((v) => v.episode === n);
    return { n, title: story?.title ?? outline[i]?.title ?? `Episode ${n}`, synopsis: story?.synopsis || outline[i]?.synopsis || "", story, video };
  });
}

export function SeriesEmpty({ onSend }: { onSend: (text: string) => void }) {
  const { can } = useSession();
  const steps = [
    { icon: MessageSquareText, title: "Describe it", text: "Genre, idea, how many episodes and how long." },
    { icon: PenLine, title: "Every episode written", text: "One story arc, the same characters throughout." },
    { icon: Clapperboard, title: "Videos made for you", text: "All at once or one at a time, your call." },
    { icon: Wand2, title: "Edit by chatting", text: "\"Cut scene 2\", \"darker music\", \"add a door creak\"." },
  ];
  return (
    <div className="relative grid min-h-full place-items-center overflow-hidden">
      <div className="bg-grid pointer-events-none absolute inset-0" />
      <div className="relative flex flex-col items-center px-4 py-10 text-center">
        <Orb icon={Sparkles} size="md" />
        <h2 className="mt-6 text-2xl font-semibold tracking-tight">Your creative partner is ready</h2>
        <p className="mt-2 max-w-md text-sm text-mute">
          Chat with Lumen on the left. It plans the series, writes every episode, renders the videos and edits them
          whenever you ask.
        </p>
        <div className="mt-8 grid w-full max-w-3xl gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <div key={s.title} className="animate-fade-up rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 text-left" style={{ animationDelay: `${i * 80}ms` }}>
              <div className="mb-3 flex items-center gap-2">
                <span className="grid size-6 place-items-center rounded-full bg-accent/15 text-[11px] font-bold text-accent">{i + 1}</span>
                <s.icon className="size-4 text-mute" />
              </div>
              <p className="text-sm font-medium">{s.title}</p>
              <p className="mt-1 text-xs leading-snug text-mute">{s.text}</p>
            </div>
          ))}
        </div>
        {can("creator") && (
          <Button variant="primary" className="mt-8" onClick={() => onSend("I need a horror story with 5 episodes, 60 seconds each")}>
            <Wand2 className="size-4" /> Try: a 5-episode horror story
          </Button>
        )}
      </div>
    </div>
  );
}

function EpisodeCard({ ep, active, writing, onClick }: { ep: Episode; active: boolean; writing: boolean; onClick: () => void }) {
  const v = ep.video;
  return (
    <button
      onClick={onClick}
      className={cx(
        "group flex w-60 shrink-0 items-center gap-3 rounded-2xl border p-2.5 text-left transition",
        active ? "border-accent/50 bg-accent/[0.06] ring-4 ring-accent/10" : "border-white/[0.07] bg-white/[0.02] hover:border-white/20",
      )}
    >
      <div className="relative size-14 shrink-0 overflow-hidden rounded-xl bg-white/[0.04]">
        {v?.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={v.thumbnailUrl} alt="" className="size-full object-cover" />
        ) : (
          <div className="grid size-full place-items-center bg-linear-to-br from-white/[0.07] to-transparent text-lg font-semibold text-mute">{ep.n}</div>
        )}
        {v?.status === "ready" && (
          <span className="absolute inset-0 grid place-items-center bg-black/30 opacity-0 transition group-hover:opacity-100">
            <Play className="size-4 fill-white text-white" />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-mute">Episode {ep.n}</p>
        <p className="truncate text-sm font-medium">{ep.title}</p>
        <div className="mt-1 flex items-center gap-2">
          {v ? (
            <StatusBadge status={v.status} />
          ) : ep.story ? (
            <Badge tone="ok">Written</Badge>
          ) : writing ? (
            <span className="text-shimmer text-xs font-medium">Writing…</span>
          ) : (
            <Badge>Planned</Badge>
          )}
        </div>
        {v && isActive(v.status) && v.status !== "waiting" && (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="accent-gradient h-full rounded-full transition-all duration-700" style={{ width: `${Math.max(4, v.progress)}%` }} />
          </div>
        )}
      </div>
    </button>
  );
}

export function SeriesPanel({
  project,
  styles,
  billing,
  onVideoChange,
  onReload,
  onSend,
}: {
  project: ProjectDetail;
  styles: StylesInfo;
  billing: Billing | null;
  onVideoChange: (v: Video) => void;
  onReload: () => void;
  onSend: (text: string) => void;
}) {
  const { can } = useSession();
  const series = project.series!;
  const episodes = episodesOf(project);
  const writingTask = project.tasks.find((t) => t.kind === "series");
  const firstWithVideo = episodes.find((e) => e.video && isActive(e.video.status)) ?? episodes.find((e) => e.video) ?? episodes[0];
  const [picked, setPicked] = useState<number | null>(null);
  const [tab, setTab] = useState<"video" | "script">("video");
  const current = episodes.find((e) => e.n === (picked ?? firstWithVideo?.n)) ?? episodes[0];
  const brief = project.briefs[0];
  const aspect = brief?.aspectRatio ?? "9:16";
  const outline = series.outline;
  const readyCount = episodes.filter((e) => e.video?.status === "ready").length;
  const writtenCount = episodes.filter((e) => e.story).length;
  const doneWriting = (writingTask?.partial.done as number[] | undefined)?.length ?? 0;
  const totalWriting = (writingTask?.partial.total as number | undefined) ?? series.episodeCount;

  return (
    <div className="space-y-5">
      <Card className="relative overflow-hidden">
        <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-accent/10 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">{series.episodeCount > 1 ? "Series" : "Story"}</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">{series.title}</h2>
            {outline?.logline && <p className="mt-2 text-sm leading-relaxed text-mute">{outline.logline}</p>}
            <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
              <Badge>
                {series.episodeCount} episode{series.episodeCount > 1 ? "s" : ""}
              </Badge>
              <Badge>{series.episodeSeconds}s each</Badge>
              {brief && <Badge>{styles.presets.find((p) => p.id === brief.stylePreset)?.label ?? brief.stylePreset}</Badge>}
              {brief && <Badge>{brief.aspectRatio}</Badge>}
              {brief && <Badge>{brief.genre.charAt(0).toUpperCase() + brief.genre.slice(1)}</Badge>}
            </div>
          </div>
          <div className="flex gap-2">
            <Stat value={`${writtenCount}/${series.episodeCount}`} label="written" />
            <Stat value={`${readyCount}/${series.episodeCount}`} label="videos" />
          </div>
        </div>
        {outline && outline.characters.length > 0 && (
          <div className="relative mt-5 flex flex-wrap gap-2 border-t border-white/[0.06] pt-4">
            {outline.characters.map((c) => (
              <span key={c.name} title={c.visualDescription} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] py-1 pl-1 pr-3 text-xs">
                <span className="grid size-6 place-items-center rounded-full bg-linear-to-br from-accent/60 to-hot/50 text-[11px] font-bold text-black">{c.name[0]}</span>
                <span className="font-medium">{c.name}</span>
                <span className="text-mute">{c.role}</span>
              </span>
            ))}
          </div>
        )}
        {writingTask && (
          <div className="relative mt-5 rounded-2xl border border-accent/20 bg-accent/[0.04] p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-shimmer font-medium">{writingTask.stage === "outline" ? "Planning the season…" : `Writing episodes · ${doneWriting}/${totalWriting}`}</span>
              <span className="tabular-nums text-mute">{writingTask.progress}%</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div className="accent-gradient h-full rounded-full transition-all duration-700" style={{ width: `${Math.max(3, writingTask.progress)}%` }} />
            </div>
          </div>
        )}
      </Card>

      <div className="space-y-5">
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
          {episodes.map((ep) => (
            <EpisodeCard key={ep.n} ep={ep} active={ep.n === current?.n} writing={!!writingTask} onClick={() => setPicked(ep.n)} />
          ))}
        </div>

        {current && (
          <div key={current.n} className="min-w-0 animate-fade-up space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mute">Episode {current.n}</p>
                <h3 className="truncate text-lg font-semibold">{current.title}</h3>
              </div>
              <div className="flex rounded-full border border-white/10 bg-white/[0.03] p-1 text-xs">
                {(["video", "script"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={cx("flex items-center gap-1.5 rounded-full px-3 py-1.5 font-medium capitalize transition", tab === t ? "bg-white/10 text-ink" : "text-mute hover:text-ink")}
                  >
                    {t === "video" ? <Film className="size-3.5" /> : <ScrollText className="size-3.5" />} {t}
                  </button>
                ))}
              </div>
            </div>

            {tab === "script" ? (
              <Card className="space-y-4">
                {current.synopsis && <p className="text-sm italic text-mute">{current.synopsis}</p>}
                {current.story ? (
                  <>
                    <p className="text-xs text-mute">
                      v{current.story.version} · {current.story.script.split(/\s+/).length} words · ~{current.story.estimatedSeconds}s
                    </p>
                    <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{current.story.script}</p>
                    {can("creator") && (
                      <div className="flex flex-wrap gap-2 border-t border-white/[0.06] pt-4">
                        {["Make it scarier", "Add a stronger cliffhanger", "Make it shorter"].map((s) => (
                          <button
                            key={s}
                            onClick={() => onSend(`Rewrite episode ${current.n}: ${s.toLowerCase()}`)}
                            className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-mute transition hover:border-accent/40 hover:text-ink"
                          >
                            <PenLine className="mr-1 inline size-3" /> {s}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-mute">{writingTask ? "This episode is being written…" : "Not written yet."}</p>
                )}
              </Card>
            ) : current.video ? (
              <VideoPanel key={current.video.id} videoId={current.video.id} styles={styles} billing={billing} onChange={onVideoChange} onDeleted={onReload} />
            ) : (
              <Card className="flex flex-col items-center gap-4 py-12 text-center">
                <div className={cx("grid w-28 place-items-center rounded-2xl border border-dashed border-white/15 text-mute", aspectClass(aspect))}>
                  <Clapperboard className="size-6" />
                </div>
                <div>
                  <p className="font-medium">No video yet</p>
                  <p className="mt-1 text-sm text-mute">
                    {current.story ? "Ask Lumen to make it, or start it here." : "Lumen will make it once the episode is written."}
                  </p>
                </div>
                {current.story && can("creator") && (
                  <Button variant="primary" onClick={() => onSend(`Start episode ${current.n}`)}>
                    <Clapperboard className="size-4" /> Make episode {current.n}
                  </Button>
                )}
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] px-4 py-2 text-center">
      <p className="text-lg font-semibold leading-none tabular-nums">{value}</p>
      <p className="mt-1 text-[11px] uppercase tracking-wider text-mute">{label}</p>
    </div>
  );
}
