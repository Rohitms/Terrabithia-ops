import type { Metadata } from "next";
import { requireAuth } from "@/lib/auth/requireRole";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const profile = await requireAuth();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm mt-2" style={{ color: "var(--text-secondary)" }}>
          Welcome{profile.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}.
        </p>
      </div>
      <section className="glass-card p-6" aria-labelledby="workspace-heading">
        <h2 id="workspace-heading" className="text-lg font-semibold">
          Your Terrabithia workspace
        </h2>
        <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
          There’s no activity to show yet.
        </p>
        <dl className="mt-6 text-sm space-y-3">
          <div>
            <dt style={{ color: "var(--text-muted)" }}>Signed in as</dt>
            <dd className="break-all mt-1">{profile.email}</dd>
          </div>
          <div>
            <dt style={{ color: "var(--text-muted)" }}>Your role</dt>
            <dd className="capitalize mt-1">{profile.role}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
