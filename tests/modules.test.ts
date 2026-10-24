import { describe, it, expect } from "vitest";
import { NAV_MODULES, getNavForRole } from "@/lib/modules";
import type { AppRole } from "@/types/supabase";

describe("modules navigation registry", () => {
  it("defines all primary navigation modules", () => {
    expect(NAV_MODULES.length).toBeGreaterThan(0);
    const routes = NAV_MODULES.map((m) => m.href);
    expect(routes).toContain("/dashboard");
    expect(routes).toContain("/leads");
    expect(routes).toContain("/followups");
    expect(routes).toContain("/calendar");
    expect(routes).toContain("/bookings");
    expect(routes).toContain("/templates");
    expect(routes).toContain("/settings/users");
  });

  it("only links implemented pages", () => {
    expect(getNavForRole("admin").map((m) => m.href)).toEqual(["/dashboard"]);
  });

  it("filters routes according to role correctly", () => {
    const adminNav = getNavForRole("admin" as AppRole, true);
    expect(adminNav.some((m) => m.href === "/settings/users")).toBe(true);
    expect(adminNav.length).toBe(NAV_MODULES.length);

    const viewerNav = getNavForRole("viewer" as AppRole, true);
    expect(viewerNav.some((m) => m.href === "/settings/users")).toBe(false);
    expect(viewerNav.some((m) => m.href === "/leads")).toBe(false);
    expect(viewerNav.some((m) => m.href === "/dashboard")).toBe(true);
    expect(viewerNav.some((m) => m.href === "/calendar")).toBe(true);
  });
});
