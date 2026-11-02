"use client";

import { ArrowUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button, Card, cx, ErrorText, PageHeader, Spinner, Textarea } from "@/components/ui";
import { PRESET_LOOK } from "@/components/video-bits";
import { api } from "@/lib/api";
import type { StylePreset, StylesInfo } from "@/lib/types";

const IDEAS = [
  "A 30 second horror story about a lighthouse keeper who hears knocking from inside the sea",
  "A 60 second kids story about a shy cloud who learns to make rain",
  "A 45 second motivational story about an old runner's last race, for YouTube Shorts",
  "A 30 second sci-fi story: the last robot on Mars finds a flower",
];

export default function NewVideo() {
  const router = useRouter();
  const [styles, setStyles] = useState<StylesInfo | null>(null);
  const [preset, setPreset] = useState<StylePreset>("cartoon");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api.styles().then(setStyles).catch(setError);
  }, []);

  async function start(e?: React.FormEvent) {
    e?.preventDefault();
    if (!text.trim()) return;
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

  if (!styles) return error ? <ErrorText error={error} /> : <Spinner />;

  return (
    <div className="max-w-5xl">
      <PageHeader title="New video" subtitle="Pick a look, then tell the director what the story is about." />
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {styles.presets.map((p) => {
          const look = PRESET_LOOK[p.id];
          return (
            <button
              key={p.id}
              onClick={() => setPreset(p.id)}
              className={cx(
                "overflow-hidden rounded-xl border text-left transition",
                preset === p.id ? "border-violet ring-2 ring-violet/40" : "border-line hover:border-mute/50",
              )}
            >
              <div className={`grid h-24 place-items-center bg-linear-to-br text-4xl ${look.gradient}`}>{look.emoji}</div>
              <div className="bg-panel p-3">
                <p className="text-sm font-medium">{p.label}</p>
                <p className="mt-0.5 text-xs text-mute">{look.blurb}</p>
              </div>
            </button>
          );
        })}
      </div>
      <Card>
        <form onSubmit={start} className="space-y-3">
          <Textarea
            rows={4}
            autoFocus
            placeholder="Describe your story idea, length and platform… e.g. a 30 second spooky story for Reels"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) start();
            }}
          />
          <div className="flex flex-wrap gap-2">
            {IDEAS.map((idea) => (
              <button
                type="button"
                key={idea}
                onClick={() => setText(idea)}
                className="rounded-full border border-line px-3 py-1 text-xs text-mute hover:border-violet hover:text-ink"
              >
                {idea.length > 60 ? `${idea.slice(0, 60)}…` : idea}
              </button>
            ))}
          </div>
          <ErrorText error={error} />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-mute">
              Providers: LLM <b>{styles.providers.llm}</b>, images <b>{styles.providers.image}</b>, video <b>{styles.providers.video}</b>, voice <b>{styles.providers.tts}</b>
            </p>
            <Button variant="primary" loading={busy} disabled={!text.trim()}>
              Start <ArrowUp className="size-4" />
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
