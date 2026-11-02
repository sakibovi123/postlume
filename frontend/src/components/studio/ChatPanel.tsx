"use client";

import { ArrowUp, Bot, ClipboardCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useSession } from "@/components/session";
import { cx, ErrorText, Spinner, Textarea } from "@/components/ui";
import { PRESET_LOOK } from "@/components/video-bits";
import { api } from "@/lib/api";
import type { ChatMessage, CreativeBrief, ProjectDetail, StylePreset, StylesInfo } from "@/lib/types";

export function ChatPanel({
  project,
  styles,
  onMessages,
  onUseBrief,
}: {
  project: ProjectDetail;
  styles: StylesInfo;
  onMessages: (messages: ChatMessage[]) => void;
  onUseBrief: (brief: CreativeBrief) => void;
}) {
  const { can } = useSession();
  const [text, setText] = useState("");
  const [preset, setPreset] = useState<StylePreset | "">((project.stylePreset as StylePreset) || "");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [project.messages.length, pending]);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const value = text.trim();
    if (!value || pending) return;
    setPending(value);
    setText("");
    setError(null);
    try {
      const res = await api.sendMessage(project.id, value, preset || undefined);
      onMessages([...project.messages, res.userMessage, res.assistantMessage]);
      if (res.assistantMessage.brief) onUseBrief(res.assistantMessage.brief);
    } catch (err) {
      setError(err);
      setText(value);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex h-full min-h-[60vh] flex-col rounded-xl border border-line bg-panel">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3 text-sm font-medium">
        <Bot className="size-4 text-violet" /> Director
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {project.messages.length === 0 && !pending && (
          <p className="text-sm text-mute">Describe your video idea. The director will turn it into a brief.</p>
        )}
        {project.messages.map((m) => (
          <div key={m.id} className={cx("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cx(
                "max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap",
                m.role === "user" ? "bg-violet/25 text-ink" : "bg-panel-2 text-ink",
              )}
            >
              {m.text}
              {m.brief && (
                <button
                  onClick={() => onUseBrief(m.brief!)}
                  className="mt-2 flex w-full items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2 text-left text-xs hover:border-violet"
                >
                  <ClipboardCheck className="size-4 shrink-0 text-coral" />
                  <span>
                    <b>Brief:</b> {m.brief.targetSeconds}s · {m.brief.aspectRatio} · {m.brief.stylePreset.replace("_", " ")} ·{" "}
                    {m.brief.genre}
                    <span className="block text-mute">Open in the brief editor →</span>
                  </span>
                </button>
              )}
            </div>
          </div>
        ))}
        {pending && (
          <>
            <div className="flex justify-end">
              <div className="max-w-[88%] rounded-2xl bg-violet/25 px-3.5 py-2.5 text-sm">{pending}</div>
            </div>
            <div className="flex items-center gap-2 text-sm text-mute">
              <Spinner className="size-4" /> Director is thinking…
            </div>
          </>
        )}
        <div ref={bottom} />
      </div>
      {can("creator") && (
        <form onSubmit={send} className="space-y-2 border-t border-line p-3">
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {styles.presets.map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => setPreset(preset === p.id ? "" : p.id)}
                className={cx(
                  "shrink-0 rounded-full border px-2.5 py-1 text-xs",
                  preset === p.id ? "border-violet bg-violet/20 text-ink" : "border-line text-mute hover:text-ink",
                )}
              >
                {PRESET_LOOK[p.id].emoji} {p.label}
              </button>
            ))}
          </div>
          <ErrorText error={error} />
          <div className="flex items-end gap-2">
            <Textarea
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
            />
            <button
              disabled={!text.trim() || !!pending}
              className="accent-gradient grid size-10 shrink-0 place-items-center rounded-lg text-white disabled:opacity-40"
              title="Send"
            >
              <ArrowUp className="size-4" />
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
