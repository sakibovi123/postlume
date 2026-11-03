"use client";

import { ArrowUp, Clapperboard } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Orb } from "@/components/fx";
import { Chip, cx, ErrorText } from "@/components/ui";
import { PRESET_LOOK } from "@/components/video-bits";
import { api } from "@/lib/api";
import type { StylePreset, StylesInfo } from "@/lib/types";

const IDEAS = [
  "A 30 second horror story about a lighthouse keeper who hears knocking from inside the sea",
  "A 60 second kids story about a shy cloud who learns to make rain",
  "A 45 second motivational story about an old runner's last race, for YouTube Shorts",
  "A 30 second sci-fi story: the last robot on Mars finds a flower",
];

export function Composer({ styles, showStyles = true }: { styles: StylesInfo; showStyles?: boolean }) {
  const router = useRouter();
  const [preset, setPreset] = useState<StylePreset>("cartoon");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function start(e?: React.FormEvent) {
    e?.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const p = await api.createProject({ stylePreset: preset });
      await api.sendMessage(p.id, text.trim(), preset);
      router.push(`/studio/${p.id}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  const look = PRESET_LOOK[preset];

  return (
    <div className="space-y-8">
      {busy && (
        <div className="fixed inset-0 z-50 grid animate-fade-in place-items-center bg-bg/85 backdrop-blur-xl">
          <div className="flex flex-col items-center gap-6">
            <Orb icon={Clapperboard} />
            <p className="text-shimmer text-xl font-semibold">Opening your studio</p>
          </div>
        </div>
      )}

      <form
        onSubmit={start}
        className="group relative rounded-[28px] bg-linear-to-br from-accent/40 via-white/10 to-hot/30 p-px transition focus-within:from-accent focus-within:to-hot/60"
      >
        <div className="rounded-[27px] bg-panel/95 p-4 backdrop-blur-xl md:p-5">
          <div className="flex items-start gap-4">
            <div className={cx("hidden size-14 shrink-0 place-items-center rounded-2xl bg-linear-to-br text-2xl sm:grid", look.gradient)}>
              {look.emoji}
            </div>
            <textarea
              rows={3}
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  start();
                }
              }}
              placeholder="Describe your story… e.g. a 30 second spooky story for Reels"
              className="min-h-20 w-full resize-none bg-transparent pt-1 text-base text-ink outline-none placeholder:text-mute/60 md:text-lg"
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {showStyles ? (
              <Chip active>
                {look.emoji} {styles.presets.find((p) => p.id === preset)?.label}
              </Chip>
            ) : (
              <div className="flex max-w-full gap-1.5 overflow-x-auto">
                {styles.presets.map((p) => (
                  <Chip key={p.id} active={preset === p.id} onClick={() => setPreset(p.id)}>
                    {PRESET_LOOK[p.id].emoji} {p.label}
                  </Chip>
                ))}
              </div>
            )}
            <span className="ml-auto hidden text-xs text-mute md:inline">
              LLM <b className="text-ink/80">{styles.providers.llm}</b> · images <b className="text-ink/80">{styles.providers.image}</b> · video{" "}
              <b className="text-ink/80">{styles.providers.video}</b> · voice <b className="text-ink/80">{styles.providers.tts}</b>
            </span>
            <button
              disabled={!text.trim() || busy}
              className="accent-gradient ml-auto flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold shadow-[0_8px_30px_-8px_rgb(214_255_61/0.6)] transition hover:brightness-110 disabled:opacity-40 md:ml-0"
            >
              Generate <ArrowUp className="size-4" strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </form>

      <div className="-mt-4 flex flex-wrap gap-2">
        {IDEAS.map((idea) => (
          <Chip key={idea} onClick={() => setText(idea)}>
            {idea.length > 52 ? `${idea.slice(0, 52)}…` : idea}
          </Chip>
        ))}
      </div>
      <ErrorText error={error} />

      {showStyles && (
        <div>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.14em] text-mute">Choose a look</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {styles.presets.map((p, i) => {
              const l = PRESET_LOOK[p.id];
              const active = preset === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPreset(p.id)}
                  style={{ animationDelay: `${i * 50}ms` }}
                  className={cx(
                    "group/card relative aspect-[4/5] animate-fade-up overflow-hidden rounded-3xl text-left transition duration-300 hover:-translate-y-1",
                    active ? "glow" : "ring-1 ring-white/[0.07]",
                  )}
                >
                  <div className={cx("absolute inset-0 bg-linear-to-br transition duration-700 group-hover/card:scale-110", l.gradient)} />
                  <span className="absolute inset-0 grid place-items-center pb-10 text-6xl drop-shadow-2xl transition duration-500 group-hover/card:scale-110 group-hover/card:animate-float">
                    {l.emoji}
                  </span>
                  <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/85 via-black/40 to-transparent p-4 pt-12">
                    <p className="font-semibold">{p.label}</p>
                    <p className="mt-0.5 text-xs text-white/70">{l.blurb}</p>
                  </div>
                  {active && <span className="accent-gradient absolute right-3 top-3 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase">Selected</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
