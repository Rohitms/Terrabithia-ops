import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In",
  description: "Sign in to Terrabithia Ops",
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex items-center justify-center relative overflow-hidden">
      {/* Background decoration */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% -10%, hsl(252 68% 28% / 0.5), transparent), radial-gradient(ellipse 60% 40% at 80% 100%, hsl(196 80% 20% / 0.3), transparent)",
        }}
      />
      <div className="relative z-10 w-full max-w-sm px-4">{children}</div>
    </div>
  );
}
