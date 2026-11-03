"use client";

import { Clapperboard, Crown, Film, History, ImageIcon, Quote, RotateCcw, Save, Sparkles, Wand2 } from "lucide-react";
import { useState } from "react";

import { Stagger } from "@/components/fx";
import { useSession } from "@/components/session";
import { Badge, Button, Card, Chip, cx, ErrorText, Input, Label, Select, Textarea } from "@/components/ui";
import { api, videoCredits } from "@/lib/api";
import type { Billing, Brief, GenTask, Story, StylesInfo, Tier, Video } from "@/lib/types";

const QUICK = ["Make it scarier", "Stronger hook", "Make it funnier", "Shorter", "More emotional ending", "Simpler words for kids"];
const TIERS: { id: Tier; label: string; detail: string; icon: typeof Film }[] = [
  { id: "lite", label: "Lite", detail: "Keyframes with pan & zoom", icon: ImageIcon },
  { id: "standard", label: "Standard", detail: "AI video clips", icon: Film },
  { id: "premium", label: "Premium", detail: "Top video model", icon: Crown },
];
const AVATAR = ["from-accent to-emerald-500", "from-hot to-orange-400", "from-sky-400 to-indigo-500", "from-amber-300 to-rose-500", "from-fuchsia-400 to-violet-600"];

