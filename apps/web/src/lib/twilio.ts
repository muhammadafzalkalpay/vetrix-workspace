// Twilio: checking that webhooks really come from Twilio, answering them with
// TwiML (Twilio's XML instructions), and sending texts through the REST API.
// No Twilio SDK: these few calls are plain HTTP.
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Env } from "./env";

/**
 * Twilio signs each webhook: HMAC-SHA1 (auth token) over the full URL plus
 * every POST field, sorted by name, as name+value. See Twilio's "Webhooks
 * security" docs.
 */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", authToken).update(Buffer.from(data, "utf8")).digest("base64");
}

export function isValidTwilioSignature(authToken: string, url: string, params: Record<string, string>, signature: string | null): boolean {
  if (!signature) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export type WebhookCheck = { ok: true; params: Record<string, string> } | { ok: false; status: number; reason: string };

/**
 * Reads a Twilio webhook's form fields and checks its signature. Without an
 * auth token, unsigned requests are accepted only outside production, so
 * the webhooks can be exercised locally in sandbox mode.
 */
export async function readTwilioWebhook(request: Request, env: Pick<Env, "NODE_ENV" | "APP_URL" | "TWILIO_AUTH_TOKEN">): Promise<WebhookCheck> {
  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) if (typeof value === "string") params[key] = value;
  if (!env.TWILIO_AUTH_TOKEN) {
    if (env.NODE_ENV === "production") return { ok: false, status: 503, reason: "Twilio is not configured" };
    return { ok: true, params };
  }
  // Twilio signs the public URL it called, so rebuild it from APP_URL (the
  // request URL can differ behind Cloud Run's proxy).
  const incoming = new URL(request.url);
  const url = new URL(incoming.pathname + incoming.search, env.APP_URL).toString();
  if (!isValidTwilioSignature(env.TWILIO_AUTH_TOKEN, url, params, request.headers.get("x-twilio-signature"))) {
    return { ok: false, status: 403, reason: "Invalid Twilio signature" };
  }
  return { ok: true, params };
}

// ---------- TwiML ----------

export function xmlEscape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** A calm, natural voice for Riley (Amazon Polly neural voice via Twilio). */
export const VOICE = "Polly.Joanna-Neural";

export function twiml(body: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    headers: { "content-type": "text/xml; charset=utf-8", "cache-control": "no-store" },
  });
}

export const say = (text: string) => `<Say voice="${VOICE}">${xmlEscape(text)}</Say>`;
export const message = (text: string) => `<Message>${xmlEscape(text)}</Message>`;

/** Listen for the caller's next words; Twilio posts the transcript to `action`. */
export function gather(action: string, prompt = ""): string {
  return `<Gather input="speech" action="${xmlEscape(action)}" method="POST" speechTimeout="auto" language="en-US" actionOnEmptyResult="true">${prompt}</Gather>`;
}

export function dial(number: string, action: string, timeoutSec = 20): string {
  return `<Dial action="${xmlEscape(action)}" method="POST" timeout="${timeoutSec}">${xmlEscape(number)}</Dial>`;
}

// ---------- REST ----------

export interface SmsResult {
  ok: boolean;
  sid: string | null;
  status: number;
}

/** Sends one text through Twilio's REST API. */
export async function sendSms(
  config: { accountSid: string; authToken: string },
  input: { from: string; to: string; body: string },
  fetchImpl: typeof fetch = fetch,
): Promise<SmsResult> {
  const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ From: input.from, To: input.to, Body: input.body }),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => ({}))) as { sid?: string };
  return { ok: res.ok, sid: json.sid ?? null, status: res.status };
}
