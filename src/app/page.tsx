/**
 * Root page — redirect to dashboard if logged in, otherwise to /login.
 */
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth/getUser";

export const dynamic = "force-dynamic";

export default async function RootPage() {
  const session = await getUser();
  if (session?.profile?.is_active) {
    redirect("/dashboard");
  }
  redirect("/login");
}
