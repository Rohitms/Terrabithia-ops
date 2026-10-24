/**
 * lib/supabase/client.ts
 * Creates a Supabase client for use in Client Components.
 * Uses @supabase/ssr — must be called inside a Client Component or hook.
 */
"use client";

import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";
import type { Database } from "@/types/supabase";

export function createClient() {
  return createBrowserClient<Database>(
    publicEnv().NEXT_PUBLIC_SUPABASE_URL,
    publicEnv().NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}
