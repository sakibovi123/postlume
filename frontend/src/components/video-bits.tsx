"use client";

import {
  AlertTriangle,
  AudioLines,
  Check,
  CheckCircle2,
  Clapperboard,
  Clock,
  Film,
  ImageIcon,
  Layers,
  Loader2,
  type LucideIcon,
  Users,
  Workflow,
} from "lucide-react";
import Link from "next/link";

import type { StylePreset, Video, VideoStatus } from "@/lib/types";

import { Orb } from "./fx";
import { Badge, cx } from "./ui";

export const PRESET_LOOK: Record<StylePreset, { gradient: string; emoji: string; blurb: string }> = {
  animated_3d: { gradient: "from-sky-500 via-indigo-500 to-fuchsia-500", emoji: "🧸", blurb: "Soft 3D film look, original characters" },
  cartoon: { gradient: "from-yellow-300 via-orange-400 to-rose-500", emoji: "🎨", blurb: "Bold outlines, bright flat colors" },
  anime_2d: { gradient: "from-pink-400 via-fuchsia-500 to-indigo-600", emoji: "🌸", blurb: "Cel shading, painted backgrounds" },
  anime_action: { gradient: "from-amber-300 via-orange-500 to-blue-700", emoji: "⚡", blurb: "Battle auras, speed lines, impact" },
  cinematic: { gradient: "from-teal-700 via-slate-800 to-orange-500", emoji: "🎬", blurb: "Live-action look, film grade" },
  storybook: { gradient: "from-emerald-300 via-lime-200 to-amber-300", emoji: "📖", blurb: "Watercolor, gentle and warm" },
  comic: { gradient: "from-red-500 via-orange-500 to-yellow-300", emoji: "💥", blurb: "Inked panels, halftone shading" },
  documentary: { gradient: "from-stone-500 via-zinc-700 to-slate-900", emoji: "🎞️", blurb: "Realistic, natural light" },
  custom: { gradient: "from-lime-300 via-emerald-500 to-cyan-600", emoji: "✨", blurb: "Describe your own style" },
};

export const STEPS: { id: VideoStatus; label: string; detail: string; icon: LucideIcon }[] = [
  { id: "queued", label: "Queued", detail: "Waiting for a render slot", icon: Loader2 },
  { id: "planning", label: "Planning scenes", detail: "Splitting the story into shots", icon: Workflow },
  { id: "references", label: "Casting characters", detail: "Locking each character's look", icon: Users },
  { id: "keyframes", label: "Painting keyframes", detail: "One image per scene", icon: ImageIcon },
  { id: "clips", label: "Animating clips", detail: "Bringing each frame to life", icon: Film },
  { id: "voice", label: "Recording voiceover", detail: "Narration and word timings", icon: AudioLines },
  { id: "assembling", label: "Final cut", detail: "Music, captions and edit", icon: Layers },
  { id: "ready", label: "Ready", detail: "", icon: Clapperboard },
];

export function isActive(status: VideoStatus) {
  return status !== "ready" && status !== "failed";
}

export function StatusBadge({ status }: { status: VideoStatus }) {
  if (status === "ready")
    return (
      <Badge tone="ok">
        <CheckCircle2 className="size-3" /> Ready
      </Badge>
    );
  if (status === "waiting")
    return (
      <Badge>
        <Clock className="size-3" /> In line
      </Badge>
    );
  if (status === "failed")
    return (
      <Badge tone="bad">
        <AlertTriangle className="size-3" /> Failed
      </Badge>
    );
  return (
    <Badge tone="accent">
      <Loader2 className="size-3 animate-spin" /> {STEPS.find((s) => s.id === status)?.label ?? status}
    </Badge>
  );
}

