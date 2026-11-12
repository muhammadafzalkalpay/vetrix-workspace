"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Loader2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/patterns/form-field";
import { PasswordInput } from "@/components/patterns/password-input";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "./messages";
import { SUBMIT_CLASS } from "./styles";
import { resetPasswordSchema, type ResetPasswordValues } from "./schemas";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirm: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ password }) => {
    setError(undefined);
    const { error: authError } = await authClient.resetPassword({ newPassword: password, token });
    if (authError) return setError(authErrorMessage(authError));
    router.replace("/sign-in?notice=password-set");
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      {error && (
        <Alert variant="error">
          <AlertCircle aria-hidden />
          <p>{error}</p>
        </Alert>
      )}
      <FormField label="New password" hint="At least 12 characters. A short sentence is easy to remember." error={errors.password?.message}>
        {(field) => <PasswordInput {...field} autoComplete="new-password" autoFocus {...form.register("password")} />}
      </FormField>
      <FormField label="Type it again" error={errors.confirm?.message}>
        {(field) => <PasswordInput {...field} autoComplete="new-password" {...form.register("confirm")} />}
      </FormField>
      <Button type="submit" size="lg" disabled={isSubmitting} className={SUBMIT_CLASS}>
        {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
        {isSubmitting ? "Saving" : "Set password"}
      </Button>
    </form>
  );
}
