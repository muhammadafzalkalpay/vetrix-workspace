import { describe, expect, it } from "vitest";
import { isQuietHours, validateOutbound } from "./messaging";

const client = { smsConsent: true, email: "sam@example.com", flags: [] as const };

describe("validateOutbound", () => {
  it("accepts a text and an email with a subject", () => {
    expect(validateOutbound({ channel: "sms", body: "  See you soon  " }, client)).toEqual({ channel: "sms", subject: null, body: "See you soon" });
    expect(validateOutbound({ channel: "email", subject: "Max's results", body: "All good." }, client).subject).toBe("Max's results");
  });

  it("refuses texts after STOP, email without an address, and do-not-contact", () => {
    expect(() => validateOutbound({ channel: "sms", body: "Hi" }, { ...client, smsConsent: false })).toThrow(/opted out of texts/);
    expect(() => validateOutbound({ channel: "email", subject: "Hi", body: "Hi" }, { ...client, email: null })).toThrow(/no email address/);
    expect(() => validateOutbound({ channel: "email", subject: "Hi", body: "Hi" }, { ...client, flags: ["do_not_contact"] })).toThrow(/do not contact/);
  });

  it("checks empty bodies, subjects and length", () => {
    expect(() => validateOutbound({ channel: "sms", body: "  " }, client)).toThrow(/Write a message/);
    expect(() => validateOutbound({ channel: "email", body: "Hi" }, client)).toThrow(/Add a subject/);
    expect(() => validateOutbound({ channel: "sms", body: "x".repeat(641) }, client)).toThrow(/under 640/);
  });
});

describe("isQuietHours", () => {
  it("handles a window that crosses midnight", () => {
    expect(isQuietHours(21 * 60, "20:00", "08:00")).toBe(true);
    expect(isQuietHours(7 * 60 + 59, "20:00", "08:00")).toBe(true);
    expect(isQuietHours(8 * 60, "20:00", "08:00")).toBe(false);
    expect(isQuietHours(13 * 60, "12:00", "14:00")).toBe(true);
  });
});
