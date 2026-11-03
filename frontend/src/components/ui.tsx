"use client";

import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "secondary",
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  const styles: Record<Variant, string> = {
    primary: "accent-gradient font-semibold shadow-[0_8px_30px_-8px_rgb(214_255_61/0.55)] hover:brightness-110 hover:shadow-[0_8px_40px_-6px_rgb(214_255_61/0.7)]",
    secondary: "bg-white/[0.05] border border-white/10 text-ink hover:bg-white/[0.09] hover:border-white/20",
    ghost: "text-mute hover:text-ink hover:bg-white/[0.06]",
    danger: "bg-bad/10 border border-bad/30 text-bad hover:bg-bad/20",
  };
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40",
        styles[variant],
        className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

const field =
  "w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2.5 text-sm text-ink placeholder:text-mute/60 outline-none transition focus:border-accent/60 focus:bg-white/[0.05] focus:ring-4 focus:ring-accent/10";

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx(field, className)} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cx(field, "resize-y", className)} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cx(field, "appearance-auto capitalize", className)}>
      {children}
    </select>
  );
}

export function Label({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <span className="mb-1.5 flex items-baseline justify-between text-[11px] font-semibold uppercase tracking-[0.12em] text-mute">
      <span>{children}</span>
      {hint && <span className="font-normal normal-case tracking-normal">{hint}</span>}
    </span>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("glass rounded-3xl p-5 md:p-6", className)}>{children}</div>;
}

export function Badge({ tone = "default", children }: { tone?: "default" | "ok" | "warn" | "bad" | "accent"; children: ReactNode }) {
  const tones = {
    default: "bg-white/[0.06] text-mute border-white/10",
    ok: "bg-ok/10 text-ok border-ok/30",
    warn: "bg-warn/10 text-warn border-warn/30",
    bad: "bg-bad/10 text-bad border-bad/30",
    accent: "bg-accent/10 text-accent border-accent/30",
  };
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium backdrop-blur", tones[tone])}>
      {children}
    </span>
  );
}

export function Chip({ active, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:opacity-40",
        active ? "border-accent/60 bg-accent/10 text-accent" : "border-white/10 bg-white/[0.03] text-mute hover:border-white/25 hover:text-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx("size-5 animate-spin text-mute", className)} />;
}

export function PageLoading() {
  return (
    <div className="flex flex-1 items-center justify-center p-16">
      <div className="relative size-10">
        <div className="orb-ring absolute inset-0 animate-spin rounded-full" />
      </div>
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return <p className="animate-fade-in rounded-2xl border border-bad/30 bg-bad/10 px-4 py-2.5 text-sm text-bad">{message}</p>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{title}</h1>
        {subtitle && <p className="mt-2 text-sm text-mute">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-3xl border border-dashed border-white/10 p-12 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-2 text-sm text-mute">{children}</div>}
    </div>
  );
}

export { cx };