export function RenderPipeline({ video }: { video: Video }) {
  const current = STEPS.findIndex((s) => s.id === (video.status === "waiting" ? "queued" : video.status));
  const failed = video.status === "failed";
  const pct = Math.max(2, Math.round(video.progress));
  const scenes = video.scenes ?? [];
  const step = STEPS[current];

  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/[0.07] bg-panel">
      <div className="bg-grid pointer-events-none absolute inset-0" />
      <div className="relative grid gap-8 p-6 md:grid-cols-[auto_1fr] md:p-8">
        <div className="flex flex-col items-center justify-center gap-4 md:w-56">
          {failed ? (
            <div className="grid size-36 place-items-center rounded-full border border-bad/30 bg-bad/10">
              <AlertTriangle className="size-8 text-bad" />
            </div>
          ) : (
            <Orb icon={step?.icon ?? Film} />
          )}
          <div className="text-center">
            <p className="text-5xl font-semibold tabular-nums tracking-tight">
              {pct}
              <span className="text-2xl text-mute">%</span>
            </p>
            <p className={cx("mt-1 text-sm", failed ? "text-bad" : "text-shimmer font-medium")}>
              {failed ? "Render stopped" : step?.label}
            </p>
          </div>
        </div>

        <div className="min-w-0 space-y-6">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className={cx("h-full rounded-full transition-all duration-1000 ease-out", failed ? "bg-bad" : "accent-gradient")}
              style={{ width: `${pct}%` }}
            />
          </div>
          <ol className="grid gap-2 sm:grid-cols-2">
            {STEPS.slice(1, -1).map((s, i) => {
              const idx = i + 1;
              const done = !failed && current > idx;
              const now = idx === current;
              const Icon = s.icon;
              return (
                <li
                  key={s.id}
                  className={cx(
                    "flex items-center gap-3 rounded-2xl border px-3 py-2.5 transition-all duration-500",
                    now && !failed ? "border-accent/40 bg-accent/[0.06]" : "border-white/[0.06] bg-white/[0.02]",
                    !done && !now && "opacity-45",
                  )}
                >
                  <span
                    className={cx(
                      "grid size-8 shrink-0 place-items-center rounded-xl",
                      done ? "bg-accent text-black" : now ? "bg-accent/15 text-accent" : "bg-white/[0.05] text-mute",
                    )}
                  >
                    {done ? <Check className="size-4" strokeWidth={3} /> : <Icon className={cx("size-4", now && s.id === "queued" && "animate-spin")} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{s.label}</span>
                    <span className="block truncate text-xs text-mute">{s.detail}</span>
                  </span>
                  {now && !failed && <Loader2 className="ml-auto size-4 shrink-0 animate-spin text-accent" />}
                </li>
              );
            })}
          </ol>

          {scenes.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-mute">
                Scenes · {scenes.filter((s) => s.keyframeUrl).length}/{scenes.length}
              </p>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {scenes.map((s, i) => (
                  <div
                    key={s.id}
                    className={cx("relative overflow-hidden rounded-xl border border-white/[0.06]", aspectClass(video.aspectRatio))}
                  >
                    {s.keyframeUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.keyframeUrl} alt="" className="size-full animate-scale-in object-cover" />
                    ) : (
                      <div className="skeleton size-full" style={{ animationDelay: `${i * 120}ms` }} />
                    )}
                    {s.clipUrl && (
                      <span className="absolute bottom-1 right-1 grid size-4 place-items-center rounded-full bg-accent text-black">
                        <Film className="size-2.5" />
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function aspectClass(aspect: string) {
  return aspect === "16:9" ? "aspect-video" : aspect === "1:1" ? "aspect-square" : "aspect-[9/16]";
}

export function VideoCard({ video }: { video: Video }) {
  const look = PRESET_LOOK[video.stylePreset] ?? PRESET_LOOK.custom;
  return (
    <Link
      href={`/studio/${video.projectId}?video=${video.id}`}
      className="group block overflow-hidden rounded-3xl border border-white/[0.07] bg-panel transition duration-300 hover:-translate-y-1 hover:border-accent/40"
    >
      <div className={cx("relative w-full overflow-hidden bg-linear-to-br", look.gradient, "aspect-[4/5]")}>
        {video.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={video.thumbnailUrl} alt="" className="absolute inset-0 size-full object-cover transition duration-500 group-hover:scale-105" />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-4xl">
            {isActive(video.status) ? <Loader2 className="size-8 animate-spin text-white/80" /> : <Film className="size-8 text-white/70" />}
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-linear-to-t from-black/80 to-transparent" />
        <div className="absolute left-3 top-3">
          <StatusBadge status={video.status} />
        </div>
        <div className="absolute inset-x-3 bottom-3">
          <p className="truncate text-sm font-semibold">{video.title}</p>
          <p className="mt-0.5 text-xs capitalize text-white/70">
            {video.stylePreset.replace("_", " ")} · {video.tier} · {video.aspectRatio}
            {video.durationMs ? ` · ${Math.round(video.durationMs / 1000)}s` : ""}
          </p>
        </div>
      </div>
    </Link>
  );
}
