"use client";

import { useSearchParams } from "next/navigation";

const NAMES: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", youtube: "YouTube" };

export default function ConnectResult() {
  const params = useSearchParams();
  const error = params.get("error");
  const connected = params.get("connected");
  if (error)
    return <p className="mb-6 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>;
  if (connected) {
    const count = Number(params.get("count") ?? 1);
    return (
      <p className="mb-6 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm text-ok">
        Connected {count} {NAMES[connected] ?? connected} {count === 1 ? "account" : "accounts"}.
      </p>
    );
  }
  return null;
}
