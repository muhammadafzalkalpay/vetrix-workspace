// Sign-in with Better Auth. Users, sessions and password hashes live in the
// registry database (migration 003_auth), never in a clinic database.
//
// Public sign-up is off: staff are added by an owner or manager (and, until
// onboarding ships in Milestone 5, with `pnpm db:staff:add`). New staff set
// their password through the "Forgot password" link.
import "server-only";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { createAuthEmailSender } from "./auth-email";
import { getEnv } from "./env";
import { logger } from "./logger";
import { tenancy } from "./tenancy";

const MINUTE = 60;
const DAY = 24 * 60 * MINUTE;

function createAuth() {
  const env = getEnv();
  const log = logger.child({ component: "auth" });
  const sendEmail = createAuthEmailSender(env, log);
  const registry = tenancy().registry;

  return betterAuth({
    appName: "Vetrix",
    baseURL: env.APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.APP_URL],
    database: registry,

    user: {
      modelName: "platform_users",
      fields: {
        emailVerified: "email_verified",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      additionalFields: {
        status: { type: "string", required: false, input: false, defaultValue: "active" },
      },
    },
    session: {
      modelName: "auth_sessions",
      fields: {
        userId: "platform_user_id",
        expiresAt: "expires_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      additionalFields: {
        activeOrganizationId: {
          type: "string",
          fieldName: "active_organization_id",
          required: false,
          input: false,
        },
      },
      expiresIn: 7 * DAY, // signed out after a week without use
      updateAge: DAY, // each day of use extends it
      // Signed cookie copy of the session, checked against the database at
      // least every minute, so a disabled person is signed out within a minute.
      cookieCache: { enabled: true, maxAge: MINUTE },
    },
    account: {
      modelName: "auth_accounts",
      fields: {
        userId: "platform_user_id",
        accountId: "account_id",
        providerId: "provider_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    verification: {
      modelName: "auth_verifications",
      fields: { expiresAt: "expires_at", createdAt: "created_at", updatedAt: "updated_at" },
    },

    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 60 * MINUTE,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendEmail({
          to: user.email,
          subject: "Set your Vetrix password",
          link: url,
          text:
            `Hello ${user.name || ""},\n\n` +
            `Use this link to set your Vetrix password. It works once and expires in 1 hour:\n\n${url}\n\n` +
            "If you did not ask for this, you can ignore this email.",
        });
      },
      // Following a password link proves the person owns the email address.
      onPasswordReset: async ({ user }) => {
        if (!user.emailVerified) {
          await registry.query(`UPDATE platform_users SET email_verified = true, updated_at = now() WHERE id = $1`, [
            user.id,
          ]);
        }
      },
    },
    emailVerification: {
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: DAY,
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail({
          to: user.email,
          subject: "Confirm your email for Vetrix",
          link: url,
          text: `Hello ${user.name || ""},\n\nConfirm your email address to sign in to Vetrix:\n\n${url}\n`,
        });
      },
    },

    databaseHooks: {
      session: {
        create: {
          // Disabled people cannot start a session, even with the right password.
          before: async (session) => {
            const { rows } = await registry.query<{ status: string }>(
              `SELECT status FROM platform_users WHERE id = $1`,
              [session.userId],
            );
            if (rows[0]?.status !== "active") {
              throw new APIError("FORBIDDEN", { message: "This account is disabled. Ask your practice manager." });
            }
          },
        },
      },
    },

    rateLimit: {
      enabled: env.NODE_ENV === "production",
      // Shared by every Cloud Run instance, unlike the in-memory default.
      storage: "database",
      modelName: "auth_rate_limits",
      fields: { lastRequest: "last_request" },
      window: MINUTE,
      max: 60,
      customRules: {
        "/sign-in/email": { window: MINUTE, max: 5 },
        "/request-password-reset": { window: 15 * MINUTE, max: 3 },
        "/send-verification-email": { window: 15 * MINUTE, max: 3 },
      },
    },

    advanced: {
      cookiePrefix: "vetrix",
      useSecureCookies: env.APP_URL.startsWith("https://"),
      database: { generateId: "uuid" },
    },

    plugins: [nextCookies()], // must stay last
  });
}

type Auth = ReturnType<typeof createAuth>;
const globalForAuth = globalThis as unknown as { vetrixAuth?: Auth };

export function auth(): Auth {
  globalForAuth.vetrixAuth ??= createAuth();
  return globalForAuth.vetrixAuth;
}

export type Session = Auth["$Infer"]["Session"];
