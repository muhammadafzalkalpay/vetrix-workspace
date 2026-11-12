"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Loader2, MailCheck } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/patterns/form-field";
import { PasswordInput } from "@/components/patterns/password-input";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "./messages";
import { SUBMIT_CLASS } from "./styles";
import { signInSchema, type SignInValues } from "./schemas";

export function SignInForm({ next, notice }: { next: string; notice?: "password-set" | "signed-out" }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [unverified, setUnverified] = useState(false);
  const form = useForm<SignInValues>({ resolver: zodResolver(signInSchema), defaultValues: { email: "", password: "" } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(undefined);
    setUnverified(false);
    const { error: authError } = await authClient.signIn.email({
      email: values.email,
      password: values.password,
      callbackURL: next, // used by the confirmation link if the email is not verified yet
    });
    if (authError) {
      if (authError.code === "EMAIL_NOT_VERIFIED") setUnverified(true);
      else setError(authErrorMessage(authError));
      form.setValue("password", "");
      return;
    }
    router.replace(next);
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      {notice === "password-set" && !error && (
        <Alert variant="success">
          <MailCheck aria-hidden />
          <p>Your password is set. Sign in with it now.</p>
        </Alert>
      )}
      {notice === "signed-out" && !error && (
        <Alert variant="info">
          <p>You have been signed out.</p>
        </Alert>
      )}
      {unverified && (
        <Alert variant="info">
          <MailCheck aria-hidden />
          <p>{authErrorMessage({ code: "EMAIL_NOT_VERIFIED" })}</p>
        </Alert>
      )}
      {error && (
        <Alert variant="error">
          <AlertCircle aria-hidden />
          <p>{error}</p>
        </Alert>
      )}

      <FormField label="Email" error={errors.email?.message}>
        {(field) => (
          <Input {...field} type="email" autoComplete="email" inputMode="email" autoFocus {...form.register("email")} />
        )}
      </FormField>

      <FormField
        label="Password"
        error={errors.password?.message}
        labelAside={
          <Link href="/forgot-password" className="text-small font-medium text-primary underline-offset-4 hover:underline">
            Forgot password?
          </Link>
        }
      >
        {(field) => <PasswordInput {...field} autoComplete="current-password" {...form.register("password")} />}
      </FormField>

      <Button type="submit" size="lg" disabled={isSubmitting} className={SUBMIT_CLASS}>
        {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
        {isSubmitting ? "Signing in" : "Sign in"}
      </Button>
    </form>
  );
}
