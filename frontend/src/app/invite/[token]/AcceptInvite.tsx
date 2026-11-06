"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Card, ErrorText, PageLoading } from "@/components/ui";
import { api, ApiError, setActiveOrg } from "@/lib/api";

export default function AcceptInvite() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api
      .acceptInvite(token)
      .then((me) => {
        const joined = me.organizations[me.organizations.length - 1];
        if (joined) setActiveOrg(joined.id);
        return joined ? api.switchOrg(joined.id) : null;
      })
      .then(() => router.replace("/studio"))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 403) {
          window.sessionStorage.setItem("postlume.invite", token);
          router.replace("/signup");
        } else setError(e);
      });
  }, [token, router]);

  if (!error) return <PageLoading />;
  return (
    <div className="mx-auto mt-24 max-w-md">
      <Card className="space-y-3">
        <h1 className="text-lg font-semibold">Couldn&apos;t accept the invitation</h1>
        <ErrorText error={error} />
        <p className="text-sm text-mute">
          Log in with the email address the invitation was sent to.{" "}
          <Link className="text-accent" href="/login">
            Log in
          </Link>
        </p>
      </Card>
    </div>
  );
}
