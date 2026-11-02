import { Suspense } from "react";

import { PageLoading } from "@/components/ui";

import AcceptInvite from "./AcceptInvite";

export default function InvitePage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <AcceptInvite />
    </Suspense>
  );
}
