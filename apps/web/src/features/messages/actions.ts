"use server";

// Staff send a text or email to a client. The message is saved first (and is
// final in Sandbox); in live mode it is then sent through Twilio or SendGrid
// and its status updated.
import { revalidatePath } from "next/cache";
import { ForbiddenError, isQuietHours, localParts, RuleViolationError, validateOutbound, ValidationError } from "@vetrix/domain";
import { getClientThread, messagingSettings, numberForLocation, recordOutbound, setMessageResult, withTransaction, type Actor } from "@vetrix/db/runtime";
import { formValues, toActionError, type ActionResult } from "@/lib/action-result";
import { sendEmail } from "@/lib/email";
import { getEnv, getMessagingMode } from "@/lib/env";
import { logger } from "@/lib/logger";
import { requireShell } from "@/lib/session";
import { tenancy } from "@/lib/tenancy";
import { processIncomingText } from "@/features/front-desk/incoming-text";
import { sendSms } from "@/lib/twilio";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function sendMessageAction(clientId: string, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  const values = formValues(form);
  try {
    const shell = await requireShell();
    if (!shell.permissions.has("messages.send")) throw new ForbiddenError();
    if (!UUID.test(clientId)) throw new ValidationError("Choose a client.");
    const loc = shell.location.id;
    const [{ client }, settings] = await Promise.all([getClientThread(shell.clinic, loc, clientId), messagingSettings(shell.clinic, loc)]);
    const msg = validateOutbound(
      { channel: String(form.get("channel") ?? "sms"), subject: String(form.get("subject") ?? ""), body: String(form.get("body") ?? "") },
      { smsConsent: client.sms_consent, email: client.email, flags: client.flags },
    );
    if (msg.channel === "sms" && isQuietHours(localParts(Date.now(), settings.timezone).minutes, settings.quietStart, settings.quietEnd)) {
      throw new RuleViolationError("quiet_hours", `Texts aren't sent in quiet hours (${settings.quietStart} to ${settings.quietEnd} clinic time). Send an email, or try again later.`);
    }
    const sandbox = getMessagingMode() === "sandbox";
    const actor: Actor = { type: "staff", id: shell.access.staffUserId };
    const messageId = await withTransaction(shell.clinic, (tx) =>
      recordOutbound(tx, { locationId: loc, clientId, channel: msg.channel, subject: msg.subject, body: msg.body, sandbox, staffUserId: shell.access.staffUserId, actor }),
    );

    if (!sandbox) {
      // Live: send now, after the record is saved, and store the outcome.
      const env = getEnv();
      let ok = false;
      let providerId: string | null = null;
      let error: string | null = null;
      try {
        if (msg.channel === "sms") {
          const from = await numberForLocation(tenancy().registry, { organizationId: shell.organization.organization_id, locationId: loc });
          if (!from || !env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) error = "No texting number is set up for this location.";
          else {
            const r = await sendSms({ accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN }, { from, to: client.mobile, body: msg.body });
            ok = r.ok;
            providerId = r.sid;
            if (!r.ok) error = `Twilio refused the text (${r.status}).`;
          }
        } else if (!env.SENDGRID_API_KEY || !env.EMAIL_FROM) {
          error = "Email is not set up (SendGrid).";
        } else {
          const r = await sendEmail({ apiKey: env.SENDGRID_API_KEY, from: env.EMAIL_FROM, fromName: settings.clinicName }, { to: client.email!, subject: msg.subject!, text: msg.body });
          ok = r.ok;
          providerId = r.id;
          if (!r.ok) error = `SendGrid refused the email (${r.status}).`;
        }
      } catch (e) {
        logger.error("message send failed", { error: e, channel: msg.channel });
        error = "The message could not be sent. Please try again.";
      }
      await setMessageResult(shell.clinic, { locationId: loc, messageId, ok, providerMessageId: providerId, error });
      revalidatePath(`/messages/${clientId}`);
      revalidatePath("/messages");
      if (!ok) return { ok: false, error: error ?? "Not sent.", values };
      return { ok: true, message: msg.channel === "sms" ? "Text sent." : "Email sent." };
    }
    revalidatePath(`/messages/${clientId}`);
    revalidatePath("/messages");
    return { ok: true, message: msg.channel === "sms" ? "Text saved (Sandbox: not sent)." : "Email saved (Sandbox: not sent)." };
  } catch (error) {
    const r = toActionError(error);
    return r.ok ? r : { ...r, values };
  }
}

export type SimulatedReply = { ok: true; texts: string[]; notes: string[]; callId: string | null } | { ok: false; error: string };

/** Sandbox only: type what the client would text back, as if it came from their phone. */
export async function simulateReplyAction(clientId: string, text: string): Promise<SimulatedReply> {
  try {
    const shell = await requireShell();
    if (!shell.permissions.has("messages.send")) throw new ForbiddenError();
    if (getMessagingMode() !== "sandbox") throw new RuleViolationError("sandbox_only", "Replies can only be simulated in Sandbox mode.");
    if (!UUID.test(clientId)) throw new ValidationError("Choose a client.");
    if (!text.trim()) throw new ValidationError("Type the reply.");
    const { client } = await getClientThread(shell.clinic, shell.location.id, clientId);
    const r = await processIncomingText({ clinic: shell.clinic, organizationId: shell.organization.organization_id, locationId: shell.location.id, mobile: client.mobile, body: text, sandbox: true });
    revalidatePath(`/messages/${clientId}`);
    return { ok: true, texts: r.texts, notes: r.notes, callId: r.callId };
  } catch (error) {
    const r = toActionError(error);
    return { ok: false, error: r.ok ? "Something went wrong." : r.error };
  }
}
