"use client";

import { Copy, Download, ImageIcon, PartyPopper, RefreshCw, RotateCcw, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useSession } from "@/components/session";
import { Badge, Button, Card, cx, ErrorText, Label, Select, Spinner, Textarea } from "@/components/ui";
import { aspectClass, isActive, RenderPipeline, StatusBadge } from "@/components/video-bits";
import { api, videoCredits } from "@/lib/api";
import type { Billing, Scene, StylesInfo, Video } from "@/lib/types";

export function VideoPanel({
  videoId,
  styles,
  billing,
  onChange,
  onDeleted,
}: {
  videoId: number;
  styles: StylesInfo;
  billing: Billing | null;
  onChange: (v: Video) => void;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const { can } = useSession();
  const [video, setVideo] = useState<Video | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState("");
  const [settingsEdit, setSettings] = useState<{ voiceId: string; musicMood: string; captions: boolean } | null>(null);

  const [tick, setTick] = useState(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    async function poll() {
      try {
        const v = await api.video(videoId);
        if (cancelled) return;
        setVideo(v);
        onChange(v);
        if (isActive(v.status)) timer = setTimeout(poll, 2000);
      } catch (e) {
        if (!cancelled) setError(e);
      }
    }
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, tick]);

  const accept = (v: Video) => {
    setVideo(v);
    onChange(v);
    if (isActive(v.status)) setTick((t) => t + 1);
  };

  if (!video) return error ? <ErrorText error={error} /> : <Spinner />;
  const settings = settingsEdit ?? { voiceId: video.voiceId, musicMood: video.musicMood, captions: video.captions };
  const active = isActive(video.status);
  const settingsDirty =
    settings.voiceId !== video.voiceId || settings.musicMood !== video.musicMood || settings.captions !== video.captions;

  async function run(label: string, fn: () => Promise<Video | void>) {
    setBusy(label);
    setError(null);
    try {
      const v = await fn();
      if (v) accept(v);
    } catch (e) {
      setError(e);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-5">
      {video.status !== "ready" && <RenderPipeline video={video} />}

      <Card className={cx("space-y-5", video.status === "ready" && "animate-scale-in")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            {video.status === "ready" && (
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-accent">
                <PartyPopper className="size-3.5" /> Your video is ready
              </p>
            )}
            <h2 className="text-xl font-semibold tracking-tight">{video.title}</h2>
            <p className="text-xs capitalize text-mute">
              Story v{video.storyVersion} · {video.tier} · {video.aspectRatio}
              {video.durationMs > 0 && ` · ${Math.round(video.durationMs / 1000)}s`}
              {video.costUsd > 0 && ` · provider cost $${video.costUsd.toFixed(2)}`}
            </p>
          </div>
          <StatusBadge status={video.status} />
        </div>
        {video.status === "failed" && (
          <div className="space-y-3 rounded-2xl border border-bad/30 bg-bad/10 p-4 text-sm">
            <p className="text-bad">The render failed and your credits were refunded.</p>
            <p className="font-mono text-xs break-all text-mute">{video.error}</p>
            {can("creator") && (
              <Button onClick={() => run("retry", () => api.retryVideo(video.id))} loading={busy === "retry"}>
                <RotateCcw className="size-4" /> Retry from the failed step
              </Button>
            )}
          </div>
        )}
        {video.outputUrl && (
          <div className={cx("relative mx-auto", video.aspectRatio === "9:16" ? "max-w-sm" : "max-w-3xl")}>
            <div className="absolute -inset-6 rounded-[40px] bg-linear-to-br from-accent/25 via-transparent to-hot/20 blur-2xl" />
            <div className="glow relative overflow-hidden rounded-3xl bg-black">
              <video
                key={video.outputUrl}
                src={video.outputUrl}
                poster={video.thumbnailUrl || undefined}
                controls
                playsInline
                className={cx("w-full", aspectClass(video.aspectRatio))}
              />
            </div>
          </div>
        )}
        <ErrorText error={error} />
        <div className="flex flex-wrap justify-center gap-2">
          {video.status === "ready" && (
            <a href={api.downloadUrl(video.id)}>
              <Button variant="primary" className="px-6">
                <Download className="size-4" /> Download MP4
              </Button>
            </a>
          )}
          {can("creator") && (
            <Button
              onClick={() =>
                run("dup", async () => {
                  const p = await api.duplicateVideo(video.id);
                  router.push(`/studio/${p.id}`);
                })
              }
              loading={busy === "dup"}
            >
              <Copy className="size-4" /> Make another like this
            </Button>
          )}
          {can("creator") && !active && (
            <Button
              variant="danger"
              onClick={() =>
                confirm("Delete this video?") &&
                run("delete", async () => {
                  await api.deleteVideo(video.id);
                  onDeleted();
                })
              }
            >
              <Trash2 className="size-4" /> Delete
            </Button>
          )}
        </div>
      </Card>

      {can("creator") && video.scenes && video.scenes.length > 0 && (
        <Card className="space-y-3">
          <h3 className="text-sm font-semibold">Voice, music & captions</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <Label>Voice</Label>
              <Select value={settings.voiceId} onChange={(e) => setSettings({ ...settings, voiceId: e.target.value })} disabled={active}>
                {styles.voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block">
              <Label>Music</Label>
              <Select value={settings.musicMood} onChange={(e) => setSettings({ ...settings, musicMood: e.target.value })} disabled={active}>
                {styles.musicMoods.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </Select>
            </label>
            <label className="mt-6 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.captions}
                disabled={active}
                onChange={(e) => setSettings({ ...settings, captions: e.target.checked })}
              />{" "}
              Captions
            </label>
          </div>
          <Button
            disabled={!settingsDirty || active}
            loading={busy === "settings"}
            onClick={() =>
              run("settings", async () => {
                const v = await api.updateVideo(video.id, settings);
                setSettings(null);
                return v;
              })
            }
          >
            <RefreshCw className="size-4" /> Apply & re-assemble · {billing?.quotes.video_reassemble ?? 1} credit
          </Button>
        </Card>
      )}

      {video.scenes && video.scenes.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-mute">
            Scenes <span className="text-mute/60">({video.scenes.length})</span>
          </h3>
          {video.scenes.map((s) => (
            <SceneRow
              key={s.id}
              scene={s}
              video={video}
              disabled={active || !!busy}
              regenCost={billing ? videoCredits(billing.quotes.scene_regenerate_per_10s, video.tier, s.durationMs / 1000) : null}
              reassembleCost={billing?.quotes.video_reassemble ?? 1}
              onVideo={accept}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SceneRow({
  scene,
  video,
  disabled,
  regenCost,
  reassembleCost,
  onVideo,
}: {
  scene: Scene;
  video: Video;
  disabled: boolean;
  regenCost: number | null;
  reassembleCost: number;
  onVideo: (v: Video) => void;
}) {
  const { can } = useSession();
  const [open, setOpen] = useState(false);
  const [promptEdit, setPrompt] = useState<string | null>(null);
  const [captionEdit, setCaption] = useState<string | null>(null);
  const prompt = promptEdit ?? scene.imagePrompt;
  const caption = captionEdit ?? (scene.captionText || scene.narration);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<unknown>(null);

  async function run(label: string, fn: () => Promise<Video>) {
    setBusy(label);
    setError(null);
    try {
      onVideo(await fn());
      setPrompt(null);
      setCaption(null);
      setOpen(false);
    } catch (e) {
      setError(e);
    } finally {
      setBusy("");
    }
  }

  return (
    <Card className="p-3 md:p-3">
      <div className="flex gap-3">
        <div className={cx("w-20 shrink-0 overflow-hidden rounded-xl bg-white/[0.04]", aspectClass(video.aspectRatio))}>
          {scene.keyframeUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={scene.keyframeUrl} alt="" className="size-full object-cover" />
          ) : (
            <div className="grid size-full place-items-center">
              <ImageIcon className="size-5 text-mute" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-mute">
            <span className="font-medium text-ink">Scene {scene.idx + 1}</span>
            <span>{(scene.effectiveMs / 1000).toFixed(1)}s</span>
            <span>{scene.camera}</span>
            {scene.clipUrl ? <Badge tone="accent">AI clip</Badge> : scene.keyframeUrl && <Badge>pan & zoom</Badge>}
            {(scene.trimStartMs > 0 || scene.trimEndMs > 0) && <Badge>trimmed</Badge>}
            {scene.sfxPrompt && <Badge tone="ok">sound effect</Badge>}
          </div>
          <p className="text-sm">{scene.narration}</p>
          {can("creator") && (
            <button onClick={() => setOpen(!open)} className="text-xs font-medium text-accent hover:underline disabled:opacity-40" disabled={disabled}>
              {open ? "Close" : "Edit scene"}
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="mt-3 animate-fade-in space-y-3 border-t border-white/[0.06] pt-3">
          <label className="block">
            <Label hint="re-assembles only">Caption text</Label>
            <Textarea rows={2} value={caption} onChange={(e) => setCaption(e.target.value)} />
          </label>
          <Button
            disabled={disabled || caption === (scene.captionText || scene.narration)}
            loading={busy === "caption"}
            onClick={() =>
              run("caption", async () => {
                await api.updateScene(video.id, scene.id, { captionText: caption === scene.narration ? "" : caption });
                return api.reassemble(video.id);
              })
            }
          >
            <Save className="size-4" /> Save caption & re-assemble · {reassembleCost}
          </Button>
          <label className="block">
            <Label>Image prompt</Label>
            <Textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} className="text-xs" />
          </label>
          <ErrorText error={error} />
          <Button
            variant="primary"
            disabled={disabled}
            loading={busy === "regen"}
            onClick={() => run("regen", () => api.regenerateScene(video.id, scene.id, { imagePrompt: prompt }))}
          >
            <RefreshCw className="size-4" /> Regenerate this scene {regenCost !== null && `· ${regenCost} credits`}
          </Button>
        </div>
      )}
    </Card>
  );
}
