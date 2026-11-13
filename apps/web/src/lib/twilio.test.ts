import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { gather, isValidTwilioSignature, readTwilioWebhook, sendSms, twilioSignature, xmlEscape } from "./twilio";

const url = "https://app.example.com/api/twilio/sms";
const params = { To: "+15550001000", From: "+15550002000", Body: "Hi & <bye>" };

describe("Twilio signatures", () => {
  it("signs the URL plus sorted name+value pairs with HMAC-SHA1", () => {
    const manual = createHmac("sha1", "token").update(`${url}BodyHi & <bye>From+15550002000To+15550001000`).digest("base64");
    expect(twilioSignature("token", url, params)).toBe(manual);
  });

  it("rejects a wrong or missing signature", () => {
    const good = twilioSignature("token", url, params);
    expect(isValidTwilioSignature("token", url, params, good)).toBe(true);
    expect(isValidTwilioSignature("token", url, { ...params, Body: "changed" }, good)).toBe(false);
    expect(isValidTwilioSignature("other", url, params, good)).toBe(false);
    expect(isValidTwilioSignature("token", url, params, null)).toBe(false);
  });

  const request = (signature?: string) =>
    new Request("http://internal:8080/api/twilio/sms", {
      method: "POST",
      headers: signature ? { "x-twilio-signature": signature } : {},
      body: new URLSearchParams(params),
    });

  it("checks webhooks against the public APP_URL", async () => {
    const env = { NODE_ENV: "production" as const, APP_URL: "https://app.example.com", TWILIO_AUTH_TOKEN: "token" };
    expect(await readTwilioWebhook(request(twilioSignature("token", url, params)), env)).toMatchObject({ ok: true, params });
    expect(await readTwilioWebhook(request("bad"), env)).toMatchObject({ ok: false, status: 403 });
  });

  it("accepts unsigned webhooks only outside production when no token is set", async () => {
    expect(await readTwilioWebhook(request(), { NODE_ENV: "development", APP_URL: "http://localhost:3000", TWILIO_AUTH_TOKEN: undefined })).toMatchObject({ ok: true });
    expect(await readTwilioWebhook(request(), { NODE_ENV: "production", APP_URL: "https://x", TWILIO_AUTH_TOKEN: undefined })).toMatchObject({ ok: false, status: 503 });
  });
});

describe("TwiML", () => {
  it("escapes text and builds a speech gather", () => {
    expect(xmlEscape(`Tom & "Jerry" <3`)).toBe("Tom &amp; &quot;Jerry&quot; &lt;3");
    expect(gather("/api/twilio/voice/turn?silence=1")).toContain('action="/api/twilio/voice/turn?silence=1"');
  });
});

describe("sendSms", () => {
  it("posts to the Messages API with basic auth", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fake = (async (u: string, init: RequestInit) => {
      seen = { url: u, init };
      return new Response(JSON.stringify({ sid: "SM1" }), { status: 201 });
    }) as unknown as typeof fetch;
    const r = await sendSms({ accountSid: "AC1", authToken: "t" }, { from: "+1555", to: "+1666", body: "Hi" }, fake);
    expect(r).toEqual({ ok: true, sid: "SM1", status: 201 });
    expect(seen!.url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json");
    expect((seen!.init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from("AC1:t").toString("base64")}`);
    expect(String(seen!.init.body)).toBe("From=%2B1555&To=%2B1666&Body=Hi");
  });
});
