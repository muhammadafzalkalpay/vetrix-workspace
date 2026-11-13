// Twilio webhooks for the AI front desk: incoming texts and phone calls.
// Each request is checked (signature), routed to its clinic and location by
// the number that was called or texted, and answered with TwiML.
//
// Sandbox mode (MESSAGING_MODE=sandbox): conversations are recorded and
// labelled Sandbox, but no text is sent: incoming texts get an empty reply.
// A ringing phone call cannot be simulated, so calls are still answered by
// voice, but any texts during the call are only recorded.
import "server-only";
import { normalizePhone } from "@vetrix/domain";
import {
  continueFrontDesk,
  endFrontDesk,
  findCallByProviderId,
  markMessageSent,
  routePhoneNumber,
  startFrontDesk,
  transferFailedFrontDesk,
  type OutboundText,
  type TurnOutput,
} from "@vetrix/db/runtime";
import { triageClassifier } from "@/lib/ai";
import { claimBase } from "@/lib/claim";
import { processIncomingText } from "./incoming-text";
import { getEnv, getMessagingMode } from "@/lib/env";
import { logger } from "@/lib/logger";
import { tenancy } from "@/lib/tenancy";
import { dial, gather, message, readTwilioWebhook, say, sendSms, twiml } from "@/lib/twilio";

const MAX_TEXT = 1000;

type Clinic = Awaited<ReturnType<ReturnType<typeof tenancy>["clinicPool"]>>["pool"];

interface Context {
  params: Record<string, string>;
  clinic: Clinic;
  organizationId: string;
  locationId: string;
  clinicNumber: string;
  sandbox: boolean;
}

/** Checks the request and finds the clinic for the number Twilio says was called or texted. */
async function resolve(request: Request): Promise<{ ok: true; ctx: Context } | { ok: false; response: Response }> {
  const env = getEnv();
  const check = await readTwilioWebhook(request, env);
  if (!check.ok) {
    logger.warn("twilio webhook rejected", { reason: check.reason });
    return { ok: false, response: new Response(check.reason, { status: check.status }) };
  }
  const t = tenancy();
  const route = await routePhoneNumber(t.registry, check.params.To ?? "");
  if (!route) {
    logger.warn("twilio webhook for an unassigned number");
    return { ok: false, response: twiml(say("Sorry, this number is not in service.") + "<Hangup/>") };
  }
  const { pool } = await t.clinicPool(route.organizationId);
  return {
    ok: true,
    ctx: { params: check.params, clinic: pool, organizationId: route.organizationId, locationId: route.locationId, clinicNumber: route.e164, sandbox: getMessagingMode() === "sandbox" },
  };
}

/** Sends texts the conversation produced (live mode) and records the result. */
async function deliver(ctx: Context, outbound: OutboundText[]) {
  const env = getEnv();
  if (ctx.sandbox || outbound.length === 0) return;
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    logger.error("live texts queued but Twilio is not configured", { count: outbound.length });
    return;
  }
  for (const o of outbound) {
    const r = await sendSms({ accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN }, { from: ctx.clinicNumber, to: o.to, body: o.body }).catch(
      () => ({ ok: false, sid: null, status: 0 }),
    );
    if (!r.ok) logger.error("text send failed", { status: r.status });
    if (o.messageId) await markMessageSent(ctx.clinic, { locationId: ctx.locationId, messageId: o.messageId, providerMessageId: r.sid, ok: r.ok });
  }
}

// ---------- Texts ----------

export async function handleIncomingText(request: Request): Promise<Response> {
  const resolved = await resolve(request);
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  let mobile: string;
  try {
    mobile = normalizePhone(ctx.params.From ?? "");
  } catch {
    return twiml("");
  }
  const body = (ctx.params.Body ?? "").trim().slice(0, MAX_TEXT);
  if (!body) return twiml("");

  const r = await processIncomingText({ clinic: ctx.clinic, organizationId: ctx.organizationId, locationId: ctx.locationId, mobile, body, sandbox: ctx.sandbox });
  // Sandbox: everything is recorded; nothing is texted back.
  if (ctx.sandbox) return twiml("");
  for (const o of r.sentWithReply) {
    if (o.messageId) await markMessageSent(ctx.clinic, { locationId: ctx.locationId, messageId: o.messageId, providerMessageId: null, ok: true });
  }
  await deliver(ctx, r.others);
  return twiml(r.texts.map(message).join(""));
}

