"use client";

import { Clapperboard, History, RotateCcw, Save, Sparkles, Wand2 } from "lucide-react";
import { useState } from "react";

import { useSession } from "@/components/session";
import { Badge, Button, Card, cx, ErrorText, Input, Label, Select, Textarea } from "@/components/ui";
import { api, videoCredits } from "@/lib/api";
import type { Billing, Brief, Story, StylesInfo, Tier, Video } from "@/lib/types";

const QUICK = ["Make it scarier", "Stronger hook", "Make it funnier", "Shorter", "More emotional ending", "Simpler words for kids"];
const TIERS: { id: Tier; label: string; detail: string }[] = [
  { id: "lite", label: "Lite", detail: "Keyframes with pan & zoom" },
  { id: "standard", label: "Standard", detail: "AI video clips" },
  { id: "premium", label: "Premium", detail: "Top video model" },
];

export function StoryEditor({
  stories,
  briefs,
  styles,
  billing,
  onChanged,
  onRender,
}: {
  stories: Story[];
  briefs: Brief[];
  styles: StylesInfo;
  billing: Billing | null;
  onChanged: (selectId?: number) => Promise<void>;
  onRender: (video: Video) => void;
}) {
  const { can } = useSession();
  const [selectedId, setSelectedId] = useState(stories[0]?.id);
  const story = stories.find((s) => s.id === selectedId) ?? stories[0];
  const brief = briefs.find((b) => b.id === story?.briefId);
  const [edit, setEdit] = useState<{ id: number; data: Story } | null>(null);
  const draft = story && edit?.id === story.id ? edit.data : story ?? null;
  const setDraft = (data: Story) => story && setEdit({ id: story.id, data });
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [render, setRender] = useState({
    tier: "lite" as Tier,
    aspectRatio: brief?.aspectRatio ?? "9:16",
    voiceId: brief?.voiceId ?? "af_heart",
    musicMood: brief?.musicMood ?? "none",
    captions: true,
  });

  if (!story || !draft) return null;
  const latest = stories[0].id === story.id;
  const dirty = (["title", "logline", "hook", "script"] as const).some((k) => draft[k] !== story[k]) ||
    JSON.stringify(draft.characters) !== JSON.stringify(story.characters);
  const seconds = brief?.targetSeconds ?? story.estimatedSeconds;
  const allowed = billing?.planInfo.tiers ?? ["lite"];
  const cost = billing ? videoCredits(billing.quotes.video_render_per_10s, render.tier, seconds) : null;

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy("");
    }
  }

  const save = () => run("save", async () => {
    const s = await api.updateStory(story.id, {
      title: draft.title, logline: draft.logline, hook: draft.hook, script: draft.script, characters: draft.characters,
    });
    await onChanged(s.id);
    setSelectedId(s.id);
  });
  const rewrite = (text: string) => run("rewrite", async () => {
    const s = await api.rewriteStory(story.id, text);
    setInstruction("");
    await onChanged(s.id);
    setSelectedId(s.id);
  });
  const regenerate = () => run("regen", async () => {
    const s = await api.generateStory(story.projectId, story.briefId);
    await onChanged(s.id);
    setSelectedId(s.id);
  });
  const restore = () => run("restore", async () => {
    const s = await api.restoreStory(story.id);
    await onChanged(s.id);
    setSelectedId(s.id);
  });
  const startRender = () => run("render", async () => {
    let target = story;
    if (dirty) target = await api.updateStory(story.id, {
      title: draft.title, logline: draft.logline, hook: draft.hook, script: draft.script, characters: draft.characters,
    });
    const video = await api.startRender(target.id, render);
    await onChanged(target.id);
    setSelectedId(target.id);
    onRender(video);
  });

  const words = draft.script.trim().split(/\s+/).filter(Boolean).length;

  return (
    <div className="space-y-4">
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="font-medium">Story</h2>
            {story.status === "approved" && <Badge tone="ok">Approved</Badge>}
            {!latest && <Badge tone="warn">Older version</Badge>}
          </div>
          <div className="flex items-center gap-2">
            <History className="size-4 text-mute" />
            <Select className="w-44" value={story.id} onChange={(e) => setSelectedId(Number(e.target.value))}>
              {stories.map((s) => (
                <option key={s.id} value={s.id}>
                  v{s.version} · {s.source}
                  {s.status === "approved" ? " ✓" : ""}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <label className="block">
          <Label>Title</Label>
          <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </label>
        <label className="block">
          <Label>Logline</Label>
          <Input value={draft.logline} onChange={(e) => setDraft({ ...draft, logline: e.target.value })} />
        </label>
        <label className="block">
          <Label hint="first 3 seconds">Hook</Label>
          <Input value={draft.hook} onChange={(e) => setDraft({ ...draft, hook: e.target.value })} />
        </label>
        <label className="block">
          <Label hint={`${words} words · ~${Math.round(words / 2.6)}s narration`}>Narration script</Label>
          <Textarea rows={10} value={draft.script} onChange={(e) => setDraft({ ...draft, script: e.target.value })} className="leading-relaxed" />
        </label>
        <div>
          <Label hint="reused in every scene for consistency">Characters</Label>
          <div className="space-y-2">
            {draft.characters.map((c, i) => (
              <div key={i} className="rounded-lg border border-line bg-bg p-3">
                <p className="mb-1 text-sm font-medium">
                  {c.name} <span className="font-normal text-mute">· {c.role}</span>
                </p>
                <Textarea
                  rows={2}
                  value={c.visualDescription}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      characters: draft.characters.map((x, j) => (j === i ? { ...x, visualDescription: e.target.value } : x)),
                    })
                  }
                />
              </div>
            ))}
          </div>
        </div>
        <ErrorText error={error} />
        {can("creator") && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={save} disabled={!dirty} loading={busy === "save"}>
              <Save className="size-4" /> Save as new version
            </Button>
            <Button onClick={regenerate} loading={busy === "regen"}>
              <Sparkles className="size-4" /> Regenerate · 1
            </Button>
            {!latest && (
              <Button onClick={restore} loading={busy === "restore"}>
                <RotateCcw className="size-4" /> Restore this version
              </Button>
            )}
          </div>
        )}
      </Card>

      {can("creator") && (
        <Card className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Wand2 className="size-4 text-violet" /> Ask the AI to revise · 1 credit
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {QUICK.map((q) => (
              <button
                key={q}
                disabled={!!busy}
                onClick={() => rewrite(q)}
                className="rounded-full border border-line px-2.5 py-1 text-xs text-mute hover:border-violet hover:text-ink disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (instruction.trim()) rewrite(instruction.trim());
            }}
          >
            <Input value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="e.g. add a twist at the end" />
            <Button loading={busy === "rewrite"} disabled={!instruction.trim()}>
              Rewrite
            </Button>
          </form>
        </Card>
      )}

      {can("creator") && (
        <Card className="space-y-4">
          <h3 className="flex items-center gap-2 font-medium">
            <Clapperboard className="size-4 text-coral" /> Approve & render
          </h3>
          <div className="grid gap-2 sm:grid-cols-3">
            {TIERS.map((t) => {
              const ok = allowed.includes(t.id);
              const c = billing ? videoCredits(billing.quotes.video_render_per_10s, t.id, seconds) : null;
              return (
                <button
                  key={t.id}
                  disabled={!ok}
                  onClick={() => setRender({ ...render, tier: t.id })}
                  className={cx(
                    "rounded-lg border p-3 text-left disabled:cursor-not-allowed disabled:opacity-40",
                    render.tier === t.id ? "border-violet bg-violet/10" : "border-line hover:border-mute/50",
                  )}
                >
                  <p className="text-sm font-medium">{t.label}</p>
                  <p className="text-xs text-mute">{t.detail}</p>
                  <p className="mt-1 text-xs">{ok ? `${c} credits` : "Upgrade plan"}</p>
                </button>
              );
            })}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <Label>Format</Label>
              <Select value={render.aspectRatio} onChange={(e) => setRender({ ...render, aspectRatio: e.target.value as typeof render.aspectRatio })}>
                {styles.aspectRatios.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </Select>
            </label>
            <label className="block">
              <Label>Voice</Label>
              <Select value={render.voiceId ?? ""} onChange={(e) => setRender({ ...render, voiceId: e.target.value })}>
                {styles.voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block">
              <Label>Music</Label>
              <Select value={render.musicMood ?? "none"} onChange={(e) => setRender({ ...render, musicMood: e.target.value })}>
                {styles.musicMoods.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </Select>
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={render.captions} onChange={(e) => setRender({ ...render, captions: e.target.checked })} /> Burned-in captions
          </label>
          <Button variant="primary" className="w-full" loading={busy === "render"} onClick={startRender}>
            {dirty ? "Save, approve & render" : "Approve & render"} {cost !== null && `· ${cost} credits`}
          </Button>
          {billing && cost !== null && cost > billing.creditsBalance && (
            <p className="text-xs text-warn">You have {billing.creditsBalance} credits. Add more on the Billing page.</p>
          )}
        </Card>
      )}
    </div>
  );
}
