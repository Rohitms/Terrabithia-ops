import "server-only";
/**
 * lib/auth/requireRole.ts
 * Server-side role enforcement. Reads role from DB — never trusts client claims.
 * Used in Server Actions (and optionally Route Handlers).
 */
import { redirect } from "next/navigation";
import { getUser } from "./getUser";

import type { AppRole } from "@/types/supabase";
export type { AppRole } from "@/types/supabase";

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Asserts the current user has one of the allowed roles.
 * Redirects to /login if not authenticated, throws ForbiddenError if wrong role.
 * Returns the profile row on success.
 */
export async function requireRole(...allowedRoles: AppRole[]) {
  const session = await getUser();

  if (!session || !session.user) {
    redirect("/login");
  }

  const { profile } = session;

  if (!profile || !profile.is_active) {
    redirect("/no-access");
  }

  if (allowedRoles.length > 0 && !allowedRoles.includes(profile.role as AppRole)) {
    throw new ForbiddenError(
      `Role '${profile.role}' is not permitted to perform this action. Required: ${allowedRoles.join(", ")}`
    );
  }

  return profile;
}

/** Convenience: only admin + manager (staff) */
export function requireStaff() {
  return requireRole("admin", "manager");
}

/** Convenience: any active authenticated user */
export function requireAuth() {
  return requireRole("admin", "manager", "sales", "viewer");
}
