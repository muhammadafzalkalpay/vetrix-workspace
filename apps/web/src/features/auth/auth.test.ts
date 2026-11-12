import { describe, expect, it } from "vitest";
import { authErrorMessage, safeNextPath } from "./messages";
import { resetPasswordSchema, signInSchema } from "./schemas";

describe("sign-in messages", () => {
  it("does not reveal whether an account exists", () => {
    expect(authErrorMessage({ code: "INVALID_EMAIL_OR_PASSWORD", status: 401 })).toMatch(/do not match/);
  });

  it("explains rate limits, expired links and disabled accounts", () => {
    expect(authErrorMessage({ status: 429 })).toMatch(/Too many attempts/);
    expect(authErrorMessage({ code: "INVALID_TOKEN", status: 400 })).toMatch(/expired/);
    expect(authErrorMessage({ status: 403, message: "This account is disabled. Ask your practice manager." })).toMatch(
      /disabled/,
    );
    expect(authErrorMessage({ code: "SOMETHING_NEW", status: 500, message: "stack trace" })).toBe(
      "Something went wrong. Please try again.",
    );
  });
});

describe("redirect after sign-in", () => {
  it("only allows paths on this site", () => {
    expect(safeNextPath("/schedule?day=2026-11-12")).toBe("/schedule?day=2026-11-12");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "/sign-in", "/api/auth/x", "", null]) {
      expect(safeNextPath(bad)).toBe("/overview");
    }
  });
});

describe("form rules", () => {
  it("checks email and password on sign-in", () => {
    expect(signInSchema.safeParse({ email: "jo@clinic.com", password: "x" }).success).toBe(true);
    expect(signInSchema.safeParse({ email: "jo", password: "x" }).success).toBe(false);
  });

  it("needs a 12-character password typed twice the same", () => {
    expect(resetPasswordSchema.safeParse({ password: "short", confirm: "short" }).success).toBe(false);
    const mismatch = resetPasswordSchema.safeParse({ password: "long-enough-1", confirm: "long-enough-2" });
    expect(mismatch.success).toBe(false);
    expect(mismatch.error?.issues[0]?.path).toEqual(["confirm"]);
    expect(resetPasswordSchema.safeParse({ password: "long-enough-1", confirm: "long-enough-1" }).success).toBe(true);
  });
});
