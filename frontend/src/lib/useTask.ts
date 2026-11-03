"use client";

import { useEffect, useRef, useState } from "react";

import { api } from "./api";
import type { GenTask } from "./types";

export const isFinished = (t: GenTask) => t.status === "done" || t.status === "failed";

export function useTask(initial: GenTask, onFinish: (task: GenTask) => void) {
  const [task, setTask] = useState(initial);
  const callback = useRef(onFinish);
  useEffect(() => {
    callback.current = onFinish;
  });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    async function poll() {
      try {
        const t = await api.task(initial.id);
        if (cancelled) return;
        setTask(t);
        if (isFinished(t)) callback.current(t);
        else timer = setTimeout(poll, 400);
      } catch {
        if (!cancelled) timer = setTimeout(poll, 1500);
      }
    }
    if (isFinished(initial)) callback.current(initial);
    else timer = setTimeout(poll, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.id]);

  return task;
}
