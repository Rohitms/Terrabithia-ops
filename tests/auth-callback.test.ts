import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ exchange: vi.fn(), access: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { exchangeCodeForSession: mocks.exchange },
    rpc: () => ({ maybeSingle: mocks.access }),
  }),
}));
vi.mock("@/lib/env", () => ({
  publicEnv: () => ({ NEXT_PUBLIC_APP_URL: "https://ops.example.com" }),
}));
import { GET } from "@/app/auth/callback/route";

describe("OAuth callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.exchange.mockResolvedValue({ error: null });
    mocks.access.mockResolvedValue({ data: { role: "admin" }, error: null });
  });
  it("ignores untrusted host and next parameters", async () => {
    const response = await GET(
      new NextRequest("https://evil.example/auth/callback?code=valid&next=https://evil.example")
    );
    expect(response.headers.get("location")).toBe("https://ops.example.com/dashboard");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.exchange).toHaveBeenCalledWith("valid");
  });
  it("rejects missing codes before contacting Supabase", async () => {
    const response = await GET(new NextRequest("https://ops.example.com/auth/callback"));
    expect(response.headers.get("location")).toBe(
      "https://ops.example.com/login?error=missing_code"
    );
    expect(mocks.exchange).not.toHaveBeenCalled();
  });
  it("handles provider denial and failed exchanges", async () => {
    let response = await GET(
      new NextRequest("https://ops.example.com/auth/callback?error=access_denied")
    );
    expect(response.headers.get("location")).toContain("error=auth_failed");
    expect(mocks.exchange).not.toHaveBeenCalled();
    mocks.exchange.mockResolvedValue({ error: { message: "expired" } });
    response = await GET(new NextRequest("https://ops.example.com/auth/callback?code=expired"));
    expect(response.headers.get("location")).toContain("error=auth_failed");
    expect(mocks.access).not.toHaveBeenCalled();
  });
  it("sends unlisted accounts to no-access", async () => {
    mocks.access.mockResolvedValue({ data: null, error: null });
    const response = await GET(new NextRequest("https://ops.example.com/auth/callback?code=valid"));
    expect(response.headers.get("location")).toBe("https://ops.example.com/no-access");
  });
  it("distinguishes database failure from a denied account", async () => {
    mocks.access.mockResolvedValue({ data: null, error: { message: "unavailable" } });
    const response = await GET(new NextRequest("https://ops.example.com/auth/callback?code=valid"));
    expect(response.headers.get("location")).toBe(
      "https://ops.example.com/login?error=access_check_failed"
    );
  });
});
