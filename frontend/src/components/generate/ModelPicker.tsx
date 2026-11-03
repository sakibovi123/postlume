"use client";

import { ChevronDown, Search, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cx, Spinner } from "@/components/ui";
import type { FalModel } from "@/lib/types";

function Thumb({ src, className }: { src: string; className?: string }) {
  return (
    <span className={cx("block shrink-0 overflow-hidden rounded-xl bg-linear-to-br from-accent/30 to-hot/30", className)}>
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" className="size-full object-cover" />
      )}
    </span>
  );
}

export function ModelPicker({
  models,
  value,
  onChange,
}: {
  models: FalModel[] | null;
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const current = models?.find((m) => m.id === value);

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!models) return [];
    return needle ? models.filter((m) => `${m.name} ${m.id} ${m.tags.join(" ")}`.toLowerCase().includes(needle)) : models;
  }, [models, q]);

  return (
    <div ref={ref} className={cx("relative", open && "z-50")}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-2 pr-4 text-left transition hover:border-accent/40"
      >
        {models === null ? (
          <span className="grid size-12 place-items-center">
            <Spinner className="size-4" />
          </span>
        ) : (
          <Thumb src={current?.thumbnail ?? ""} className="size-12" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{current?.name ?? (models ? "Choose a model" : "Loading models…")}</span>
          <span className="block truncate font-mono text-[11px] text-mute">{value || "—"}</span>
        </span>
        <ChevronDown className={cx("size-4 shrink-0 text-mute transition", open && "rotate-180")} />
      </button>

      {open && models && (
        <div className="absolute inset-x-0 top-[calc(100%+8px)] z-50 animate-scale-in overflow-hidden rounded-2xl border border-white/10 bg-panel shadow-[0_24px_60px_-12px_rgb(0_0_0/0.8)]">
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-3">
            <Search className="size-4 text-mute" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${models.length} models…`}
              className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-mute/60"
            />
          </div>
          <div className="max-h-[420px] overflow-y-auto p-1.5">
            {list.length === 0 && <p className="p-4 text-center text-sm text-mute">No models match.</p>}
            {list.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  onChange(m.id);
                  setOpen(false);
                  setQ("");
                }}
                className={cx(
                  "flex w-full items-center gap-3 rounded-xl p-2 text-left transition",
                  m.id === value ? "bg-accent/10" : "hover:bg-white/[0.05]",
                )}
              >
                <Thumb src={m.thumbnail} className="size-11" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <span className="truncate">{m.name}</span>
                    {m.featured && <Sparkles className="size-3 shrink-0 text-accent" />}
                  </span>
                  <span className="block truncate font-mono text-[11px] text-mute">{m.id}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
