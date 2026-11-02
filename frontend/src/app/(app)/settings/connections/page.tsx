import { Suspense } from "react";

import { ConnectionCards } from "@/components/ConnectionCards";
import { PageHeader } from "@/components/ui";

import ConnectResult from "./ConnectResult";

export default function ConnectionsPage() {
  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Connections"
        subtitle="Connect Instagram, Facebook Pages and YouTube. Publishing and scheduling arrive in Phase 2."
      />
      <Suspense fallback={null}>
        <ConnectResult />
      </Suspense>
      <ConnectionCards />
    </div>
  );
}
