import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/features/auth/sign-out-button";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "No clinic access · Vetrix" };

export default async function NoAccessPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return (
    <>
      <header className="grid gap-2">
        <h1 className="text-h1">You are not added to a clinic yet</h1>
        <p className="text-muted-foreground">
          You are signed in as <span className="font-medium text-foreground">{session.user.email}</span>, but no clinic
          has given this account access. Ask your practice manager to add you, then sign in again.
        </p>
      </header>
      <SignOutButton variant="outline" size="lg" className="w-full" />
    </>
  );
}
