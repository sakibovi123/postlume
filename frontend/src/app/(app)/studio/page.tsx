"use client";

import { ArrowUpRight, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Stagger } from "@/components/fx";
import { useSession } from "@/components/session";
import { Composer } from "@/components/studio/Composer";
import { cx, Empty, ErrorText, PageLoading } from "@/components/ui";
import { PRESET_LOOK, StatusBadge } from "@/components/video-bits";
import { api } from "@/lib/api";
import type { ProjectSummary, StylePreset, StylesInfo } from "@/lib/types";

export default function StudioHome() {
  const { can } = useSession();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [styles, setStyles] = useState<StylesInfo | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api.projects().then(setProjects).catch(setError);
    api.styles().then(setStyles).catch(setError);
  }, []);

  async function remove(id: number) {
    if (!confirm("Delete this project, its stories and videos?")) return;
    try {
      await api.deleteProject(id);
      setProjects((p) => p?.filter((x) => x.id !== id) ?? null);
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="space-y-16">
      <section className="relative mx-auto max-w-4xl pt-4 text-center md:pt-10">
        <p className="mx-auto mb-5 inline-flex animate-fade-up items-center gap-2 rounded-full border border-accent/25 bg-accent/[0.06] px-3 py-1 text-xs font-medium text-accent">
          <span className="size-1.5 animate-pulse rounded-full bg-accent" /> AI story director
        </p>
        <h1 className="animate-fade-up text-4xl font-semibold leading-[1.05] tracking-tight [animation-delay:80ms] md:text-6xl">
          Turn any idea into a <span className="text-gradient">story video</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl animate-fade-up text-mute [animation-delay:160ms]">
          Describe it once. The director writes the story, you approve it, and Taleloop renders scenes, voice and music.
        </p>
        {can("creator") && styles && (
          <div className="mt-10 animate-fade-up text-left [animation-delay:240ms]">
            <Composer styles={styles} showStyles={false} />
          </div>
        )}
      </section>

      <section>
        <div className="mb-5 flex items-end justify-between">
          <h2 className="text-xl font-semibold tracking-tight">Your projects</h2>
          <Link href="/library" className="flex items-center gap-1 text-sm text-mute hover:text-accent">
            All videos <ArrowUpRight className="size-4" />
          </Link>
        </div>
        <ErrorText error={error} />
        {!projects ? (
          <PageLoading />
        ) : projects.length === 0 ? (
          <Empty title="No projects yet">Type an idea above to make your first video.</Empty>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {projects.map((p, i) => {
              const look = PRESET_LOOK[(p.stylePreset || "custom") as StylePreset] ?? PRESET_LOOK.custom;
              return (
                <Stagger key={p.id} index={Math.min(i, 8)}>
                  <div className="group relative overflow-hidden rounded-3xl border border-white/[0.07] bg-panel transition duration-300 hover:-translate-y-1 hover:border-accent/40">
                    <Link href={`/studio/${p.id}`} className="block">
                      <div className={cx("relative aspect-[16/10] overflow-hidden bg-linear-to-br", look.gradient)}>
                        {p.latestVideo?.thumbnailUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.latestVideo.thumbnailUrl} alt="" className="size-full object-cover transition duration-500 group-hover:scale-105" />
                        ) : (
                          <span className="absolute inset-0 grid place-items-center text-5xl transition duration-500 group-hover:scale-110">{look.emoji}</span>
                        )}
                        <div className="absolute inset-0 bg-linear-to-t from-black/70 via-transparent to-transparent" />
                        {p.latestVideo && (
                          <span className="absolute left-3 top-3">
                            <StatusBadge status={p.latestVideo.status} />
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2 p-4">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{p.title}</p>
                          <p className="text-xs text-mute">{new Date(p.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</p>
                        </div>
                        <ArrowUpRight className="size-4 shrink-0 text-mute transition group-hover:text-accent" />
                      </div>
                    </Link>
                    {can("admin") && (
                      <button
                        onClick={() => remove(p.id)}
                        className="absolute right-3 top-3 rounded-full bg-black/60 p-2 text-white/80 opacity-0 backdrop-blur transition group-hover:opacity-100 hover:text-bad"
                        title="Delete project"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                </Stagger>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
