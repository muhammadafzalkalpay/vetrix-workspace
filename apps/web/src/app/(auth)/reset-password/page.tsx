import type { Metadata } from "next";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { authErrorMessage } from "@/features/auth/messages";
import { ResetPasswordForm } from "@/features/auth/reset-password-form";

export const metadata: Metadata = { title: "Choose a password · Vetrix" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { token, error } = await searchParams;
  return (
    <>
      <header className="grid gap-1">
        <h1 className="text-h1">Choose a password</h1>
        <p className="text-muted-foreground">You will use it with your email address to sign in.</p>
      </header>
      {token && !error ? (
        <ResetPasswordForm token={token} />
      ) : (
        <>
          <Alert variant="error">
            <AlertCircle aria-hidden />
            <p>{authErrorMessage({ code: "INVALID_TOKEN" })}</p>
          </Alert>
          <Link href="/forgot-password" className={buttonVariants({ size: "lg", className: "w-full" })}>
            Send a new link
          </Link>
        </>
      )}
    </>
  );
}
