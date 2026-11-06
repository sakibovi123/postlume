"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, Card, ErrorText, Input, Label } from "@/components/ui";
import { api, setActiveOrg } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const me = await api.login(email, password);
      setActiveOrg(me.activeOrganization?.id ?? null);
      router.replace("/studio");
    } catch (err) {
      setError(err);
      setLoading(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-4">
        <h1 className="text-xl font-semibold">Welcome back</h1>
        <label className="block">
          <Label>Email</Label>
          <Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block">
          <Label>Password</Label>
          <Input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <ErrorText error={error} />
        <Button variant="primary" className="w-full" loading={loading}>
          Log in
        </Button>
      </form>
    </Card>
  );
}
