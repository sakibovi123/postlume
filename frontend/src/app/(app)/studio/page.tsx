"use client";

import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useSession } from "@/components/session";
import { Empty, ErrorText, PageHeader, Spinner } from "@/components/ui";
import { PRESET_LOOK, StatusBadge } from "@/components/video-bits";
import { api } from "@/lib/api";
import type { ProjectSummary, StylePreset } from "@/lib/types";

export default function StudioHome() {
  const { can } = useSession();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api.projects().then(setProjects).catch(setError);
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
    <div className="max-w-6xl">
      <PageHeader
        title="Studio"
        subtitle="Each project is one conversation with the director: brief, story, and videos."
        actions={
          can("creator") && (
            <Link href="/studio/new" className="accent-gradient inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium text-white">
              <Plus className="size-4" /> New video
            </Link>
          )
        }
      />
      <ErrorText error={error} />
      {!projects ? (
        <Spinner />
      ) : projects.length === 0 ? (
        <Empty title="No projects yet">
          <Link href="/studio/new" className="text-coral">
            Start your first video
          </Link>
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => {
            const look = PRESET_LOOK[(p.stylePreset || "custom") as StylePreset] ?? PRESET_LOOK.custom;
            return (
              <div key={p.id} className="group relative overflow-hidden rounded-xl border border-line bg-panel hover:border-violet/60">
                <Link href={`/studio/${p.id}`} className="block">
                  <div className={`relative h-32 bg-linear-to-br ${look.gradient}`}>
                    {p.latestVideo?.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.latestVideo.thumbnailUrl} alt="" className="size-full object-cover" />
                    ) : (
                      <span className="absolute inset-0 grid place-items-center text-4xl">{look.emoji}</span>
                    )}
                    {p.latestVideo && (
                      <span className="absolute left-2 top-2">
                        <StatusBadge status={p.latestVideo.status} />
                      </span>
                    )}
                  </div>
                  <div className="p-3">
                    <p className="truncate font-medium">{p.title}</p>
                    <p className="text-xs text-mute">Updated {new Date(p.updatedAt).toLocaleString()}</p>
                  </div>
                </Link>
                {can("admin") && (
                  <button
                    onClick={() => remove(p.id)}
                    className="absolute right-2 top-2 rounded-md bg-black/50 p-1.5 text-white/80 opacity-0 transition group-hover:opacity-100 hover:text-bad"
                    title="Delete project"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
