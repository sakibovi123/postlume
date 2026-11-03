"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, Card, ErrorText, Input, Label } from "@/components/ui";
import { api, setActiveOrg } from "@/lib/api";

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "", organizationName: "" });
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const invite = typeof window !== "undefined" ? window.sessionStorage.getItem("taleloop.invite") : null;
      const me = await api.register({ ...form, inviteToken: invite ?? undefined });
      window.sessionStorage.removeItem("taleloop.invite");
      setActiveOrg(me.activeOrganization?.id ?? null);
      router.replace(invite ? "/studio" : "/onboarding");
    } catch (err) {
      setError(err);
      setLoading(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-4">
        <h1 className="text-xl font-semibold">Create your studio</h1>
        <label className="block">
          <Label>Your name</Label>
          <Input value={form.name} onChange={set("name")} autoComplete="name" />
        </label>
        <label className="block">
          <Label>Email</Label>
          <Input type="email" required value={form.email} onChange={set("email")} autoComplete="email" />
        </label>
        <label className="block">
          <Label hint="8+ characters">Password</Label>
          <Input type="password" required minLength={8} value={form.password} onChange={set("password")} autoComplete="new-password" />
        </label>
        <label className="block">
          <Label hint="optional">Studio / organization name</Label>
          <Input value={form.organizationName} onChange={set("organizationName")} placeholder="Midnight Tales" />
        </label>
        <ErrorText error={error} />
        <Button variant="primary" className="w-full" loading={loading}>
          Create account
        </Button>
        <p className="text-center text-sm text-mute">
          Already have an account?{" "}
          <Link href="/login" className="text-accent hover:underline">
            Log in
          </Link>
        </p>
      </form>
    </Card>
  );
}
