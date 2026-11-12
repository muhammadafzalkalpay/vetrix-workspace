// What a form's server action returns, and how errors become form messages.
import { isDomainError } from "@vetrix/domain";
import { logger } from "./logger";

export type ActionResult =
  | { ok: true; message?: string; data?: Record<string, unknown> }
  | {
      ok: false;
      error: string;
      field?: string;
      /** What was submitted, so the form can be refilled (React resets forms after an action). */
      values?: Record<string, string | string[]>;
    };

/** Everything a form submitted, keeping repeated fields (checkbox groups) as lists. */
export function formValues(form: FormData): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(form.keys())) {
    if (key.startsWith("$ACTION")) continue;
    const all = form.getAll(key).map(String);
    out[key] = all.length > 1 ? all : (all[0] ?? "");
  }
  return out;
}

/**
 * Domain errors are safe to show (they say what to fix). Anything else is a
 * bug: log it and show a generic message.
 */
export function toActionError(error: unknown): ActionResult {
  if (isDomainError(error)) {
    const field = typeof error.details?.field === "string" ? error.details.field : undefined;
    return { ok: false, error: error.userMessage, field };
  }
  // Next.js redirects and notFound are thrown on purpose; let them through.
  if (error && typeof error === "object" && "digest" in error) throw error;
  logger.error("form action failed", { error });
  return { ok: false, error: "Something went wrong and nothing was saved. Please try again." };
}
