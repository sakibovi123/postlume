import { Logo } from "@/components/AppShell";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 p-4">
      <Logo />
      <div className="w-full max-w-sm">{children}</div>
      <p className="max-w-sm text-center text-xs text-mute">
        Chat with an AI director, approve a story, and get a finished video.
      </p>
    </div>
  );
}
