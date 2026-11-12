"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { useFormStatus } from "react-dom";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";

/** Error for one field, when the action reported it for that field. */
export function fieldError(state: ActionResult | null, field: string): string | undefined {
  return state && !state.ok && state.field === field ? state.error : undefined;
}

/** Errors not tied to a field (or for a field this form does not show). */
export function FormError({ state, fields }: { state: ActionResult | null; fields: string[] }) {
  if (!state || state.ok || (state.field && fields.includes(state.field))) return null;
  return (
    <Alert variant="error">
      <AlertCircle aria-hidden />
      <p>{state.error}</p>
    </Alert>
  );
}

export function SubmitButton({ children, pendingText }: { children: React.ReactNode; pendingText: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="min-w-32">
      {pending && <Loader2 className="animate-spin" aria-hidden />}
      {pending ? pendingText : children}
    </Button>
  );
}

export function FormSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-5 rounded-xl border bg-card p-5 shadow-card sm:p-6 md:grid-cols-[220px_minmax(0,1fr)]">
      <div className="grid content-start gap-1">
        <h3 className="text-body font-semibold">{title}</h3>
        {description && <p className="text-small text-muted-foreground">{description}</p>}
      </div>
      <div className="grid gap-4">{children}</div>
    </section>
  );
}

/**
 * Default values for a form: what was just submitted (after an error), else
 * the saved record. Text fields use `text`, checkboxes `on` and `has`.
 */
export function formDefaults(state: ActionResult | null) {
  const sent = state && !state.ok ? state.values : undefined;
  const one = (k: string) => {
    const v = sent?.[k];
    return Array.isArray(v) ? v[0] : v;
  };
  return {
    submitted: Boolean(sent),
    text: (k: string, saved: string | number | null | undefined) => (sent ? (one(k) ?? "") : (saved ?? "")) as string | number,
    on: (k: string, saved: boolean | undefined) => (sent ? one(k) === "on" : Boolean(saved)),
    has: (k: string, value: string, saved: readonly string[] | undefined) => {
      if (!sent) return Boolean(saved?.includes(value));
      const v = sent[k];
      return Array.isArray(v) ? v.includes(value) : v === value;
    },
  };
}
