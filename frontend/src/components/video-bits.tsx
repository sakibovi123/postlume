"use client";

import { AlertTriangle, CheckCircle2, Film, Loader2 } from "lucide-react";
import Link from "next/link";

import type { StylePreset, Video, VideoStatus } from "@/lib/types";

import { Badge, cx } from "./ui";

export const PRESET_LOOK: Record<StylePreset, { gradient: string; emoji: string; blurb: string }> = {
  animated_3d: { gradient: "from-sky-500 to-fuchsia-500", emoji: "🧸", blurb: "Soft 3D film look, original characters" },
  cartoon: { gradient: "from-yellow-400 to-orange-500", emoji: "🎨", blurb: "Bold outlines, bright flat colors" },
  anime_2d: { gradient: "from-pink-500 to-indigo-500", emoji: "🌸", blurb: "Cel shading, painted backgrounds" },
  cinematic: { gradient: "from-teal-600 to-orange-500", emoji: "🎬", blurb: "Live-action look, film grade" },
  storybook: { gradient: "from-emerald-300 to-amber-300", emoji: "📖", blurb: "Watercolor, gentle and warm" },
  comic: { gradient: "from-red-500 to-yellow-400", emoji: "💥", blurb: "Inked panels, halftone shading" },
  documentary: { gradient: "from-stone-500 to-slate-700", emoji: "🎞️", blurb: "Realistic, natural light" },
  custom: { gradient: "from-violet-500 to-coral", emoji: "✨", blurb: "Describe your own style" },
};

export const STEPS: { id: VideoStatus; label: string }[] = [
  { id: "queued", label: "Queued" },
  { id: "planning", label: "Planning scenes" },
  { id: "references", label: "Characters" },
  { id: "keyframes", label: "Keyframes" },
  { id: "clips", label: "Clips" },
  { id: "voice", label: "Voiceover" },
  { id: "assembling", label: "Assembling" },
  { id: "ready", label: "Ready" },
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

export function ProgressSteps({ video }: { video: Video }) {
  const current = STEPS.findIndex((s) => s.id === video.status);
  return (
    <div className="space-y-3">
      <div className="h-2 overflow-hidden rounded-full bg-panel-2">
        <div className="accent-gradient h-full transition-all duration-700" style={{ width: `${Math.max(3, video.progress)}%` }} />
      </div>
      <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {STEPS.slice(1).map((s, i) => {
          const idx = i + 1;
          const done = video.status === "ready" || (current > idx && video.status !== "failed");
          const now = idx === current;
          return (
            <li key={s.id} className={cx(done ? "text-ok" : now ? "text-ink" : "text-mute")}>
              {now && isActive(video.status) && <Loader2 className="mr-1 inline size-3 animate-spin" />}
              {s.label}
            </li>
          );
        })}
      </ol>
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
      className="group overflow-hidden rounded-xl border border-line bg-panel transition hover:border-violet/60"
    >
      <div className={cx("relative w-full overflow-hidden bg-linear-to-br", look.gradient, "aspect-[4/5]")}>
        {video.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={video.thumbnailUrl} alt="" className="absolute inset-0 size-full object-cover transition group-hover:scale-105" />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-4xl">
            {isActive(video.status) ? <Loader2 className="size-8 animate-spin text-white/80" /> : <Film className="size-8 text-white/70" />}
          </div>
        )}
        <div className="absolute left-2 top-2">
          <StatusBadge status={video.status} />
        </div>
        <div className="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-xs">
          {video.aspectRatio} · {video.durationMs ? `${Math.round(video.durationMs / 1000)}s` : video.tier}
        </div>
      </div>
      <div className="p-3">
        <p className="truncate text-sm font-medium">{video.title}</p>
        <p className="mt-0.5 text-xs capitalize text-mute">
          {video.stylePreset.replace("_", " ")} · {video.tier}
        </p>
      </div>
    </Link>
  );
}
