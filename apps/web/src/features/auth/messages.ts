// Plain messages for sign-in errors. Never say whether an email has an
// account: "wrong email or password" covers both.

export interface AuthErrorLike {
  code?: string;
  status?: number;
  message?: string;
}

export function authErrorMessage(error: AuthErrorLike | null | undefined): string {
  if (!error) return "Something went wrong. Please try again.";
  if (error.status === 429) return "Too many attempts. Wait a minute, then try again.";
  switch (error.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return "That email and password do not match. Check them and try again.";
    case "EMAIL_NOT_VERIFIED":
      return "Confirm your email address first. We have sent you a new link.";
    case "INVALID_TOKEN":
    case "TOKEN_EXPIRED":
      return "This link has expired or was already used. Ask for a new one below.";
    case "PASSWORD_TOO_SHORT":
      return "Use at least 12 characters.";
    case "PASSWORD_TOO_LONG":
      return "Use 128 characters or fewer.";
  }
  if (error.status === 403 && error.message) return error.message; // e.g. disabled account
  return "Something went wrong. Please try again.";
}

/**
 * Where to go after sign-in. Only paths on this site are allowed, so a link
 * like /sign-in?next=https://evil.example cannot send people elsewhere.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/overview"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (next.startsWith("/sign-in") || next.startsWith("/api/")) return fallback;
  return next;
}
