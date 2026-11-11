"use client";

import { Check, ChevronDown, Loader2 } from "lucide-react";
import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type OptionHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";

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
    primary: "accent-gradient font-semibold shadow-[0_8px_30px_-8px_rgb(46_230_197/0.55)] hover:brightness-110 hover:shadow-[0_8px_40px_-6px_rgb(46_230_197/0.7)]",
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

const fieldBase =
  "rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2.5 text-sm text-ink placeholder:text-mute/60 outline-none transition focus:border-accent/60 focus:bg-white/[0.05] focus:ring-4 focus:ring-accent/10";
const field = `w-full ${fieldBase}`;

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx(field, className)} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cx(field, "resize-y", className)} />;
}

function optionText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(optionText).join("");
  return "";
}

type PanelPosition = { left: number; width: number; maxWidth: number; maxHeight: number; top?: number; bottom?: number };

function panelPosition(trigger: HTMLElement, optionCount: number): PanelPosition {
  const GAP = 8;
  const rect = trigger.getBoundingClientRect();
  const height = Math.min(256, optionCount * 38 + 14);
  const below = window.innerHeight - rect.bottom - GAP;
  const above = rect.top - GAP;
  const vertical =
    below < height && above > below
      ? { bottom: window.innerHeight - rect.top + GAP, maxHeight: Math.min(256, above - GAP) }
      : { top: rect.bottom + GAP, maxHeight: Math.min(256, below - GAP) };
  return { left: rect.left, width: rect.width, maxWidth: window.innerWidth - rect.left - GAP, ...vertical };
}

export function Select({
  value,
  onChange,
  disabled,
  className,
  preserveCase,
  children,
}: {
  value?: string | number;
  onChange?: (e: { target: { value: string } }) => void;
  disabled?: boolean;
  className?: string;
  preserveCase?: boolean;
  children?: ReactNode;
}) {
  const options = Children.toArray(children)
    .filter((c): c is ReactElement<OptionHTMLAttributes<HTMLOptionElement>> => isValidElement(c))
    .map((el) => {
      const label = optionText(el.props.children);
      return { value: String(el.props.value ?? label), label };
    });
  const current = String(value ?? "");
  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === current));

  const [position, setPosition] = useState<PanelPosition | null>(null);
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const listId = useId();
  const open = position !== null;
  const optionCount = options.length;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!triggerRef.current?.contains(e.target as Node)) setPosition(null);
    };
    const place = () => triggerRef.current && setPosition(panelPosition(triggerRef.current, optionCount));
    document.addEventListener("mousedown", close);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, optionCount]);

  useEffect(() => {
    if (open) panelRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function show() {
    if (disabled || !triggerRef.current) return;
    setActive(selectedIndex);
    setPosition(panelPosition(triggerRef.current, optionCount));
  }

  function choose(index: number) {
    setPosition(null);
    const next = options[index];
    if (next && next.value !== current) onChange?.({ target: { value: next.value } });
  }

  function typeAhead(key: string) {
    const now = Date.now();
    const text = (now - typed.current.at > 600 ? "" : typed.current.text) + key.toLowerCase();
    typed.current = { text, at: now };
    const match = options.findIndex((o) => o.label.toLowerCase().startsWith(text));
    if (match >= 0) setActive(match);
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    if (e.key === "Tab") {
      setPosition(null);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setPosition(null);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(active);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(active + 1, optionCount - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(active - 1, 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(optionCount - 1);
    } else if (e.key.length === 1) {
      typeAhead(e.key);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setPosition(null) : show())}
        onKeyDown={onKeyDown}
        className={cx(
          fieldBase,
          !/(^|\s)w-/.test(className ?? "") && "w-full",
          "flex items-center justify-between gap-2 text-left hover:border-white/20 disabled:cursor-not-allowed disabled:opacity-40",
          !preserveCase && "capitalize",
          open && "border-accent/60 bg-white/[0.05] ring-4 ring-accent/10",
          className,
        )}
      >
        <span className="min-w-0 truncate">{options[selectedIndex]?.label}</span>
        <ChevronDown className={cx("size-4 shrink-0 text-mute transition", open && "rotate-180")} />
      </button>
      {position &&
        createPortal(
          <div
            ref={panelRef}
            id={listId}
            role="listbox"
            style={{
              left: position.left,
              minWidth: position.width,
              maxWidth: position.maxWidth,
              maxHeight: position.maxHeight,
              top: position.top,
              bottom: position.bottom,
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            className="fixed z-[60] w-max animate-scale-in overflow-y-auto rounded-2xl border border-white/10 bg-panel p-1.5 text-sm text-ink shadow-[0_24px_60px_-12px_rgb(0_0_0/0.8)]"
          >
            {options.map((o, i) => {
              const selected = i === selectedIndex;
              return (
                <div
                  key={o.value}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={selected}
                  onMouseMove={(e) => {
                    if (e.movementX || e.movementY) setActive(i);
                  }}
                  onClick={() => choose(i)}
                  className={cx(
                    "flex cursor-pointer items-center justify-between gap-4 rounded-xl px-3 py-2 transition-colors",
                    !preserveCase && "capitalize",
                    i === active && "bg-white/[0.06]",
                    selected ? "text-accent" : "text-ink",
                  )}
                >
                  <span className="min-w-0 truncate">{o.label}</span>
                  {selected && <Check className="size-3.5 shrink-0" />}
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </>
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
