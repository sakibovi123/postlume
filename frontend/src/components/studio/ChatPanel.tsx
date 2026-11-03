"use client";

import { ArrowRight, ArrowUp, ClipboardCheck, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useSession } from "@/components/session";
import { Chip, cx, ErrorText } from "@/components/ui";
import { PRESET_LOOK } from "@/components/video-bits";
import { api } from "@/lib/api";
import { useTask } from "@/lib/useTask";
import type { ChatMessage, CreativeBrief, GenTask, ProjectDetail, StylePreset, StylesInfo } from "@/lib/types";

function Avatar() {
  return (
    <span className="accent-gradient grid size-7 shrink-0 place-items-center rounded-full">
      <Zap className="size-3.5 fill-black" />
    </span>
  );
}

function DirectorStream({ task: initial, onFinish }: { task: GenTask; onFinish: (task: GenTask) => void }) {
  const task = useTask(initial, onFinish);
  const reply = String(task.partial.reply ?? "");
  const stage = task.stages.find((s) => s.id === task.stage)?.label ?? "Thinking";

  return (
    <div className="flex animate-fade-up gap-2">
      <Avatar />
      <div className="max-w-[85%] space-y-2">
        {reply ? (
          <div className="rounded-2xl rounded-tl-md bg-white/[0.05] px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
            {reply}
            {task.stage === "reply" && <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-accent" />}
          </div>
        ) : (
          <div className="flex w-fit gap-1 rounded-2xl rounded-tl-md bg-white/[0.05] px-4 py-3.5">
            {[0, 1, 2].map((i) => (
              <span key={i} className="size-1.5 animate-bounce rounded-full bg-accent" style={{ animationDelay: `${i * 150}ms` }} />
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 px-1 text-xs text-mute">
          <span className="text-shimmer font-medium">{stage}</span>
          <span className="h-1 w-16 overflow-hidden rounded-full bg-white/[0.06]">
            <span className="accent-gradient block h-full rounded-full transition-all duration-500" style={{ width: `${task.progress}%` }} />
          </span>
          <span className="tabular-nums">{task.progress}%</span>
        </div>
      </div>
    </div>
  );
}

export function ChatPanel({
  project,
  styles,
  onMessage,
  onUseBrief,
}: {
  project: ProjectDetail;
  styles: StylesInfo;
  onMessage: (message: ChatMessage) => void;
  onUseBrief: (brief: CreativeBrief) => void;
}) {
  const { can } = useSession();
  const [text, setText] = useState("");
  const [preset, setPreset] = useState<StylePreset | "">((project.stylePreset as StylePreset) || "");
  const [task, setTask] = useState<GenTask | null>(project.tasks.find((t) => t.kind === "director") ?? null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const busy = sending || !!task;

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [project.messages.length, task]);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    setSending(true);
    setText("");
    setError(null);
    try {
      const res = await api.sendMessage(project.id, value, preset || undefined);
      onMessage(res.userMessage);
      setTask(res.task);
    } catch (err) {
      setError(err);
      setText(value);
    } finally {
      setSending(false);
    }
  }

  function finish(t: GenTask) {
    setTask(null);
    if (t.status === "failed") {
      setError(new Error(t.error));
      return;
    }
    const { assistantMessage } = t.result as { assistantMessage: ChatMessage };
    onMessage(assistantMessage);
    if (assistantMessage.brief) onUseBrief(assistantMessage.brief);
  }

  return (
    <div className="glass flex h-full min-h-[60vh] flex-col overflow-hidden rounded-3xl">
      <div className="flex items-center gap-2.5 border-b border-white/[0.06] px-5 py-4">
        <Avatar />
        <div>
          <p className="text-sm font-semibold">Director</p>
          <p className="flex items-center gap-1.5 text-xs text-mute">
            <span className="size-1.5 rounded-full bg-ok" /> Online · LLM {styles.providers.llm}
          </p>
        </div>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {project.messages.length === 0 && !task && (
          <p className="text-sm text-mute">Describe your video idea. The director will turn it into a brief.</p>
        )}
        {project.messages.map((m) => (
          <div key={m.id} className={cx("flex animate-fade-up gap-2", m.role === "user" ? "justify-end" : "justify-start")}>
            {m.role === "assistant" && <Avatar />}
            <div
              className={cx(
                "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap",
                m.role === "user" ? "rounded-br-md bg-accent text-black" : "rounded-tl-md bg-white/[0.05] text-ink",
              )}
            >
              {m.text}
              {m.brief && (
                <button
                  onClick={() => onUseBrief(m.brief!)}
                  className="group mt-3 flex w-full items-center gap-3 rounded-xl border border-accent/25 bg-accent/[0.06] px-3 py-2.5 text-left text-xs transition hover:border-accent/60"
                >
                  <ClipboardCheck className="size-4 shrink-0 text-accent" />
                  <span className="min-w-0 flex-1">
                    <b className="text-ink">Brief ready</b>
                    <span className="block capitalize text-mute">
                      {m.brief.targetSeconds}s · {m.brief.aspectRatio} · {m.brief.stylePreset.replace("_", " ")} · {m.brief.genre}
                    </span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-accent transition group-hover:translate-x-0.5" />
                </button>
              )}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-end">
            <div className="max-w-[85%] animate-pulse rounded-2xl rounded-br-md bg-accent/60 px-4 py-2.5 text-sm text-black">Sending…</div>
          </div>
        )}
        {task && <DirectorStream key={task.id} task={task} onFinish={finish} />}
        <div ref={bottom} />
      </div>
      {can("creator") && (
        <form onSubmit={send} className="space-y-2 border-t border-white/[0.06] p-3">
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {styles.presets.map((p) => (
              <Chip key={p.id} active={preset === p.id} onClick={() => setPreset(preset === p.id ? "" : p.id)}>
                {PRESET_LOOK[p.id].emoji} {p.label}
              </Chip>
            ))}
          </div>
          <ErrorText error={error} />
          <div className="flex items-end gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-1.5 pl-3 transition focus-within:border-accent/50">
            <textarea
              rows={2}
              value={text}
              placeholder="Ask for changes or describe a new idea…"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              className="flex-1 resize-none bg-transparent py-1.5 text-sm outline-none placeholder:text-mute/60"
            />
            <button
              disabled={!text.trim() || busy}
              className="accent-gradient grid size-9 shrink-0 place-items-center rounded-xl transition hover:brightness-110 disabled:opacity-30"
              title="Send"
            >
              <ArrowUp className="size-4" strokeWidth={2.5} />
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
