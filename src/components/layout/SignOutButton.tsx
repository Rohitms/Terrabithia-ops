"use client";

import { createClient } from "@/lib/supabase/client";
import { useState } from "react";
import { LogOut } from "lucide-react";

export function SignOutButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  async function handleSignOut() {
    setLoading(true);
    setError(false);
    try {
      const { error } = await createClient().auth.signOut({ scope: "local" });
      if (error) throw error;
      // A full navigation clears the previous user's client router cache.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Clear cached protected pages after logout.
      window.location.assign("/login");
    } catch {
      setError(true);
      setLoading(false);
    }
  }
  return (
    <div>
      <button
        type="button"
        onClick={handleSignOut}
        disabled={loading}
        className="flex items-center gap-2 px-3 py-3 rounded-xl text-sm hover:bg-white/5 disabled:opacity-60"
      >
        <LogOut size={16} aria-hidden="true" />
        <span>{loading ? "Signing out…" : "Sign out"}</span>
      </button>
      {error ? (
        <p role="alert" className="text-xs">
          Could not sign out. Please try again.
        </p>
      ) : null}
    </div>
  );
}
