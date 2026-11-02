"use client";

import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Logo } from "@/components/AppShell";
import { ConnectionCards } from "@/components/ConnectionCards";
import { SessionProvider } from "@/components/session";
import { Button, Card, cx, PageLoading } from "@/components/ui";

const STEPS = ["Studio created", "Connect accounts", "First video"];

export default function Onboarding() {
  const [step, setStep] = useState(1);
  return (
    <SessionProvider fallback={<PageLoading />}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-6 md:py-14">
        <Logo />
        <ol className="flex flex-wrap gap-3 text-sm">
          {STEPS.map((s, i) => (
            <li
              key={s}
              className={cx(
                "flex items-center gap-2 rounded-full border px-3 py-1",
                i < step ? "border-ok/40 text-ok" : i === step ? "border-violet text-ink" : "border-line text-mute",
              )}
            >
              {i < step ? <Check className="size-3.5" /> : <span>{i + 1}</span>} {s}
            </li>
          ))}
        </ol>
        {step === 1 ? (
          <Card className="space-y-5">
            <div>
              <h1 className="text-xl font-semibold">Connect your channels</h1>
              <p className="mt-1 text-sm text-mute">
                Publishing arrives in Phase 2. Connecting now lets you see your accounts here and starts the platform
                reviews early. You can skip this step.
              </p>
            </div>
            <ConnectionCards compact />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setStep(2)}>
                Skip for now
              </Button>
              <Button variant="primary" onClick={() => setStep(2)}>
                Continue <ArrowRight className="size-4" />
              </Button>
            </div>
          </Card>
        ) : (
          <Card className="space-y-4 text-center">
            <h1 className="text-xl font-semibold">Make your first video</h1>
            <p className="text-sm text-mute">Pick a style, describe an idea, and the director takes it from there.</p>
            <Link
              href="/studio/new"
              className="accent-gradient mx-auto inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white"
            >
              Start creating <ArrowRight className="size-4" />
            </Link>
          </Card>
        )}
      </div>
    </SessionProvider>
  );
}
