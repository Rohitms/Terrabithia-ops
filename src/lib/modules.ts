/**
 * lib/modules.ts — Navigation registry.
 * Add a new module here and it automatically appears in the sidebar / bottom bar.
 * Each entry declares which roles can see it (empty = all active users).
 */
import {
  LayoutDashboard,
  Users,
  CalendarCheck,
  Calendar,
  BookOpen,
  MessageSquare,
  Settings,
  type LucideIcon,
} from "lucide-react";
import type { AppRole } from "@/types/supabase";

export interface NavModule {
  /** Route path under (app) */
  href: string;
  /** Display label */
  label: string;
  /** Lucide icon */
  icon: LucideIcon;
  /**
   * Roles that can access this module.
   * Empty array = any active authenticated user.
   */
  allowedRoles: AppRole[];
  /** Show a badge counter (e.g. overdue count) */
  badge?: string;
  enabled?: boolean;
}

export const NAV_MODULES: NavModule[] = [
  {
    href: "/dashboard",
    enabled: true,
    label: "Dashboard",
    icon: LayoutDashboard,
    allowedRoles: [],
  },
  {
    href: "/leads",
    label: "Leads",
    icon: Users,
    allowedRoles: ["admin", "manager", "sales"],
  },
  {
    href: "/followups",
    label: "Follow-ups",
    icon: CalendarCheck,
    allowedRoles: ["admin", "manager", "sales"],
  },
  {
    href: "/calendar",
    label: "Calendar",
    icon: Calendar,
    allowedRoles: [],
  },
  {
    href: "/bookings",
    label: "Bookings",
    icon: BookOpen,
    allowedRoles: [],
  },
  {
    href: "/templates",
    label: "Templates",
    icon: MessageSquare,
    allowedRoles: ["admin", "manager", "sales"],
  },
  {
    href: "/settings/users",
    label: "Settings",
    icon: Settings,
    allowedRoles: ["admin"],
  },
];

/** Filter nav items for a given role */
export function getNavForRole(role: AppRole, includePlanned = false): NavModule[] {
  return NAV_MODULES.filter(
    (m) =>
      (includePlanned || m.enabled === true) &&
      (m.allowedRoles.length === 0 || m.allowedRoles.includes(role))
  );
}
