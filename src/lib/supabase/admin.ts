import "server-only";
/**
 * lib/supabase/admin.ts
 * Supabase admin client using the SERVICE ROLE key.
 * ⚠️  SERVER ONLY — never import this in client-side code or expose to the browser.
 * Used for: ingest route, migrations, seed scripts, admin actions that bypass RLS.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

// Lazily initialised singleton so it is only created when actually used server-side.
let _adminClient: ReturnType<typeof createClient<Database>> | undefined;

export function getAdminClient() {
  if (!_adminClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      throw new Error(
        "NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set. " +
          "This client is server-only — do not call it from the browser."
      );
    }
    _adminClient = createClient<Database>(url, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return _adminClient;
}
