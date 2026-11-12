"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Loader2, MailCheck } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/patterns/form-field";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "./messages";
import { SUBMIT_CLASS } from "./styles";
import { forgotPasswordSchema, type ForgotPasswordValues } from "./schemas";

export function ForgotPasswordForm() {
  const [sentTo, setSentTo] = useState<string>();
  const [error, setError] = useState<string>();
  const form = useForm<ForgotPasswordValues>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: "" } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ email }) => {
    setError(undefined);
    const { error: authError } = await authClient.requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (authError) return setError(authErrorMessage(authError));
    setSentTo(email);
  });

  if (sentTo) {
    return (
      <Alert variant="success">
        <MailCheck aria-hidden />
        <div className="grid gap-1">
          <p className="font-medium">Check your email</p>
          <p>
            If {sentTo} has a Vetrix account, we have sent a link to set a new password. It works once and expires in 1
            hour.
          </p>
        </div>
      </Alert>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
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
      <Button type="submit" size="lg" disabled={isSubmitting} className={SUBMIT_CLASS}>
        {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
        {isSubmitting ? "Sending" : "Send link"}
      </Button>
    </form>
  );
}
