import { Suspense } from "react";

import { PluginList } from "@/components/PluginList";
import { PageHeader } from "@/components/ui";

import ConnectResult from "./ConnectResult";

export default function PluginsPage() {
  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Plugins"
        subtitle="Connect your channels now. Publishing and scheduling are coming soon."
      />
      <Suspense fallback={null}>
        <ConnectResult />
      </Suspense>
      <PluginList />
    </div>
  );
}
