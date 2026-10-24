/**
 * (app)/layout.tsx — Protected app shell.
 * Reads the session server-side, redirects to /login if not authenticated,
 * to /no-access if not allow-listed. Renders sidebar + topbar for active users.
 */
import { requireAuth } from "@/lib/auth/requireRole";
import { SidebarNav, BottomNav } from "@/components/layout/NavComponents";
import { SignOutButton } from "@/components/layout/SignOutButton";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireAuth();
  const initials = profile.full_name
    ? profile.full_name
        .split(" ")
        .slice(0, 2)
        .map((s) => s[0])
        .join("")
        .toUpperCase()
    : profile.email[0].toUpperCase();

  return (
    <div className="flex min-h-dvh">
      {/* ── Desktop Sidebar ── */}
      <aside
        className="hidden md:flex flex-col w-60 shrink-0 fixed top-0 left-0 bottom-0 z-30"
        style={{
          background: "var(--surface-raised)",
          borderRight: "1px solid var(--surface-border)",
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold text-white shrink-0"
            style={{
              background: "linear-gradient(135deg, hsl(252 68% 52%), hsl(196 80% 45%))",
            }}
          >
            T
          </div>
          <div>
            <p
              className="text-sm font-semibold leading-none"
              style={{ color: "var(--text-primary)" }}
            >
              Terrabithia
            </p>
            <p className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
              Ops
            </p>
          </div>
        </div>

        <div className="mx-5 h-px" style={{ background: "var(--surface-border)" }} />

        {/* Nav */}
        <div className="flex-1 overflow-y-auto py-4">
          <SidebarNav role={profile.role} />
        </div>

        <div className="mx-5 h-px" style={{ background: "var(--surface-border)" }} />

        {/* User section */}
        <div className="px-3 py-4 flex flex-col gap-1">
          <div className="flex items-center gap-3 px-3 py-2">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0"
              style={{
                background: "linear-gradient(135deg, hsl(252 68% 40%), hsl(196 80% 35%))",
              }}
            >
              {initials}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium truncate" style={{ color: "var(--text-primary)" }}>
                {profile.full_name ?? profile.email}
              </p>
              <p className="text-[10px] capitalize" style={{ color: "var(--text-muted)" }}>
                {profile.role}
              </p>
            </div>
          </div>
          <SignOutButton />
        </div>
      </aside>

      {/* ── Main area ── */}
      <div className="flex-1 md:ml-60 flex flex-col min-h-dvh">
        {/* Topbar (mobile) */}
        <header
          className="md:hidden flex items-center justify-between px-4 py-3 sticky top-0 z-20"
          style={{
            background: "rgba(13,13,26,0.9)",
            backdropFilter: "blur(12px)",
            borderBottom: "1px solid var(--surface-border)",
          }}
        >
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white"
              style={{
                background: "linear-gradient(135deg, hsl(252 68% 52%), hsl(196 80% 45%))",
              }}
            >
              T
            </div>
            <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              Terrabithia Ops
            </span>
          </div>
          <div className="flex items-center gap-2">
            <SignOutButton />
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white"
              style={{
                background: "linear-gradient(135deg, hsl(252 68% 40%), hsl(196 80% 35%))",
              }}
            >
              {initials}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 md:p-6 pb-24 md:pb-6 animate-in">{children}</main>
      </div>

      {/* ── Mobile Bottom Nav ── */}
      <div className="md:hidden">
        <BottomNav role={profile.role} />
      </div>
    </div>
  );
}
