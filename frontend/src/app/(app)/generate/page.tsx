import { Suspense } from "react";

import { PageLoading } from "@/components/ui";

import GenerateStudio from "./GenerateStudio";

export default function GeneratePage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <GenerateStudio />
    </Suspense>
  );
}
