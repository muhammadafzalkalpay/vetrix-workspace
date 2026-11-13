// Sends messages that were saved as "queued" (live mode only) and records
// each result. Used by reminder runs and scheduled jobs.
import "server-only";
import { numberForLocation, setMessageResult } from "@vetrix/db/runtime";
import { sendEmail } from "./email";
import { getEnv } from "./env";
import { logger } from "./logger";
import type { ClinicPool } from "./staff-context";
import { tenancy } from "./tenancy";
import { sendSms } from "./twilio";

export interface Queued {
  messageId: string;
  clientId: string;
  channel: "sms" | "email" | "ai_call";
  body: string;
}

export async function deliverQueued(input: { clinic: ClinicPool; organizationId: string; locationId: string; clinicName: string; messages: Queued[] }): Promise<{ sent: number; failed: number }> {
  const { clinic, locationId, messages } = input;
  if (messages.length === 0) return { sent: 0, failed: 0 };
  const env = getEnv();
  const from = await numberForLocation(tenancy().registry, { organizationId: input.organizationId, locationId });
  const contacts = new Map(
    (await clinic.query<{ id: string; mobile: string; email: string | null }>(`SELECT id, mobile, email FROM clients WHERE id = ANY($1::uuid[])`, [[...new Set(messages.map((m) => m.clientId))]])).rows.map((c) => [c.id, c]),
  );
  let sent = 0;
  let failed = 0;
  for (const m of messages) {
    const c = contacts.get(m.clientId);
    let ok = false;
    let id: string | null = null;
    let error: string | null = null;
    try {
      if (m.channel === "sms" && from && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && c) {
        const r = await sendSms({ accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN }, { from, to: c.mobile, body: m.body });
        ok = r.ok;
        id = r.sid;
        if (!r.ok) error = `Twilio refused the text (${r.status}).`;
      } else if (m.channel === "email" && env.SENDGRID_API_KEY && env.EMAIL_FROM && c?.email) {
        const r = await sendEmail({ apiKey: env.SENDGRID_API_KEY, from: env.EMAIL_FROM, fromName: input.clinicName }, { to: c.email, subject: `A reminder from ${input.clinicName}`, text: m.body });
        ok = r.ok;
        id = r.id;
        if (!r.ok) error = `SendGrid refused the email (${r.status}).`;
      } else {
        error = m.channel === "ai_call" ? "Reminder calls need the voice service." : "Sending is not set up for this channel.";
      }
    } catch (e) {
      logger.error("queued message send failed", { error: e, channel: m.channel });
      error = "Could not send.";
    }
    await setMessageResult(clinic, { locationId, messageId: m.messageId, ok, providerMessageId: id, error });
    if (ok) sent += 1;
    else failed += 1;
  }
  return { sent, failed };
}
