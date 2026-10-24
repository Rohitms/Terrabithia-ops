import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/supabase";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

// React cache deduplicates only within this server render, never across users.
export const getUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error) {
    if (
      error.name === "AuthSessionMissingError" ||
      error.status === 401 ||
      error.status === 403 ||
      error.code === "refresh_token_not_found" ||
      error.code === "refresh_token_already_used"
    )
      return null;
    throw new Error("Unable to verify your session. Please try again.");
  }
  if (!user) return null;
  const { data, error: accessError } = await supabase.rpc("get_my_access").maybeSingle();
  if (accessError) throw new Error("Unable to verify account access. Please try again.");
  return { user, profile: data as Profile | null };
});
