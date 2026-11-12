import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";
import { createLogger } from "./logger";

const base = { REGISTRY_DATABASE_URL: "postgres://u:p@host/db" };

describe("environment config", () => {
  it("defaults to demo mode", () => {
    expect(parseEnv(base).VETRIX_DEMO_MODE).toBe(true);
  });

  it("requires sending credentials when demo mode is off", () => {
    expect(() => parseEnv({ ...base, VETRIX_DEMO_MODE: "false" })).toThrow(
      /TWILIO_ACCOUNT_SID[\s\S]*SENDGRID_API_KEY/,
    );
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
