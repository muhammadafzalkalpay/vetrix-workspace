import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ForgotPasswordForm } from "@/features/auth/forgot-password-form";

export const metadata: Metadata = { title: "Set or reset your password · Vetrix" };

export default function ForgotPasswordPage() {
  return (
    <>
      <header className="grid gap-1">
        <h1 className="text-h1">Set or reset your password</h1>
        <p className="text-muted-foreground">
          New to Vetrix, or forgot your password? Enter your email and we will send you a link.
        </p>
      </header>
      <ForgotPasswordForm />
      <Link
        href="/sign-in"
        className="inline-flex items-center gap-1.5 text-small font-medium text-primary underline-offset-4 hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to sign in
      </Link>
    </>
  );
}
