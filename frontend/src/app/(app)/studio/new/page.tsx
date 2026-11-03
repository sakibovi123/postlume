"use client";

import { useEffect, useState } from "react";

import { Composer } from "@/components/studio/Composer";
import { ErrorText, PageLoading } from "@/components/ui";
import { api } from "@/lib/api";
import type { StylesInfo } from "@/lib/types";

export default function NewVideo() {
  const [styles, setStyles] = useState<StylesInfo | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api.styles().then(setStyles).catch(setError);
  }, []);

  if (!styles) return error ? <ErrorText error={error} /> : <PageLoading />;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8 animate-fade-up">
        <h1 className="text-3xl font-semibold tracking-tight md:text-5xl">
          What&apos;s the <span className="text-gradient">story?</span>
        </h1>
        <p className="mt-3 text-mute">Pick a look, describe your idea, and the director takes it from there.</p>
      </div>
      <div className="animate-fade-up [animation-delay:120ms]">
        <Composer styles={styles} />
      </div>
    </div>
  );
}
