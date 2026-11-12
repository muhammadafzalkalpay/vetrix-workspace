// Server-side configuration, checked once on first use. A missing or
// malformed value fails loudly at startup instead of halfway through a call.
// Never import this file from a client component.
import { z } from "zod";

const optional = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

const booleanString = z
  .enum(["true", "false"])
  .default("true")
  .transform((v) => v === "true");

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_URL: z.string().url().default("http://localhost:3000"),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

    // Demo mode simulates every call and text. It defaults to on, so real
    // messages are only possible when someone deliberately turns it off.
    VETRIX_DEMO_MODE: booleanString,

    REGISTRY_DATABASE_URL: z.string().url(),
    DEMO_CLINIC_DATABASE_URL: optional,

    TWILIO_ACCOUNT_SID: optional,
    TWILIO_AUTH_TOKEN: optional,
    SENDGRID_API_KEY: optional,
    OPENAI_API_KEY: optional,
    SENTRY_DSN: optional,
  })
  .superRefine((env, ctx) => {
    if (env.VETRIX_DEMO_MODE) return;
    // Real mode must be able to send, otherwise messages would fail silently.
    for (const key of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "SENDGRID_API_KEY"] as const) {
      if (!env[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: "Required when VETRIX_DEMO_MODE is false",
        });
      }
    }
  });

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

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
