"use client";

import { Check, type LucideIcon, Sparkles } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import type { GenTask } from "@/lib/types";

import { cx } from "./ui";

export function Orb({ icon: Icon = Sparkles, size = "lg" }: { icon?: LucideIcon; size?: "md" | "lg" }) {
  const box = size === "lg" ? "size-36" : "size-20";
  return (
    <div className={cx("relative grid place-items-center", box)}>
      <div className="absolute inset-0 animate-ping-soft rounded-full bg-accent/10" />
      <div className="orb-ring absolute inset-0 animate-spin-slow rounded-full" />
      <div className="orb-ring absolute inset-3 animate-spin-rev rounded-full opacity-60" />
      <div className="absolute inset-7 animate-pulse-core rounded-full bg-[radial-gradient(circle_at_35%_30%,#9ff5e4,var(--color-accent)_45%,#04463b_100%)] shadow-[0_0_60px_10px_rgb(46_230_197/0.35)]" />
      <Icon className={cx("relative text-black", size === "lg" ? "size-7" : "size-5")} />
    </div>
  );
}

export function TaskProgress({
  task,
  title,
  icon,
  className,
}: {
  task: GenTask;
  title: string;
  icon?: LucideIcon;
  className?: string;
}) {
  const at = Math.max(0, task.stages.findIndex((s) => s.id === task.stage));
  const done = task.status === "done";

  return (
    <div className={cx("relative flex animate-fade-in flex-col items-center overflow-hidden px-6 py-12 text-center", className)}>
      <div className="bg-grid pointer-events-none absolute inset-0" />
      <Orb icon={icon} />
      <h2 className="text-shimmer relative mt-8 text-2xl font-semibold tracking-tight">{title}</h2>
      <p className="relative mt-2 text-4xl font-semibold tabular-nums tracking-tight">
        {task.progress}
        <span className="text-lg text-mute">%</span>
      </p>
      <div className="relative mt-4 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-white/[0.06]">
        <div className="accent-gradient h-full rounded-full transition-all duration-500 ease-out" style={{ width: `${Math.max(3, task.progress)}%` }} />
      </div>
      <div className="relative mt-7 w-full max-w-sm space-y-2.5 text-left">
        {task.stages.map((s, n) => {
          const past = done || n < at;
          const now = !done && n === at;
          return (
            <div
              key={s.id}
              className={cx("flex items-center gap-3 text-sm transition-all duration-500", past ? "text-mute" : now ? "text-ink" : "text-mute/30")}
            >
              <span
                className={cx(
                  "grid size-5 shrink-0 place-items-center rounded-full border transition-all duration-500",
                  past ? "border-accent bg-accent text-black" : now ? "border-accent/70" : "border-white/10",
                )}
              >
                {past ? <Check className="size-3" strokeWidth={3} /> : now && <span className="size-1.5 animate-pulse rounded-full bg-accent" />}
              </span>
              {s.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function StageStepper({
  steps,
  current,
  onSelect,
}: {
  steps: { id: string; label: string; enabled: boolean; done: boolean }[];
  current: string;
  onSelect: (id: string) => void;
}) {
  const at = steps.findIndex((s) => s.id === current);
  return (
    <ol className="flex items-center gap-1 overflow-x-auto pb-1">
      {steps.map((s, n) => {
        const active = s.id === current;
        return (
          <li key={s.id} className="flex shrink-0 items-center gap-1">
            <button
              disabled={!s.enabled}
              onClick={() => onSelect(s.id)}
              className={cx(
                "group flex items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-4 text-sm transition disabled:cursor-not-allowed",
                active ? "glow bg-accent/10 text-ink" : s.enabled ? "text-mute hover:bg-white/[0.05] hover:text-ink" : "text-mute/40",
              )}
            >
              <span
                className={cx(
                  "grid size-7 place-items-center rounded-full text-xs font-semibold transition",
                  active ? "accent-gradient" : s.done ? "bg-accent/15 text-accent" : "bg-white/[0.06]",
                )}
              >
                {s.done && !active ? <Check className="size-3.5" strokeWidth={3} /> : n + 1}
              </span>
              {s.label}
            </button>
            {n < steps.length - 1 && (
              <span className="relative mx-1 h-px w-6 overflow-hidden bg-white/10 md:w-10">
                <span className={cx("absolute inset-0 origin-left bg-accent transition-transform duration-700", n < at ? "scale-x-100" : "scale-x-0")} />
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function Stagger({ children, index, className }: { children: ReactNode; index: number; className?: string }) {
  return (
    <div className={cx("animate-fade-up", className)} style={{ animationDelay: `${index * 90}ms` } as CSSProperties}>
      {children}
    </div>
  );
}
