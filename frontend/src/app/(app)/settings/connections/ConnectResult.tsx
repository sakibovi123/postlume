"use client";

import { useSearchParams } from "next/navigation";

export default function ConnectResult() {
  const params = useSearchParams();
  const error = params.get("error");
  const connected = params.get("connected");
  if (error)
    return <p className="mb-4 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>;
  if (connected)
    return (
      <p className="mb-4 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm text-ok">
        Connected {params.get("count") ?? ""} {connected} account(s).
      </p>
    );
  return null;
}
