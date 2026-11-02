"use client";

import { Check, Pencil } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useSession } from "@/components/session";
import { BriefEditor } from "@/components/studio/BriefEditor";
import { ChatPanel } from "@/components/studio/ChatPanel";
import { StoryEditor } from "@/components/studio/StoryEditor";
import { VideoPanel } from "@/components/studio/VideoPanel";
import { Card, cx, ErrorText, Input, PageLoading } from "@/components/ui";
import { StatusBadge } from "@/components/video-bits";
import { api } from "@/lib/api";
import type { Billing, CreativeBrief, ProjectDetail, StylesInfo, Video } from "@/lib/types";

type Stage = "brief" | "story" | "video";

export default function Studio() {
  const { projectId } = useParams<{ projectId: string }>();
  const id = Number(projectId);
  const search = useSearchParams();
  const router = useRouter();
  const { can } = useSession();

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [styles, setStyles] = useState<StylesInfo | null>(null);
  const [billing, setBilling] = useState<Billing | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [draftBrief, setDraftBrief] = useState<CreativeBrief | null>(null);
  const [briefKey, setBriefKey] = useState(0);
  const [videoId, setVideoId] = useState<number | null>(search.get("video") ? Number(search.get("video")) : null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState("");

  const loadBilling = useCallback(() => api.billing().then(setBilling).catch(() => setBilling(null)), []);

  const load = useCallback(async () => {
    const p = await api.project(id);
    setProject(p);
    setTitle(p.title);
    return p;
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    Promise.all([load(), api.styles().then(setStyles), loadBilling()])
      .then(([p]) => {
        const lastBrief = [...p.messages].reverse().find((m) => m.brief)?.brief ?? null;
        setDraftBrief(lastBrief ?? (p.briefs[0] ? stripBrief(p.briefs[0]) : null));
        setVideoId((v) => v ?? p.videos[0]?.id ?? null);
        setStage(p.videos.length ? "video" : p.stories.length ? "story" : "brief");
      })
      .catch(setError);
  }, [load, loadBilling]);

  const reloadStory = useCallback(async () => {
    await Promise.all([load(), loadBilling()]);
    setStage("story");
  }, [load, loadBilling]);

  const onVideoChange = useCallback((v: Video) => {
    setProject((p) => (p ? { ...p, videos: p.videos.map((x) => (x.id === v.id ? { ...x, ...v } : x)) } : p));
    if (v.status === "ready" || v.status === "failed") loadBilling();
  }, [loadBilling]);

  const latestBriefStory = useMemo(() => project?.stories ?? [], [project]);

  if (error) return <ErrorText error={error} />;
  if (!project || !styles || !stage) return <PageLoading />;

  const stages: { id: Stage; label: string; enabled: boolean; done: boolean }[] = [
    { id: "brief", label: "1. Brief", enabled: true, done: project.briefs.length > 0 },
    { id: "story", label: "2. Story", enabled: project.stories.length > 0, done: project.stories.some((s) => s.status === "approved") },
    { id: "video", label: "3. Video", enabled: project.videos.length > 0, done: project.videos.some((v) => v.status === "ready") },
  ];

  async function saveTitle() {
    setEditingTitle(false);
    if (title.trim() && title !== project!.title) {
      await api.updateProject(id, { title: title.trim() });
      setProject({ ...project!, title: title.trim() });
    }
  }

  return (
    <div className="mx-auto max-w-[1500px]">
      <div className="mb-4 flex items-center gap-2">
        {editingTitle ? (
          <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle} onKeyDown={(e) => e.key === "Enter" && saveTitle()} className="max-w-md text-lg" />
        ) : (
          <h1 className="truncate text-xl font-semibold">{project.title}</h1>
        )}
        {can("creator") && !editingTitle && (
          <button onClick={() => setEditingTitle(true)} className="text-mute hover:text-ink" title="Rename">
            <Pencil className="size-4" />
          </button>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(320px,420px)_1fr]">
        <div className="lg:sticky lg:top-4 lg:h-[calc(100vh-7rem)]">
          <ChatPanel
            project={project}
            styles={styles}
            onMessages={(messages) => setProject({ ...project, messages })}
            onUseBrief={(b) => {
              setDraftBrief(b);
              setBriefKey((k) => k + 1);
              setStage("brief");
            }}
          />
        </div>
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap gap-2">
            {stages.map((s) => (
              <button
                key={s.id}
                disabled={!s.enabled}
                onClick={() => setStage(s.id)}
                className={cx(
                  "flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm disabled:opacity-40",
                  stage === s.id ? "border-violet bg-violet/15 text-ink" : "border-line text-mute hover:text-ink",
                )}
              >
                {s.done && <Check className="size-3.5 text-ok" />} {s.label}
              </button>
            ))}
          </div>

          {stage === "brief" &&
            (draftBrief || can("creator") ? (
              <BriefEditor
                key={briefKey}
                projectId={project.id}
                initial={draftBrief}
                styles={styles}
                storyCredits={billing?.quotes.story_generate ?? 1}
                onStory={reloadStory}
              />
            ) : (
              <Card>
                <p className="text-sm text-mute">No brief yet.</p>
              </Card>
            ))}

          {stage === "story" && latestBriefStory.length > 0 && (
            <StoryEditor
              stories={latestBriefStory}
              briefs={project.briefs}
              styles={styles}
              billing={billing}
              onChanged={async () => {
                await Promise.all([load(), loadBilling()]);
              }}
              key={project.id}
              onRender={(v) => {
                setVideoId(v.id);
                setStage("video");
                router.replace(`/studio/${project.id}?video=${v.id}`);
              }}
            />
          )}

          {stage === "video" && project.videos.length > 0 && (
            <div className="space-y-4">
              {project.videos.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {project.videos.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => {
                        setVideoId(v.id);
                        router.replace(`/studio/${project.id}?video=${v.id}`);
                      }}
                      className={cx(
                        "flex shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-xs",
                        v.id === videoId ? "border-violet bg-violet/10" : "border-line hover:border-mute/50",
                      )}
                    >
                      #{v.id} · v{v.storyVersion} · {v.tier} <StatusBadge status={v.status} />
                    </button>
                  ))}
                </div>
              )}
              {videoId && (
                <VideoPanel
                  key={videoId}
                  videoId={videoId}
                  styles={styles}
                  billing={billing}
                  onChange={onVideoChange}
                  onDeleted={async () => {
                    const p = await load();
                    setVideoId(p.videos[0]?.id ?? null);
                    if (!p.videos.length) setStage("story");
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function stripBrief(b: ProjectDetail["briefs"][number]): CreativeBrief {
  return {
    stylePreset: b.stylePreset, customStyle: b.customStyle, idea: b.idea, genre: b.genre, aspectRatio: b.aspectRatio,
    targetSeconds: b.targetSeconds, language: b.language, narration: b.narration, voiceId: b.voiceId, musicMood: b.musicMood,
  };
}
