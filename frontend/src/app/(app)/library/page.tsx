"use client";

import { useEffect, useRef, useState } from "react";

import { Empty, ErrorText, PageHeader, Select, Spinner } from "@/components/ui";
import { isActive, PRESET_LOOK, VideoCard } from "@/components/video-bits";
import { api } from "@/lib/api";
import type { StylePreset, Video } from "@/lib/types";

export default function Library() {
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [filters, setFilters] = useState({ style: "", status: "", aspectRatio: "" });
  const [error, setError] = useState<unknown>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const list = await api.videos(filters);
        if (cancelled) return;
        setVideos(list);
        if (list.some((v) => isActive(v.status))) timer.current = setTimeout(load, 3000);
      } catch (e) {
        if (!cancelled) setError(e);
      }
    }
    load();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [filters]);

  const set = (k: keyof typeof filters) => (e: React.ChangeEvent<HTMLSelectElement>) => setFilters({ ...filters, [k]: e.target.value });

  return (
    <div className="max-w-7xl">
      <PageHeader
        title="Library"
        subtitle="Every video your team has rendered."
        actions={
          <div className="flex flex-wrap gap-2">
            <Select value={filters.style} onChange={set("style")} className="w-40">
              <option value="">All styles</option>
              {(Object.keys(PRESET_LOOK) as StylePreset[]).map((s) => (
                <option key={s} value={s}>
                  {s.replace("_", " ")}
                </option>
              ))}
            </Select>
            <Select value={filters.status} onChange={set("status")} className="w-32">
              <option value="">Any status</option>
              <option value="ready">Ready</option>
              <option value="failed">Failed</option>
            </Select>
            <Select value={filters.aspectRatio} onChange={set("aspectRatio")} className="w-32">
              <option value="">Any format</option>
              <option value="9:16">9:16</option>
              <option value="16:9">16:9</option>
              <option value="1:1">1:1</option>
            </Select>
          </div>
        }
      />
      <ErrorText error={error} />
      {!videos ? (
        <Spinner />
      ) : videos.length === 0 ? (
        <Empty title="No videos match">Approve a story in the studio to render your first video.</Empty>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {videos.map((v) => (
            <VideoCard key={v.id} video={v} />
          ))}
        </div>
      )}
    </div>
  );
}
