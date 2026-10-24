"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { getNavForRole } from "@/lib/modules";
import type { AppRole } from "@/types/supabase";

interface SidebarNavProps {
  role: AppRole;
}

export function SidebarNav({ role }: SidebarNavProps) {
  const modules = getNavForRole(role);
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1 px-3" aria-label="Main navigation">
      {modules.map((mod) => {
        const Icon = mod.icon;
        const active = pathname === mod.href || pathname.startsWith(mod.href + "/");
        return (
          <Link
            key={mod.href}
            href={mod.href}
            aria-current={active ? "page" : undefined}
            id={`nav-${mod.href.replace(/\//g, "-").slice(1)}`}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150",
              active ? "text-white" : "hover:text-white"
            )}
            style={
              active
                ? {
                    background:
                      "linear-gradient(135deg, hsl(252 68% 30% / 0.8), hsl(196 80% 25% / 0.5))",
                    border: "1px solid hsl(252 68% 50% / 0.3)",
                    color: "white",
                  }
                : {
                    color: "var(--text-secondary)",
                    border: "1px solid transparent",
                  }
            }
          >
            <Icon size={17} strokeWidth={active ? 2.2 : 1.8} />
            <span>{mod.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** Mobile bottom tab bar */
export function BottomNav({ role }: SidebarNavProps) {
  const modules = getNavForRole(role);
  const pathname = usePathname();
  const visible = modules.slice(0, 5); // max 5 items on mobile

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 flex justify-around items-center px-2 pb-safe"
      style={{
        background: "rgba(13,13,26,0.95)",
        backdropFilter: "blur(16px)",
        borderTop: "1px solid var(--surface-border)",
        paddingBottom: "max(env(safe-area-inset-bottom), 8px)",
        paddingTop: "8px",
      }}
      aria-label="Mobile navigation"
    >
      {visible.map((mod) => {
        const Icon = mod.icon;
        const active = pathname === mod.href || pathname.startsWith(mod.href + "/");
        return (
          <Link
            key={mod.href}
            href={mod.href}
            aria-current={active ? "page" : undefined}
            id={`mobile-nav-${mod.href.replace(/\//g, "-").slice(1)}`}
            className="flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg min-w-[44px] min-h-[44px] justify-center"
            style={{ color: active ? "var(--brand-400)" : "var(--text-muted)" }}
          >
            <Icon size={20} strokeWidth={active ? 2.2 : 1.6} />
            <span className="text-[10px] font-medium">{mod.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
