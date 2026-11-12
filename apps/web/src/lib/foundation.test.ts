import { describe, expect, it } from "vitest";
import { getMessagingMode, parseEnv } from "./env";
import { createLogger } from "./logger";

const base = { REGISTRY_DATABASE_URL: "postgres://u:p@host/db" };

describe("environment config", () => {
  it("defaults to sandbox outside production", () => {
    expect(parseEnv(base).MESSAGING_MODE).toBe("sandbox");
  });

  it("requires an explicit messaging mode in production", () => {
    expect(() => parseEnv({ ...base, NODE_ENV: "production" })).toThrow(/MESSAGING_MODE/);
    expect(parseEnv({ ...base, NODE_ENV: "production", MESSAGING_MODE: "sandbox" }).MESSAGING_MODE).toBe("sandbox");
  });

  it("requires sending credentials in live mode", () => {
    expect(() => parseEnv({ ...base, MESSAGING_MODE: "live" })).toThrow(
      /TWILIO_ACCOUNT_SID[\s\S]*SENDGRID_API_KEY/,
    );
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
