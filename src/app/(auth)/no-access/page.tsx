import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth/getUser";
import { SignOutButton } from "@/components/layout/SignOutButton";

export const metadata: Metadata = { title: "No Access" };
export const dynamic = "force-dynamic";
export default async function NoAccessPage() {
  const session = await getUser();
  if (!session) redirect("/login");
  if (session.profile) redirect("/dashboard");
  return (
    <div className="glass-card p-8 flex flex-col items-center gap-5 text-center">
      <h1 className="text-lg font-semibold">No access</h1>
      <p className="text-sm break-all" style={{ color: "var(--text-secondary)" }}>
        {session.user.email} does not have access to Terrabithia Ops. Contact the administrator to
        approve your account.
      </p>
      <p className="text-sm">To use a different Google account, sign out first.</p>
      <SignOutButton />
    </div>
  );
}
