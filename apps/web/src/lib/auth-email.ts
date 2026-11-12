// Sign-in emails: password reset and email verification.
//
// These are platform emails to staff, not messages to clinic clients, so
// MESSAGING_MODE does not apply: without them nobody could sign in. They go
// through SendGrid whenever it is configured. In development without SendGrid
// the link is printed to the dev server terminal instead.
import type { Env } from "./env";
import type { Logger } from "./logger";

export interface AuthEmail {
  to: string;
  subject: string;
  text: string;
  /** Printed in development when SendGrid is not configured. */
  link: string;
}

export type AuthEmailSender = (email: AuthEmail) => Promise<void>;

export function createAuthEmailSender(
  env: Pick<Env, "NODE_ENV" | "SENDGRID_API_KEY" | "EMAIL_FROM">,
  log: Logger,
  fetchImpl: typeof fetch = fetch,
): AuthEmailSender {
  const { SENDGRID_API_KEY: apiKey, EMAIL_FROM: from } = env;
  if (apiKey && from) {
    return async (email) => {
      const res = await fetchImpl("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: email.to }] }],
          from: { email: from, name: "Vetrix" },
          subject: email.subject,
          content: [{ type: "text/plain", value: email.text }],
          // Links in sign-in emails must not be rewritten by click tracking.
          tracking_settings: { click_tracking: { enable: false, enable_text: false } },
        }),
      });
      if (!res.ok) {
        log.error("sign-in email failed", { status: res.status, subject: email.subject });
        throw new Error("Could not send the email. Please try again.");
      }
      log.info("sign-in email sent", { subject: email.subject });
    };
  }
  if (env.NODE_ENV === "production") {
    // env.ts already refuses this, but never fall through to printing links.
    throw new Error("SENDGRID_API_KEY and EMAIL_FROM are required in production");
  }
  return async (email) => {
    // Development only: the person running the dev server is the recipient.
    console.info(`\n[sign-in email, not sent] ${email.subject}\n  ${email.link}\n`);
  };
}