export function StoryEditor({
  stories,
  briefs,
  styles,
  billing,
  onChanged,
  onRender,
  onTask,
}: {
  stories: Story[];
  briefs: Brief[];
  styles: StylesInfo;
  billing: Billing | null;
  onChanged: (selectId?: number) => Promise<void>;
  onRender: (video: Video) => void;
  onTask: (task: GenTask) => void;
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
    const task = await api.rewriteStory(story.id, text);
    setInstruction("");
    onTask(task);
  });
  const regenerate = () => run("regen", async () => onTask(await api.generateStory(story.projectId, story.briefId)));
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
    <div className="space-y-5">
      <Card className="relative overflow-hidden">
        <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-accent/10 blur-3xl" />
        <Stagger index={0} className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Step 2 · Your story</p>
            {story.status === "approved" && <Badge tone="ok">Approved</Badge>}
            {!latest && <Badge tone="warn">Older version</Badge>}
          </div>
          <div className="flex items-center gap-2">
            <History className="size-4 text-mute" />
            <Select className="w-44 py-1.5" value={story.id} onChange={(e) => setSelectedId(Number(e.target.value))}>
              {stories.map((s) => (
                <option key={s.id} value={s.id}>
                  v{s.version} · {s.source}
                  {s.status === "approved" ? " ✓" : ""}
                </option>
              ))}
            </Select>
          </div>
        </Stagger>

        <div key={story.id} className="relative mt-5 space-y-6">
          <Stagger index={1}>
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className="w-full bg-transparent text-3xl font-semibold tracking-tight outline-none md:text-4xl"
            />
            <input
              value={draft.logline}
              onChange={(e) => setDraft({ ...draft, logline: e.target.value })}
              className="mt-2 w-full bg-transparent text-mute outline-none focus:text-ink"
            />
          </Stagger>

          <Stagger index={2}>
            <div className="relative rounded-2xl border-l-2 border-accent bg-accent/[0.05] py-3 pl-11 pr-4">
              <Quote className="absolute left-3.5 top-3.5 size-4 text-accent" />
              <Label hint="first 3 seconds">Hook</Label>
              <input
                value={draft.hook}
                onChange={(e) => setDraft({ ...draft, hook: e.target.value })}
                className="w-full bg-transparent text-lg font-medium outline-none"
              />
            </div>
          </Stagger>

          <Stagger index={3}>
            <Label hint={`${words} words · ~${Math.round(words / 2.6)}s narration`}>Narration script</Label>
            <Textarea
              rows={10}
              value={draft.script}
              onChange={(e) => setDraft({ ...draft, script: e.target.value })}
              className="rounded-2xl border-white/[0.05] bg-black/20 p-5 font-[450] leading-8"
            />
          </Stagger>

          <Stagger index={4}>
            <Label hint="reused in every scene for consistency">Cast</Label>
            <div className="grid gap-3 sm:grid-cols-2">
              {draft.characters.map((c, i) => (
                <div key={i} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3">
                  <div className="mb-2 flex items-center gap-2.5">
                    <span className={cx("grid size-9 place-items-center rounded-full bg-linear-to-br text-sm font-bold text-black", AVATAR[i % AVATAR.length])}>
                      {c.name.slice(0, 1)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{c.name}</p>
                      <p className="truncate text-xs text-mute">{c.role}</p>
                    </div>
                  </div>
                  <textarea
                    rows={3}
                    value={c.visualDescription}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        characters: draft.characters.map((x, j) => (j === i ? { ...x, visualDescription: e.target.value } : x)),
                      })
                    }
                    className="w-full resize-none bg-transparent text-xs leading-relaxed text-mute outline-none focus:text-ink"
                  />
                </div>
              ))}
            </div>
          </Stagger>
        </div>

        {can("creator") && (
          <div className="relative mt-6 flex flex-wrap gap-2 border-t border-white/[0.06] pt-5">
            <Button onClick={save} disabled={!dirty} loading={busy === "save"}>
              <Save className="size-4" /> Save as new version
            </Button>
            <Button onClick={regenerate} loading={busy === "regen"} disabled={!!busy}>
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
        <Stagger index={5}>
          <Card className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Wand2 className="size-4 text-accent" /> Ask the AI to revise · 1 credit
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {QUICK.map((q) => (
                <Chip key={q} disabled={!!busy} onClick={() => rewrite(q)}>
                  {q}
                </Chip>
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
              <Button loading={busy === "rewrite"} disabled={!instruction.trim() || !!busy}>
                Rewrite
              </Button>
            </form>
          </Card>
        </Stagger>
      )}

      {can("creator") && (
        <Stagger index={6}>
          <Card className="space-y-5 border-accent/20">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Step 3</p>
              <h3 className="mt-1 text-xl font-semibold tracking-tight">Approve & generate video</h3>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {TIERS.map((t) => {
                const ok = allowed.includes(t.id);
                const active = render.tier === t.id;
                const c = billing ? videoCredits(billing.quotes.video_render_per_10s, t.id, seconds) : null;
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    disabled={!ok}
                    onClick={() => setRender({ ...render, tier: t.id })}
                    className={cx(
                      "relative rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-35",
                      active ? "glow border-transparent bg-accent/[0.07]" : "border-white/[0.08] hover:border-white/20",
                    )}
                  >
                    <span className={cx("mb-3 grid size-9 place-items-center rounded-xl", active ? "accent-gradient" : "bg-white/[0.06] text-mute")}>
                      <Icon className="size-4" />
                    </span>
                    <p className="font-semibold">{t.label}</p>
                    <p className="text-xs text-mute">{t.detail}</p>
                    <p className={cx("mt-2 text-xs font-medium", active ? "text-accent" : "text-ink/70")}>{ok ? `${c} credits` : "Upgrade plan"}</p>
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
            <label className="flex w-fit items-center gap-2 text-sm text-mute">
              <input type="checkbox" className="accent-[var(--color-accent)]" checked={render.captions} onChange={(e) => setRender({ ...render, captions: e.target.checked })} />
              Burned-in captions
            </label>
            <ErrorText error={error} />
            <Button variant="primary" className="w-full py-3.5 text-base" loading={busy === "render"} disabled={!!busy} onClick={startRender}>
              <Clapperboard className="size-5" /> {dirty ? "Save, approve & generate" : "Approve & generate video"}
              {cost !== null && <span className="rounded-full bg-black/15 px-2 py-0.5 text-sm">{cost} credits</span>}
            </Button>
            {billing && cost !== null && cost > billing.creditsBalance && (
              <p className="text-xs text-warn">You have {billing.creditsBalance} credits. Add more on the Billing page.</p>
            )}
          </Card>
        </Stagger>
      )}
    </div>
  );
}
