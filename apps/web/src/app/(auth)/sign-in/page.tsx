import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { safeNextPath } from "@/features/auth/messages";
import { SignInForm } from "@/features/auth/sign-in-form";
import { logger } from "@/lib/logger";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Sign in · Vetrix" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  // If the database can't be reached, say so instead of failing the page.
  let session: Awaited<ReturnType<typeof getSession>> = null;
  let unavailable = false;
  try {
    session = await getSession();
  } catch (error) {
    unavailable = true;
    logger.error("sign-in: database unavailable", { error: (error as Error).message });
  }
  if (session) redirect(next);
  const notice = params.notice === "password-set" || params.notice === "signed-out" ? params.notice : undefined;
  return (
    <>
      <header className="grid gap-2">
        <span className="w-fit rounded-full bg-secondary px-3 py-1 text-caption font-semibold text-secondary-foreground">
          Welcome back
        </span>
        <h1 className="text-h1">Sign in to Vetrix</h1>
        <p className="text-muted-foreground">Use the email address your clinic added you with.</p>
      </header>
      {unavailable && (
        <Alert variant="error">
          Vetrix can&apos;t reach its database right now, so signing in won&apos;t work. Please try again in a few minutes.
        </Alert>
      )}
      <SignInForm next={next} notice={notice} />
    </>
  );
}
