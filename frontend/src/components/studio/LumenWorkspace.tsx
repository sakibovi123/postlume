"use client";

import { ChevronRight, Maximize2, MessageSquare, Minimize2, PanelRightOpen, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { cx } from "@/components/ui";

export type WorkspaceView = "split" | "chat" | "canvas";

const WIDTH_KEY = "postlume:lumen-chat-width";
const DEFAULT_WIDTH = 420;
const MIN_CHAT = 320;
const MIN_CANVAS = 420;

function readWidth() {
  try {
    const w = Number(localStorage.getItem(WIDTH_KEY));
    return w >= MIN_CHAT ? w : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

function writeWidth(w: number) {
  try {
    localStorage.setItem(WIDTH_KEY, String(Math.round(w)));
  } catch {}
}

/**
 * Claude-style split view: chat on the left, a workspace panel on the right.
 * The workspace can be closed (chat only), expanded (workspace only) or resized by dragging the divider.
 */
export function LumenWorkspace({
  view,
  onViewChange,
  chat,
  title,
  subtitle,
  children,
}: {
  view: WorkspaceView;
  onViewChange: (v: WorkspaceView) => void;
  chat: ReactNode;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const [width, setWidth] = useState(readWidth);
  const [dragging, setDragging] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const clamp = useCallback((w: number) => {
    const total = box.current?.clientWidth ?? 1200;
    return Math.max(MIN_CHAT, Math.min(w, total - MIN_CANVAS));
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const left = box.current?.getBoundingClientRect().left ?? 0;
      setWidth(clamp(e.clientX - left));
    };
    const up = () => setDragging(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [dragging, clamp]);

  useEffect(() => {
    if (!dragging) writeWidth(width);
  }, [dragging, width]);

  const showChat = view !== "canvas";
  const showCanvas = view !== "chat";

  return (
    <div
      ref={box}
      style={{ "--chat-w": `${width}px` } as React.CSSProperties}
      className="flex flex-col gap-4 lg:h-[calc(100dvh-13rem)] lg:min-h-[560px] lg:flex-row lg:gap-0"
    >
      {showChat && (
        <div
          className={cx(
            "relative h-[70vh] min-w-0 animate-fade-in lg:h-full",
            view === "split" ? "lg:w-(--chat-w) lg:shrink-0" : "mx-auto w-full max-w-3xl",
          )}
        >
          {chat}
          {view === "chat" && (
            <button
              onClick={() => onViewChange("split")}
              title="Open workspace"
              className="glass absolute right-3 top-3 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-mute transition hover:text-ink"
            >
              <PanelRightOpen className="size-3.5" /> Workspace
            </button>
          )}
        </div>
      )}

      {view === "split" && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize chat"
          title="Drag to resize · double-click to reset"
          onPointerDown={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDoubleClick={() => setWidth(clamp(DEFAULT_WIDTH))}
          className="group hidden w-3 shrink-0 cursor-col-resize items-center justify-center lg:flex"
        >
          <span
            className={cx(
              "h-10 w-1 rounded-full transition",
              dragging ? "h-16 bg-accent" : "bg-white/15 group-hover:h-16 group-hover:bg-accent/70",
            )}
          />
        </div>
      )}

      {showCanvas && (
        <section className="glass flex min-h-[60vh] min-w-0 flex-1 animate-fade-in flex-col overflow-hidden rounded-3xl lg:min-h-0">
          <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.06] px-4">
            {view === "canvas" && (
              <button
                onClick={() => onViewChange("split")}
                title="Show chat"
                className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-mute transition hover:text-ink"
              >
                <MessageSquare className="size-3.5" /> Chat
              </button>
            )}
            <nav className="flex min-w-0 items-center gap-1.5 text-sm">
              <span className="shrink-0 text-mute">Workspace</span>
              <ChevronRight className="size-3.5 shrink-0 text-mute/60" />
              <span className="truncate font-medium">{title}</span>
              {subtitle && <span className="hidden shrink-0 text-xs text-mute sm:inline">· {subtitle}</span>}
            </nav>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <IconButton
                className="hidden lg:grid"
                title={view === "canvas" ? "Exit full width" : "Full width"}
                onClick={() => onViewChange(view === "canvas" ? "split" : "canvas")}
              >
                {view === "canvas" ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              </IconButton>
              <IconButton title="Close workspace" onClick={() => onViewChange("chat")}>
                <X className="size-4" />
              </IconButton>
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">{children}</div>
        </section>
      )}
    </div>
  );
}

function IconButton({ title, onClick, className, children }: { title: string; onClick: () => void; className?: string; children: ReactNode }) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cx("grid size-8 place-items-center rounded-lg text-mute transition hover:bg-white/[0.06] hover:text-ink", className)}
    >
      {children}
    </button>
  );
}
