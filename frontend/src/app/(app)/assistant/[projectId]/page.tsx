import { Suspense } from "react";

import { PageLoading } from "@/components/ui";

import Studio from "../../studio/[projectId]/Studio";

export default function AssistantConversationPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Studio />
    </Suspense>
  );
}
