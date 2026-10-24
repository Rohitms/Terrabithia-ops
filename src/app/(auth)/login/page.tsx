/**
 * /login — Google OAuth sign-in page.
 * Redirects to /dashboard if the user is already active.
 */
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth/getUser";
import LoginButton from "./LoginButton";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In",
};
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const session = await getUser();
  if (session?.profile?.is_active) redirect("/dashboard");
  if (session && error !== "access_check_failed") redirect("/no-access");

  return (
    <div className="glass-card p-8 flex flex-col items-center gap-6 text-center">
      {/* Logo / wordmark */}
      <div className="flex flex-col items-center gap-3">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-bold"
          style={{
            background: "linear-gradient(135deg, hsl(252 68% 52%), hsl(196 80% 45%))",
          }}
        >
          T
        </div>
        <div>
          <h1
            className="text-xl font-semibold tracking-tight"
            style={{ color: "var(--text-primary)" }}
          >
            Terrabithia Ops
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>
            Internal business management
          </p>
        </div>
      </div>

      <div className="w-full h-px" style={{ background: "var(--surface-border)" }} />

      <div className="w-full flex flex-col gap-3">
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Sign in with your Terrabithia Google account
        </p>
        {error ? (
          <p role="alert" className="text-sm">
            {error === "access_check_failed"
              ? "We could not verify your access. Please try again."
              : "Sign-in was not completed. Please try again."}
          </p>
        ) : null}
        <LoginButton />
      </div>

      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Access is by invitation only. Contact the admin if you need access.
      </p>
    </div>
  );
}
