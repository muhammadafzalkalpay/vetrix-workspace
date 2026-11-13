// Server-side configuration, checked once on first use. A missing or
// malformed value fails loudly at startup instead of halfway through a call.
// Never import this file from a client component.
import { z } from "zod";

const optional = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

/**
 * sandbox: calls and texts are simulated, saved and labelled, never sent.
 * live: real Twilio and SendGrid delivery.
 */
export const messagingModeSchema = z.enum(["sandbox", "live"]);
export type MessagingMode = z.infer<typeof messagingModeSchema>;

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_URL: z.string().url().default("http://localhost:3000"),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

    // Must be set explicitly in production. Elsewhere it defaults to sandbox,
    // so real messages are only sent when someone deliberately chooses live.
    MESSAGING_MODE: messagingModeSchema.optional(),

    // Clinic databases are not listed here: each organization's database is
    // found through the registry (tenant_databases.database_ref).
    REGISTRY_DATABASE_URL: z.string().url(),

    // Signs session cookies. At least 32 random characters; generate with
    // `openssl rand -base64 32`. Changing it signs everyone out.
    BETTER_AUTH_SECRET: z.string().min(32, "Must be at least 32 characters"),
    // Sender for sign-in emails (verification, password reset) and client email.
    EMAIL_FROM: z.string().email().optional().or(z.literal("").transform(() => undefined)),

    TWILIO_ACCOUNT_SID: optional,
    TWILIO_AUTH_TOKEN: optional,
    SENDGRID_API_KEY: optional,
    // OpenAI (the AI front desk). Without a key, texts and calls are answered
    // by the scripted sandbox AI, even in live mode (so Twilio can be tested
    // before OpenAI is set up). Model names are set here, not in code, so a
    // newer model needs no release.
    OPENAI_API_KEY: optional,
    /** Text model for triage and replies, e.g. a current "mini" model. */
    OPENAI_TEXT_MODEL: optional,
    /** Realtime speech model for live calls (voice service). */
    OPENAI_REALTIME_MODEL: optional,
    // Public home page. The "Call Riley" button dials this number (the
    // clinic's Twilio number, any format); without it the button says the
    // phone line is coming soon.
    PUBLIC_CALL_NUMBER: optional,
    // "Try Riley in your browser" runs against this organization's clinic
    // database (slug). It must be a sample clinic: visitors create sample
    // clients and bookings there. Unset: the browser trial is off.
    PUBLIC_SANDBOX_ORG: optional,
    // Bearer token Cloud Scheduler sends to /api/jobs/tick. Required in production.
    JOBS_SECRET: optional,
    SENTRY_DSN: optional,
  })
  .superRefine((env, ctx) => {
    if (!env.MESSAGING_MODE && env.NODE_ENV === "production") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["MESSAGING_MODE"],
        message: 'Required in production: "sandbox" or "live"',
      });
    }
    // Sign-in emails (password reset, verification) are always delivered for
    // real in production, whatever MESSAGING_MODE says: without them nobody
    // could sign in. MESSAGING_MODE only governs messages to clinic clients.
    if (env.NODE_ENV === "production") {
      for (const key of ["SENDGRID_API_KEY", "EMAIL_FROM"] as const) {
        if (!env[key]) {
          ctx.addIssue({ code: "custom", path: [key], message: "Required in production for sign-in emails" });
        }
      }
      // Without it anyone could trigger the scheduled jobs.
      if (!env.JOBS_SECRET || env.JOBS_SECRET.length < 32) {
        ctx.addIssue({ code: "custom", path: ["JOBS_SECRET"], message: "Required in production: at least 32 random characters" });
      }
    }
    // A key without a model would fail on the first call.
    if (env.OPENAI_API_KEY && !env.OPENAI_TEXT_MODEL) {
      ctx.addIssue({ code: "custom", path: ["OPENAI_TEXT_MODEL"], message: "Set the text model to use with OPENAI_API_KEY" });
    }
    if (env.MESSAGING_MODE !== "live") return;
    // Live mode must be able to send and answer calls, otherwise they would fail silently.
    for (const key of [
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "SENDGRID_API_KEY",
      "EMAIL_FROM",
    ] as const) {
      if (!env[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: "Required when MESSAGING_MODE is live",
        });
      }
    }
  })
  .transform((env) => ({ ...env, MESSAGING_MODE: env.MESSAGING_MODE ?? ("sandbox" as const) }));

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    // Lists variable names only, never their values.
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}

/**
 * Reads only the messaging mode, for screens that show the Sandbox label.
 * Fails closed: anything other than an explicit "live" counts as sandbox.
 */
export function getMessagingMode(source: Record<string, string | undefined> = process.env): MessagingMode {
  return source.MESSAGING_MODE === "live" ? "live" : "sandbox";
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
