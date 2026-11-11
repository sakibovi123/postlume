"use client";

import { ArrowRight, ArrowUp, Check, ClipboardCheck, Clapperboard, Loader2, PenLine, Scissors, Sparkles, Wand2, Zap } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";

import { useSession } from "@/components/session";
import { cx, ErrorText } from "@/components/ui";
import { api } from "@/lib/api";
import { useTask } from "@/lib/useTask";
import type { AgentAction, ChatMessage, CreativeBrief, GenTask, ProjectDetail, StylesInfo } from "@/lib/types";

const ACTION_ICON: Record<AgentAction["type"], typeof Zap> = {
  plan: Sparkles,
  writing: PenLine,
  rewrite: PenLine,
  render: Clapperboard,
  edit: Scissors,
};

const STARTERS = [
  "I need a horror story with 5 episodes, 60 seconds each",
  "A cozy kids bedtime story, one 45 second video",
  "A sci-fi mystery series for YouTube",
];

function Avatar() {
  return (
    <span className="accent-gradient grid size-7 shrink-0 place-items-center rounded-full">
      <Zap className="size-3.5 fill-black" />
    </span>
  );
}

function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <b key={i} className="font-semibold text-ink">
            {part.slice(2, -2)}
          </b>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

function Bubble({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl rounded-tl-md bg-white/[0.05] px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-ink/90">{children}</div>;
}

function AgentStream({ task: initial, onFinish }: { task: GenTask; onFinish: (task: GenTask) => void }) {
  const task = useTask(initial, onFinish);
  const activity = (task.partial.activity as string[] | undefined) ?? [];
  const stage = task.stages.find((s) => s.id === task.stage)?.label ?? "Thinking";

  return (
    <div className="flex animate-fade-up gap-2">
      <Avatar />
      <div className="max-w-[85%] space-y-2">
        <div className="flex w-fit gap-1 rounded-2xl rounded-tl-md bg-white/[0.05] px-4 py-3.5">
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-1.5 animate-bounce rounded-full bg-accent" style={{ animationDelay: `${i * 150}ms` }} />
          ))}
        </div>
        {activity.length > 0 && (
          <ul className="space-y-1 px-1">
            {activity.map((a, i) => (
              <li key={i} className="flex items-center gap-2 text-xs text-mute">
                {i === activity.length - 1 ? <Loader2 className="size-3 animate-spin text-accent" /> : <Check className="size-3 text-accent" />}
                {a}
              </li>
            ))}
          </ul>
        )}
        <p className="text-shimmer px-1 text-xs font-medium">{stage}…</p>
      </div>
    </div>
  );
}

export function ChatPanel({
  project,
  styles,
  onMessage,
  onTurnDone,
  onUseBrief,
  registerSend,
}: {
  project: ProjectDetail;
  styles: StylesInfo;
  onMessage: (message: ChatMessage) => void;
  onTurnDone: () => void;
  onUseBrief?: (brief: CreativeBrief) => void;
  registerSend?: (send: (text: string) => void) => void;
}) {
  const { can } = useSession();
  const [text, setText] = useState("");
  const [task, setTask] = useState<GenTask | null>(project.tasks.find((t) => t.kind === "agent" || t.kind === "director") ?? null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const busy = sending || !!task;
  const messages = project.messages;
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const suggestions = !busy && messages.at(-1)?.role === "assistant" ? lastAssistant?.suggestions ?? [] : [];

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, task]);

  async function sendText(raw: string) {
    const value = raw.trim();
    if (!value || busy) return;
    setSending(true);
    setText("");
    setError(null);
    try {
      const res = await api.sendMessage(project.id, value);
      onMessage(res.userMessage);
      setTask(res.task);
    } catch (err) {
      setError(err);
      setText(value);
    } finally {
      setSending(false);
    }
  }

  const sendRef = useRef(sendText);
  useEffect(() => {
    sendRef.current = sendText;
  });
  useEffect(() => {
    registerSend?.((t) => sendRef.current(t));
  }, [registerSend]);

  function finish(t: GenTask) {
    setTask(null);
    if (t.status === "failed") {
      setError(new Error(t.error));
      onTurnDone();
      return;
    }
    const { assistantMessage } = t.result as { assistantMessage: ChatMessage };
    onMessage(assistantMessage);
    onTurnDone();
  }

  return (
    <div className="glass flex h-full min-h-[60vh] flex-col overflow-hidden rounded-3xl">
      <div className="flex items-center gap-2.5 border-b border-white/[0.06] px-5 py-4">
        <Avatar />
        <div>
          <p className="text-sm font-semibold">Lumen</p>
          <p className="flex items-center gap-1.5 text-xs text-mute">
            <span className={cx("size-1.5 rounded-full", busy ? "animate-pulse bg-accent" : "bg-ok")} />
            {busy ? "Working…" : "Writes, produces and edits your videos"} · {styles.providers.llm}
          </p>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && !task && (
          <div className="space-y-3 pt-2">
            <Bubble>
              Hi! I&apos;m Lumen, your content creator. Tell me what you want to make, like a horror series, a kids story or a
              motivational short. I&apos;ll write every episode, make the videos and edit them for you.
            </Bubble>
            {can("creator") && (
              <div className="flex flex-col items-start gap-2 pl-1">
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    onClick={() => sendText(s)}
                    className="group flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-left text-xs text-mute transition hover:border-accent/40 hover:text-ink"
                  >
                    <Wand2 className="size-3.5 text-accent" /> {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={cx("flex animate-fade-up gap-2", m.role === "user" ? "justify-end" : "justify-start")}>
            {m.role === "assistant" && <Avatar />}
            <div className={cx("max-w-[85%] space-y-2", m.role === "user" && "flex flex-col items-end")}>
              {m.role === "user" ? (
                <div className="rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-black">{m.text}</div>
              ) : (
                <Bubble>
                  <RichText text={m.text} />
                </Bubble>
              )}
              {m.actions.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {m.actions.map((a, i) => {
                    const Icon = ACTION_ICON[a.type] ?? Sparkles;
                    return (
                      <span key={i} className="inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent/[0.06] px-2.5 py-1 text-[11px] text-ink/80">
                        <Icon className="size-3 text-accent" /> {a.label}
                      </span>
                    );
                  })}
                </div>
              )}
              {m.brief && onUseBrief && (
                <button
                  onClick={() => onUseBrief(m.brief!)}
                  className="group flex w-full items-center gap-3 rounded-xl border border-accent/25 bg-accent/[0.06] px-3 py-2.5 text-left text-xs transition hover:border-accent/60"
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
        {task && <AgentStream key={task.id} task={task} onFinish={finish} />}

        {can("creator") && suggestions.length > 0 && (
          <div className="flex flex-wrap gap-2 pl-9">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => sendText(s)}
                className="animate-fade-up rounded-full border border-accent/30 bg-accent/[0.06] px-3 py-1.5 text-xs font-medium text-accent transition hover:bg-accent/15"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <div ref={bottom} />
      </div>

      {can("creator") && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendText(text);
          }}
          className="space-y-2 border-t border-white/[0.06] p-3"
        >
          <ErrorText error={error} />
          <div className="flex items-end gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-1.5 pl-3 transition focus-within:border-accent/50">
            <textarea
              rows={2}
              value={text}
              placeholder={messages.length ? "Ask for edits, e.g. \"cut scene 2 of episode 1\"…" : "What do you want to create?"}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendText(text);
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
