"use client";

import { ArrowLeft, MessageSquare, PanelLeftClose, Pencil } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { StageStepper } from "@/components/fx";
import { useSession } from "@/components/session";
import { BriefEditor } from "@/components/studio/BriefEditor";
import { ChatPanel } from "@/components/studio/ChatPanel";
import { LumenWorkspace, type WorkspaceView } from "@/components/studio/LumenWorkspace";
import { SeriesEmpty, SeriesPanel } from "@/components/studio/SeriesPanel";
import { StoryEditor } from "@/components/studio/StoryEditor";
import { StoryLive } from "@/components/studio/StoryLive";
import { VideoPanel } from "@/components/studio/VideoPanel";
import { Card, cx, ErrorText, Input, PageLoading } from "@/components/ui";
import { isActive, StatusBadge } from "@/components/video-bits";
import { api } from "@/lib/api";
import type { Billing, ChatMessage, CreativeBrief, GenTask, ProjectDetail, StylesInfo, Video } from "@/lib/types";

type Stage = "brief" | "story" | "video";

export default function Studio() {
  const { projectId } = useParams<{ projectId: string }>();
  const id = Number(projectId);
  const search = useSearchParams();
  const router = useRouter();
  const inAssistant = usePathname().startsWith("/assistant");
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
  const [chatOpen, setChatOpen] = useState(true);
  const [view, setView] = useState<WorkspaceView>("split");
  const [storyTask, setStoryTask] = useState<GenTask | null>(null);
  const [storyKey, setStoryKey] = useState(0);

  const sendRef = useRef<(text: string) => void>(() => {});
  const registerSend = useCallback((fn: (text: string) => void) => {
    sendRef.current = fn;
  }, []);

  const loadBilling = useCallback(() => api.billing().then(setBilling).catch(() => setBilling(null)), []);

  const load = useCallback(async () => {
    const p = await api.project(id);
    setProject(p);
    return p;
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    Promise.all([load(), api.styles().then(setStyles), loadBilling()])
      .then(([p]) => {
        setTitle(p.title);
        const lastBrief = [...p.messages].reverse().find((m) => m.brief)?.brief ?? null;
        setDraftBrief(lastBrief ?? (p.briefs[0] ? stripBrief(p.briefs[0]) : null));
        setVideoId((v) => v ?? p.videos[0]?.id ?? null);
        const running = p.tasks.find((t) => t.kind === "story" || t.kind === "rewrite") ?? null;
        setStoryTask(running);
        setStage(running ? "story" : p.videos.length ? "video" : p.stories.length ? "story" : "brief");
        if (p.videos.length && !p.series && p.briefs.length) setChatOpen(false);
      })
      .catch(setError);
  }, [load, loadBilling]);

  const startStoryTask = useCallback((t: GenTask) => {
    setStoryTask(t);
    setStage("story");
  }, []);

  const finishStoryTask = useCallback(async () => {
    await Promise.all([load(), loadBilling()]);
    setStoryTask(null);
    setStoryKey((k) => k + 1);
  }, [load, loadBilling]);

  const live = !!project && (project.tasks.length > 0 || project.videos.some((v) => isActive(v.status)));
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      load().catch(() => {});
    }, 2500);
    return () => clearInterval(timer);
  }, [live, load]);

  const turnDone = useCallback(async () => {
    await Promise.all([load(), loadBilling()]);
  }, [load, loadBilling]);

  const addMessage = useCallback((m: ChatMessage) => {
    setProject((p) => (p && !p.messages.some((x) => x.id === m.id) ? { ...p, messages: [...p.messages, m] } : p));
  }, []);

  const onVideoChange = useCallback((v: Video) => {
    setProject((p) => (p ? { ...p, videos: p.videos.map((x) => (x.id === v.id ? { ...x, ...v } : x)) } : p));
    if (v.status === "ready" || v.status === "failed") loadBilling();
  }, [loadBilling]);

  if (error) return <ErrorText error={error} />;
  if (!project || !styles || !stage) return <PageLoading />;
  const agentMode = !!project.series || project.briefs.length === 0;

  const stages = [
    { id: "brief", label: "Brief", enabled: true, done: project.briefs.length > 0 },
    { id: "story", label: "Story", enabled: project.stories.length > 0 || !!storyTask, done: project.stories.some((s) => s.status === "approved") },
    { id: "video", label: "Video", enabled: project.videos.length > 0, done: project.videos.some((v) => v.status === "ready") },
  ];

  async function saveTitle() {
    setEditingTitle(false);
    if (title.trim() && title !== project!.title) {
      await api.updateProject(id, { title: title.trim() });
      setProject({ ...project!, title: title.trim() });
    }
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {inAssistant && (
            <Link
              href="/assistant"
              title="All conversations"
              className="grid size-10 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-mute transition hover:text-ink"
            >
              <ArrowLeft className="size-4" />
            </Link>
          )}
          {!agentMode && (
          <button
            onClick={() => setChatOpen(!chatOpen)}
            className={cx(
              "grid size-10 shrink-0 place-items-center rounded-full border transition",
              chatOpen ? "border-accent/40 bg-accent/10 text-accent" : "border-white/10 bg-white/[0.04] text-mute hover:text-ink",
            )}
            title={chatOpen ? "Hide director" : "Show director"}
          >
            {chatOpen ? <PanelLeftClose className="size-4" /> : <MessageSquare className="size-4" />}
          </button>
          )}
          {editingTitle ? (
            <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle} onKeyDown={(e) => e.key === "Enter" && saveTitle()} className="max-w-md text-lg" />
          ) : (
            <h1 className="truncate text-2xl font-semibold tracking-tight">{project.title}</h1>
          )}
          {can("creator") && !editingTitle && (
            <button
              onClick={() => {
                setTitle(project.title);
                setEditingTitle(true);
              }} className="text-mute hover:text-ink" title="Rename">
              <Pencil className="size-4" />
            </button>
          )}
        </div>
        {!agentMode && <StageStepper steps={stages} current={stage} onSelect={(s) => setStage(s as Stage)} />}
      </div>

      {agentMode && (
        <LumenWorkspace
          view={view}
          onViewChange={setView}
          title={project.series?.title ?? "New series"}
          subtitle={
            project.series
              ? `${project.series.episodeCount} episode${project.series.episodeCount > 1 ? "s" : ""}`
              : undefined
          }
          chat={<ChatPanel project={project} styles={styles} onMessage={addMessage} onTurnDone={turnDone} registerSend={registerSend} />}
        >
          {project.series ? (
            <SeriesPanel
              project={project}
              styles={styles}
              billing={billing}
              onVideoChange={onVideoChange}
              onReload={turnDone}
              onSend={(t) => {
                setView((v) => (v === "canvas" ? "split" : v));
                sendRef.current(t);
              }}
            />
          ) : (
            <SeriesEmpty onSend={(t) => sendRef.current(t)} />
          )}
        </LumenWorkspace>
      )}

      {!agentMode && (
      <div className={cx("grid gap-6", chatOpen && "lg:grid-cols-[380px_1fr]")}>
        {chatOpen && (
          <div className="animate-fade-in lg:sticky lg:top-24 lg:h-[calc(100vh-8rem)]">
            <ChatPanel
              project={project}
              styles={styles}
              onMessage={addMessage}
              onTurnDone={turnDone}
              registerSend={registerSend}
              onUseBrief={(b) => {
                setDraftBrief(b);
                setBriefKey((k) => k + 1);
                setStage("brief");
              }}
            />
          </div>
        )}

        <div key={stage} className="min-w-0 animate-fade-up space-y-4">
          {stage === "brief" &&
            (draftBrief || can("creator") ? (
              <BriefEditor
                key={briefKey}
                projectId={project.id}
                initial={draftBrief}
                styles={styles}
                storyCredits={billing?.quotes.story_generate ?? 1}
                onTask={startStoryTask}
              />
            ) : (
              <Card>
                <p className="text-sm text-mute">No brief yet.</p>
              </Card>
            ))}

          {stage === "story" && storyTask && (
            <StoryLive
              key={storyTask.id}
              task={storyTask}
              onDone={finishStoryTask}
              onBack={() => {
                setStoryTask(null);
                loadBilling();
                if (!project.stories.length) setStage("brief");
              }}
            />
          )}

          {stage === "story" && !storyTask && project.stories.length > 0 && (
            <StoryEditor
              stories={project.stories}
              briefs={project.briefs}
              styles={styles}
              billing={billing}
              onChanged={async () => {
                await Promise.all([load(), loadBilling()]);
              }}
              key={storyKey}
              onTask={startStoryTask}
              onRender={(v) => {
                setVideoId(v.id);
                setStage("video");
                setChatOpen(false);
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
                        "flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition",
                        v.id === videoId ? "border-accent/50 bg-accent/10" : "border-white/10 hover:border-white/25",
                      )}
                    >
                      Take {v.id} · story v{v.storyVersion} · <span className="capitalize">{v.tier}</span> <StatusBadge status={v.status} />
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
      )}
    </div>
  );
}

function stripBrief(b: ProjectDetail["briefs"][number]): CreativeBrief {
  return {
    stylePreset: b.stylePreset, customStyle: b.customStyle, idea: b.idea, genre: b.genre, aspectRatio: b.aspectRatio,
    targetSeconds: b.targetSeconds, language: b.language, narration: b.narration, voiceId: b.voiceId, musicMood: b.musicMood,
  };
}
