import { describe, expect, it } from "vitest";
import { getMessagingMode, parseEnv } from "./env";
import { createLogger } from "./logger";

const base = {
  REGISTRY_DATABASE_URL: "postgres://u:p@host/db",
  BETTER_AUTH_SECRET: "x".repeat(32),
};
const prodEmail = { SENDGRID_API_KEY: "sg", EMAIL_FROM: "desk@example.com", JOBS_SECRET: "j".repeat(32) };

describe("environment config", () => {
  it("defaults to sandbox outside production", () => {
    expect(parseEnv(base).MESSAGING_MODE).toBe("sandbox");
  });

  it("requires a long jobs secret in production", () => {
    expect(() => parseEnv({ ...base, ...prodEmail, JOBS_SECRET: "short", NODE_ENV: "production", MESSAGING_MODE: "sandbox" })).toThrow(/JOBS_SECRET/);
  });

  it("requires an explicit messaging mode in production", () => {
    expect(() => parseEnv({ ...base, ...prodEmail, NODE_ENV: "production" })).toThrow(/MESSAGING_MODE/);
    expect(parseEnv({ ...base, ...prodEmail, NODE_ENV: "production", MESSAGING_MODE: "sandbox" }).MESSAGING_MODE).toBe(
      "sandbox",
    );
  });

  it("requires a long session secret and, in production, a working email sender", () => {
    expect(() => parseEnv({ ...base, BETTER_AUTH_SECRET: "short" })).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => parseEnv({ ...base, NODE_ENV: "production", MESSAGING_MODE: "sandbox" })).toThrow(
      /SENDGRID_API_KEY[\s\S]*EMAIL_FROM/,
    );
  });

  it("requires sending credentials in live mode", () => {
    expect(() => parseEnv({ ...base, MESSAGING_MODE: "live" })).toThrow(
      /TWILIO_ACCOUNT_SID[\s\S]*SENDGRID_API_KEY/,
    );
  });

  it("needs a text model with the OpenAI key, and lets live mode run on the sandbox AI", () => {
    expect(() => parseEnv({ ...base, MESSAGING_MODE: "live" })).not.toThrow(/OPENAI/);
    expect(() => parseEnv({ ...base, OPENAI_API_KEY: "k" })).toThrow(/OPENAI_TEXT_MODEL/);
    const env = parseEnv({ ...base, OPENAI_API_KEY: "k", OPENAI_TEXT_MODEL: "text-model" });
    expect(env.OPENAI_TEXT_MODEL).toBe("text-model");
  });

  it("treats anything but an explicit live as sandbox for labels", () => {
    expect(getMessagingMode({})).toBe("sandbox");
    expect(getMessagingMode({ MESSAGING_MODE: "LIVE" })).toBe("sandbox");
    expect(getMessagingMode({ MESSAGING_MODE: "live" })).toBe("live");
  });

  it("names the missing variable without printing values", () => {
    try {
      parseEnv({ TWILIO_AUTH_TOKEN: "super-secret" });
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("REGISTRY_DATABASE_URL");
      expect(message).not.toContain("super-secret");
    }
  });
});

describe("logger", () => {
  it("writes Cloud Logging JSON and masks contact details", () => {
    const lines: string[] = [];
    const log = createLogger({ service: "test" }, "info", (l) => lines.push(l));
    log.info("message sent", { clientMobile: "555-010-0001", nested: { email: "a@b.c" }, count: 2 });
    log.debug("hidden");

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!);
    expect(entry).toMatchObject({
      severity: "INFO",
      message: "message sent",
      service: "test",
      clientMobile: "[redacted]",
      nested: { email: "[redacted]" },
      count: 2,
    });
  });
});
