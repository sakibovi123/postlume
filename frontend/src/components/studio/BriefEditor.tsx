"use client";

import { Mic, Music, Sparkles } from "lucide-react";
import { useState } from "react";

import { useSession } from "@/components/session";
import { Button, Card, Chip, cx, ErrorText, Input, Label, Select, Textarea } from "@/components/ui";
import { PRESET_LOOK } from "@/components/video-bits";
import { api } from "@/lib/api";
import type { CreativeBrief, GenTask, StylesInfo } from "@/lib/types";

const FORMATS = [
  { id: "9:16", label: "9:16", hint: "Reels · Shorts", box: "h-6 w-3.5" },
  { id: "16:9", label: "16:9", hint: "YouTube", box: "h-3.5 w-6" },
  { id: "1:1", label: "1:1", hint: "Square", box: "size-5" },
] as const;

export function BriefEditor({
  projectId,
  initial,
  styles,
  storyCredits,
  onTask,
}: {
  projectId: number;
  initial: CreativeBrief | null;
  styles: StylesInfo;
  storyCredits: number;
  onTask: (task: GenTask) => void;
}) {
  const { can } = useSession();
  const [brief, setBrief] = useState<CreativeBrief>(
    initial ?? {
      stylePreset: "cartoon",
      idea: "",
      genre: "fantasy",
      aspectRatio: "9:16",
      targetSeconds: 30,
      language: "en",
      narration: true,
      voiceId: "af_heart",
      musicMood: "calm",
    },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = <K extends keyof CreativeBrief>(k: K, v: CreativeBrief[K]) => setBrief((b) => ({ ...b, [k]: v }));

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const saved = await api.confirmBrief(projectId, brief);
      onTask(await api.generateStory(projectId, saved.id));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const lengths = [...new Set([brief.targetSeconds, ...styles.lengths])].sort((a, b) => a - b);

  return (
    <Card className="space-y-7">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Step 1</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight">Creative brief</h2>
        <p className="mt-1 text-sm text-mute">Check the details, then the AI writes your story.</p>
      </div>

      <label className="block">
        <Label>Story idea</Label>
        <Textarea rows={3} value={brief.idea} onChange={(e) => set("idea", e.target.value)} className="text-base" />
      </label>

      <div>
        <Label>Look</Label>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-9">
          {styles.presets.map((p) => {
            const l = PRESET_LOOK[p.id];
            const active = brief.stylePreset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => set("stylePreset", p.id)}
                className={cx(
                  "group relative aspect-square overflow-hidden rounded-2xl transition hover:-translate-y-0.5",
                  active ? "glow" : "opacity-70 ring-1 ring-white/[0.07] hover:opacity-100",
                )}
                title={p.label}
              >
                <div className={cx("absolute inset-0 bg-linear-to-br", l.gradient)} />
                <span className="absolute inset-0 grid place-items-center pb-4 text-2xl">{l.emoji}</span>
                <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1 py-1 text-center text-[10px] font-medium">{p.label}</span>
              </button>
            );
          })}
        </div>
        {brief.stylePreset === "custom" && (
          <Input
            className="mt-2"
            value={brief.customStyle ?? ""}
            onChange={(e) => set("customStyle", e.target.value)}
            placeholder="moody claymation, warm lamplight"
          />
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <Label>Format</Label>
          <div className="grid grid-cols-3 gap-2">
            {FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => set("aspectRatio", f.id)}
                className={cx(
                  "flex flex-col items-center gap-2 rounded-2xl border py-3 text-xs transition",
                  brief.aspectRatio === f.id ? "border-accent/60 bg-accent/[0.08] text-ink" : "border-white/[0.08] text-mute hover:border-white/20",
                )}
              >
                <span className={cx("rounded-[4px] border-2", f.box, brief.aspectRatio === f.id ? "border-accent" : "border-current")} />
                <span className="font-semibold">{f.label}</span>
                <span className="-mt-1.5 text-[10px] text-mute">{f.hint}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label>Length</Label>
          <div className="flex flex-wrap gap-2">
            {lengths.map((s) => (
              <Chip key={s} active={brief.targetSeconds === s} onClick={() => set("targetSeconds", s)} className="px-4 py-2 text-sm">
                {s >= 60 ? `${s / 60} min` : `${s}s`}
              </Chip>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <Label>Genre</Label>
          <Select value={brief.genre} onChange={(e) => set("genre", e.target.value)}>
            {[...new Set([brief.genre, ...styles.genres])].map((g) => (
              <option key={g}>{g}</option>
            ))}
          </Select>
        </label>
        <label className="block">
          <Label>
            <span className="inline-flex items-center gap-1">
              <Mic className="size-3" /> Voice
            </span>
          </Label>
          <Select value={brief.voiceId ?? ""} onChange={(e) => set("voiceId", e.target.value)}>
            {styles.voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <Label>
            <span className="inline-flex items-center gap-1">
              <Music className="size-3" /> Music
            </span>
          </Label>
          <Select value={brief.musicMood ?? "none"} onChange={(e) => set("musicMood", e.target.value)}>
            {styles.musicMoods.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Select>
        </label>
      </div>

      <label className="flex w-fit cursor-pointer items-center gap-3 text-sm">
        <span className={cx("relative h-6 w-11 rounded-full transition", brief.narration ? "bg-accent" : "bg-white/10")}>
          <span className={cx("absolute top-0.5 size-5 rounded-full shadow transition-all", brief.narration ? "left-[22px] bg-black" : "left-0.5 bg-white")} />
        </span>
        <input type="checkbox" className="sr-only" checked={brief.narration} onChange={(e) => set("narration", e.target.checked)} />
        Narration voiceover
      </label>

      <ErrorText error={error} />
      {can("creator") && (
        <Button variant="primary" className="w-full py-3.5 text-base" loading={busy} disabled={brief.idea.trim().length < 3} onClick={confirm}>
          <Sparkles className="size-5" /> Write my story · {storyCredits} credit
        </Button>
      )}
    </Card>
  );
}
