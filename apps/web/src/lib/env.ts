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

    TWILIO_ACCOUNT_SID: optional,
    TWILIO_AUTH_TOKEN: optional,
    SENDGRID_API_KEY: optional,
    OPENAI_API_KEY: optional,
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
    if (env.MESSAGING_MODE !== "live") return;
    // Live mode must be able to send, otherwise messages would fail silently.
    for (const key of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "SENDGRID_API_KEY"] as const) {
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
