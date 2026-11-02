"use client";

import { Sparkles } from "lucide-react";
import { useState } from "react";

import { useSession } from "@/components/session";
import { Button, Card, ErrorText, Input, Label, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import type { CreativeBrief, StylePreset, StylesInfo } from "@/lib/types";

export function BriefEditor({
  projectId,
  initial,
  styles,
  storyCredits,
  onStory,
}: {
  projectId: number;
  initial: CreativeBrief | null;
  styles: StylesInfo;
  storyCredits: number;
  onStory: () => Promise<void>;
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
      await api.generateStory(projectId, saved.id);
      await onStory();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="font-medium">Creative brief</h2>
        <p className="text-sm text-mute">Check the details, then the AI writes the story.</p>
      </div>
      <label className="block">
        <Label>Story idea</Label>
        <Textarea rows={3} value={brief.idea} onChange={(e) => set("idea", e.target.value)} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <Label>Style</Label>
          <Select value={brief.stylePreset} onChange={(e) => set("stylePreset", e.target.value as StylePreset)}>
            {styles.presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <Label>Genre</Label>
          <Select value={brief.genre} onChange={(e) => set("genre", e.target.value)}>
            {[...new Set([brief.genre, ...styles.genres])].map((g) => (
              <option key={g}>{g}</option>
            ))}
          </Select>
        </label>
        {brief.stylePreset === "custom" && (
          <label className="block sm:col-span-2">
            <Label>Describe the style</Label>
            <Input value={brief.customStyle ?? ""} onChange={(e) => set("customStyle", e.target.value)} placeholder="moody claymation, warm lamplight" />
          </label>
        )}
        <label className="block">
          <Label>Format</Label>
          <Select value={brief.aspectRatio} onChange={(e) => set("aspectRatio", e.target.value as CreativeBrief["aspectRatio"])}>
            <option value="9:16">9:16 · Reels / Shorts</option>
            <option value="16:9">16:9 · YouTube</option>
            <option value="1:1">1:1 · Square</option>
          </Select>
        </label>
        <label className="block">
          <Label>Length</Label>
          <Select value={brief.targetSeconds} onChange={(e) => set("targetSeconds", Number(e.target.value))}>
            {[...new Set([brief.targetSeconds, ...styles.lengths])].sort((a, b) => a - b).map((s) => (
              <option key={s} value={s}>
                {s >= 60 ? `${s / 60} min` : `${s}s`}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <Label>Voice</Label>
          <Select value={brief.voiceId ?? ""} onChange={(e) => set("voiceId", e.target.value)}>
            {styles.voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <Label>Music</Label>
          <Select value={brief.musicMood ?? "none"} onChange={(e) => set("musicMood", e.target.value)}>
            {styles.musicMoods.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Select>
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={brief.narration} onChange={(e) => set("narration", e.target.checked)} /> Narration voiceover
      </label>
      <ErrorText error={error} />
      {can("creator") && (
        <Button variant="primary" className="w-full" loading={busy} disabled={brief.idea.trim().length < 3} onClick={confirm}>
          <Sparkles className="size-4" /> Confirm brief & write story · {storyCredits} credit
        </Button>
      )}
    </Card>
  );
}
