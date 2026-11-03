"use client";

import { Feather, Quote, RotateCcw } from "lucide-react";

import { TaskProgress } from "@/components/fx";
import { Button, Card, cx, Label } from "@/components/ui";
import { useTask } from "@/lib/useTask";
import type { Character, GenTask } from "@/lib/types";

function Caret() {
  return <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-accent" />;
}

export function StoryLive({
  task: initial,
  onDone,
  onBack,
}: {
  task: GenTask;
  onDone: (task: GenTask) => void;
  onBack: () => void;
}) {
  const task = useTask(initial, (t) => t.status === "done" && onDone(t));
  const p = task.partial as { title?: string; logline?: string; hook?: string; script?: string; characters?: Partial<Character>[] };
  const writing = task.stage;

  if (task.status === "failed")
    return (
      <Card className="animate-fade-up space-y-4 text-center">
        <p className="text-lg font-semibold">The story couldn&apos;t be written</p>
        <p className="mx-auto max-w-md rounded-2xl border border-bad/30 bg-bad/10 px-4 py-2.5 text-sm text-bad">{task.error}</p>
        <p className="text-xs text-mute">Your credit was refunded.</p>
        <Button onClick={onBack}>
          <RotateCcw className="size-4" /> Back
        </Button>
      </Card>
    );

  const started = Boolean(p.title);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(300px,380px)_1fr]">
      <Card className="p-0 md:p-0 xl:sticky xl:top-24 xl:self-start">
        <TaskProgress task={task} title={task.kind === "rewrite" ? "Rewriting your story" : "Writing your story"} icon={Feather} />
      </Card>

      <Card className="relative min-h-[420px] overflow-hidden">
        <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-accent/10 blur-3xl" />
        <p className="relative flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-accent">
          <span className="size-1.5 animate-pulse rounded-full bg-accent" /> Live draft
        </p>
        {!started ? (
          <div className="relative mt-6 space-y-4">
            <div className="skeleton h-9 w-2/3 rounded-xl" />
            <div className="skeleton h-4 w-full rounded-lg" />
            <div className="skeleton h-16 w-full rounded-2xl" />
            <div className="skeleton h-40 w-full rounded-2xl" />
          </div>
        ) : (
          <div className="relative mt-5 space-y-6">
            <div className="animate-fade-up">
              <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
                {p.title}
                {writing === "title" && <Caret />}
              </h2>
              {p.logline && (
                <p className="mt-2 text-mute">
                  {p.logline}
                  {writing === "logline" && <Caret />}
                </p>
              )}
            </div>

            {p.hook && (
              <div className="relative animate-fade-up rounded-2xl border-l-2 border-accent bg-accent/[0.05] py-3 pl-11 pr-4">
                <Quote className="absolute left-3.5 top-3.5 size-4 text-accent" />
                <Label>Hook</Label>
                <p className="text-lg font-medium">
                  {p.hook}
                  {writing === "hook" && <Caret />}
                </p>
              </div>
            )}

            {p.characters && p.characters.length > 0 && (
              <div className="animate-fade-up">
                <Label>Cast</Label>
                <div className="grid gap-3 sm:grid-cols-2">
                  {p.characters.map((c, i) => (
                    <div key={i} className="animate-scale-in rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3">
                      <p className="text-sm font-semibold">
                        {c.name || "…"} {c.role && <span className="font-normal text-mute">· {c.role}</span>}
                      </p>
                      {c.visualDescription && <p className="mt-1 text-xs leading-relaxed text-mute">{c.visualDescription}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {p.script && (
              <div className="animate-fade-up">
                <Label hint={`${p.script.split(/\s+/).filter(Boolean).length} words`}>Narration</Label>
                <p className={cx("rounded-2xl bg-black/20 p-5 leading-8 whitespace-pre-wrap")}>
                  {p.script}
                  {writing === "script" && <Caret />}
                </p>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
