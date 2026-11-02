import { Suspense } from "react";

import { PageLoading } from "@/components/ui";

import Studio from "./Studio";

export default function StudioPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Studio />
    </Suspense>
  );
}
