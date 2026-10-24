import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";

export async function GET(request: NextRequest) {
  // Fixed destinations on the configured origin prevent host-header and next-URL redirects.
  const origin = publicEnv().NEXT_PUBLIC_APP_URL;
  const go = (path: string) => {
    const response = NextResponse.redirect(new URL(path, origin));
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  };
  const params = request.nextUrl.searchParams;
  if (params.has("error")) return go("/login?error=auth_failed");
  const code = params.get("code");
  if (!code) return go("/login?error=missing_code");
  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return go("/login?error=auth_failed");
  const { data, error: accessError } = await supabase.rpc("get_my_access").maybeSingle();
  if (accessError) return go("/login?error=access_check_failed");
  return go(data ? "/dashboard" : "/no-access");
}
