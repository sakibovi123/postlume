"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { PageLoading } from "@/components/ui";
import { api } from "@/lib/api";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    api.me().then(
      () => router.replace("/studio"),
      () => router.replace("/login"),
    );
  }, [router]);
  return <PageLoading />;
}
