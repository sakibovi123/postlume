"use client";

import { AlertTriangle, Download, RotateCcw, Trash2, Zap } from "lucide-react";
import { useEffect, useState } from "react";

import { Orb } from "@/components/fx";
import { cx } from "@/components/ui";
import type { Generation } from "@/lib/types";

export const length = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m${s % 60 ? ` ${s % 60}s` : ""}` : `${s}s`);

function useElapsed(gen: Generation) {
  const active = gen.status === "queued" || gen.status === "running";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  if (!active) return gen.seconds;
  return Math.max(0, Math.round((now - new Date(gen.startedAt ?? gen.createdAt).getTime()) / 1000));
}

export function GenerationCard({
  gen,
  onReuse,
  onDelete,
}: {
  gen: Generation;
  onReuse: (gen: Generation) => void;
  onDelete: (gen: Generation) => void;
}) {
  const seconds = useElapsed(gen);
  const media = gen.media[0];
  const prompt = String(gen.input.prompt ?? gen.input.text ?? "");
  const active = gen.status === "queued" || gen.status === "running";

  return (
    <div className="group animate-fade-up overflow-hidden rounded-3xl border border-white/[0.07] bg-panel transition hover:border-white/15">
      <div className={cx("relative grid place-items-center overflow-hidden bg-black/40", !media && "aspect-video")}>
        {media?.type === "video" && <video src={media.url} controls loop playsInline className="max-h-[70vh] w-full" />}
        {media?.type === "image" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={media.url} alt={prompt} className="max-h-[70vh] w-full object-contain" />
        )}
        {media?.type === "audio" && (
          <div className="flex w-full flex-col items-center gap-4 p-8">
            <div className="flex h-16 items-end gap-1">
              {Array.from({ length: 24 }, (_, i) => (
                <span key={i} className="w-1.5 rounded-full bg-accent/70" style={{ height: `${20 + ((i * 37) % 80)}%` }} />
              ))}
            </div>
            <audio src={media.url} controls className="w-full" />
          </div>
        )}

        {active && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
            <div className="bg-grid pointer-events-none absolute inset-0" />
            <Orb size="md" icon={Zap} />
            <div className="relative">
              <p className="text-shimmer text-lg font-semibold">
                {gen.status === "queued" ? (gen.queuePosition ? `In queue · #${gen.queuePosition + 1}` : "In queue") : "Generating"}
              </p>
              <p className="mt-1 font-mono text-xs tabular-nums text-mute">{seconds}s elapsed</p>
              {gen.logs.length > 0 && <p className="mt-2 max-w-xs truncate font-mono text-[11px] text-mute/80">{gen.logs[gen.logs.length - 1]}</p>}
              {gen.plan && (
                <div className="mx-auto mt-3 h-1.5 w-48 overflow-hidden rounded-full bg-white/10">
                  <div className="accent-gradient h-full transition-all duration-700" style={{ width: `${Math.max(4, (gen.plan.done / gen.plan.count) * 100)}%` }} />
                </div>
              )}
            </div>
          </div>
        )}

        {gen.status === "failed" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
            <AlertTriangle className="size-7 text-bad" />
            <p className="text-sm font-medium">Generation failed</p>
            <p className="line-clamp-4 max-w-sm text-xs text-mute">{gen.error}</p>
            {gen.credits > 0 && <p className="text-xs text-mute">Credits refunded</p>}
          </div>
        )}
      </div>

      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {gen.modelName}
              {gen.plan && <span className="ml-2 font-normal text-mute">· {length(gen.plan.totalSeconds)} · {gen.plan.count} shots</span>}
            </p>
            <p className="truncate font-mono text-[11px] text-mute">{gen.endpointId}</p>
          </div>
          {gen.credits > 0 && (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-white/[0.05] px-2 py-0.5 text-xs text-mute">
              <Zap className="size-3 fill-accent text-accent" /> {gen.credits}
            </span>
          )}
        </div>
        {prompt && <p className="line-clamp-2 text-sm text-ink/80">{prompt}</p>}
        <div className="flex flex-wrap items-center gap-1.5">
          {gen.media.map((m, i) => (
            <a
              key={m.url}
              href={m.url}
              download
              className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-black hover:brightness-110"
            >
              <Download className="size-3.5" /> {gen.media.length > 1 ? `${m.type} ${i + 1}` : "Download"}
            </a>
          ))}
          <button onClick={() => onReuse(gen)} className="flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-xs text-mute hover:text-ink">
            <RotateCcw className="size-3.5" /> Reuse settings
          </button>
          {!active && (
            <button onClick={() => onDelete(gen)} className="ml-auto rounded-full p-1.5 text-mute opacity-0 transition hover:text-bad group-hover:opacity-100" title="Delete">
              <Trash2 className="size-4" />
            </button>
          )}
          {!active && gen.status === "done" && <span className="text-[11px] text-mute">{gen.seconds}s</span>}
        </div>
      </div>
    </div>
  );
}