// ---------- Calls ----------

const TURN = "/api/twilio/voice/turn";
const DIAL = "/api/twilio/voice/dial";

/** What to do after Riley speaks: transfer, hang up, or listen again. */
function nextStep(r: TurnOutput): string {
  const spoken = r.replies.map(say).join("");
  if (r.transferTo) return spoken + dial(r.transferTo, DIAL);
  if (r.ended) return spoken + "<Hangup/>";
  return gather(TURN, spoken) + say("Sorry, I didn't catch that.") + `<Redirect method="POST">${TURN}?silence=1</Redirect>`;
}

export async function handleIncomingCall(request: Request): Promise<Response> {
  const resolved = await resolve(request);
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  const sid = ctx.params.CallSid ?? null;
  let caller: string | null = null;
  try {
    caller = normalizePhone(ctx.params.From ?? "");
  } catch {
    caller = null; // withheld or international number: treated as a new caller
  }
  const existing = sid ? await findCallByProviderId(ctx.clinic, ctx.locationId, sid) : null;
  if (existing) return twiml(gather(TURN));
  const r = await startFrontDesk(ctx.clinic, { locationId: ctx.locationId, channel: "voice", callerNumber: caller, sandbox: ctx.sandbox, providerCallId: sid });
  return twiml(nextStep(r));
}

export async function handleCallTurn(request: Request): Promise<Response> {
  const resolved = await resolve(request);
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  const callId = ctx.params.CallSid ? await findCallByProviderId(ctx.clinic, ctx.locationId, ctx.params.CallSid) : null;
  if (!callId) return twiml(say("Sorry, something went wrong. Please call again.") + "<Hangup/>");
  const speech = (ctx.params.SpeechResult ?? "").trim();
  if (!speech) {
    // Twilio retries via <Redirect>: after two silences, say goodbye.
    const silence = Number(new URL(request.url).searchParams.get("silence") ?? "0");
    if (silence >= 2) {
      await endFrontDesk(ctx.clinic, { locationId: ctx.locationId, callId });
      return twiml(say("I'm sorry, I can't hear you. Please call us back. Goodbye.") + "<Hangup/>");
    }
    return twiml(gather(`${TURN}?silence=${silence + 1}`, say("Are you still there?")) + `<Redirect method="POST">${TURN}?silence=${silence + 1}</Redirect>`);
  }
  const r = await continueFrontDesk(ctx.clinic, { locationId: ctx.locationId, callId, text: speech.slice(0, MAX_TEXT) }, Date.now(), { classify: triageClassifier(), claimBase: claimBase(ctx.organizationId) });
  await deliver(ctx, r.outbound);
  return twiml(nextStep(r));
}

/** After a warm transfer: done if staff answered, otherwise the ER fallback (pack W6). */
export async function handleDialResult(request: Request): Promise<Response> {
  const resolved = await resolve(request);
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  const callId = ctx.params.CallSid ? await findCallByProviderId(ctx.clinic, ctx.locationId, ctx.params.CallSid) : null;
  if (!callId) return twiml("<Hangup/>");
  if (ctx.params.DialCallStatus === "completed" || ctx.params.DialCallStatus === "answered") {
    await endFrontDesk(ctx.clinic, { locationId: ctx.locationId, callId });
    return twiml("<Hangup/>");
  }
  const r = await transferFailedFrontDesk(ctx.clinic, { locationId: ctx.locationId, callId }, Date.now(), { classify: triageClassifier() });
  await deliver(ctx, r.outbound);
  return twiml(r.replies.map(say).join("") + "<Hangup/>");
}

/** Twilio's call status callback: close the conversation when the caller hangs up. */
export async function handleCallStatus(request: Request): Promise<Response> {
  const resolved = await resolve(request);
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  const done = ["completed", "busy", "failed", "no-answer", "canceled"].includes(ctx.params.CallStatus ?? "");
  if (done && ctx.params.CallSid) {
    const callId = await findCallByProviderId(ctx.clinic, ctx.locationId, ctx.params.CallSid);
    if (callId) await endFrontDesk(ctx.clinic, { locationId: ctx.locationId, callId });
  }
  return new Response(null, { status: 204 });
}
