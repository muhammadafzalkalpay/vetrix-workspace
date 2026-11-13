"use server";

// Send today's due reminders (Sandbox: saved, not sent) and stop one reminder.
import { revalidatePath } from "next/cache";
import { ForbiddenError, formatPhone, isQuietHours, localParts, ValidationError } from "@vetrix/domain";
import { aiPersonaName, messagingSettings, numberForLocation, runReminders, setMessageResult, stopReminder, withTransaction, type Actor, type RunSummary } from "@vetrix/db/runtime";
import { clinicToday } from "@/lib/clinic-date";
import { sendEmail } from "@/lib/email";
import { getEnv, getMessagingMode } from "@/lib/env";
import { logger } from "@/lib/logger";
import { requireShell } from "@/lib/session";
import { tenancy } from "@/lib/tenancy";
import { sendSms } from "@/lib/twilio";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function allowed() {
  const shell = await requireShell();
  if (!shell.permissions.has("reminders.manage")) throw new ForbiddenError();
  const actor: Actor = { type: "staff", id: shell.access.staffUserId };
  return { shell, actor };
}

export type RunResult = { ok: true; summary: RunSummary; sandbox: boolean } | { ok: false; error: string };

export async function runRemindersAction(asOfInput: string): Promise<RunResult> {
  try {
    const { shell, actor } = await allowed();
    const sandbox = getMessagingMode() === "sandbox";
    const today = clinicToday(shell.location.timezone);
    // Another date only in Sandbox (to check the test data's reference date).
    const asOf = sandbox && ISO.test(asOfInput) ? asOfInput : today;
    const loc = shell.location.id;
    const [settings, aiName, clinicRow] = await Promise.all([
      messagingSettings(shell.clinic, loc),
      aiPersonaName(shell.clinic, loc),
      shell.clinic.query<{ main_phone: string | null }>(`SELECT main_phone FROM locations WHERE id = $1`, [loc]),
    ]);
    const quiet = isQuietHours(localParts(Date.now(), settings.timezone).minutes, settings.quietStart, settings.quietEnd);
    const phone = clinicRow.rows[0]?.main_phone;
    const { summary, outbound } = await withTransaction(shell.clinic, (tx) =>
      runReminders(tx, {
        locationId: loc,
        asOf,
        sandbox,
        quietHours: quiet,
        actor,
        values: { clinicName: settings.clinicName, aiName, clinicPhone: phone ? safeFormat(phone) : "the clinic", bookingLink: "reply to this text" },
      }),
    );

    if (!sandbox && outbound.length) {
      // Live: send after the run is saved, and record each result.
      const env = getEnv();
      const from = await numberForLocation(tenancy().registry, { organizationId: shell.organization.organization_id, locationId: loc });
      const contacts = new Map(
        (await shell.clinic.query<{ id: string; mobile: string; email: string | null }>(`SELECT id, mobile, email FROM clients WHERE id = ANY($1::uuid[])`, [[...new Set(outbound.map((o) => o.clientId))]])).rows.map((c) => [c.id, c]),
      );
      for (const o of outbound) {
        const c = contacts.get(o.clientId);
        let ok = false;
        let id: string | null = null;
        let error: string | null = null;
        try {
          if (o.channel === "sms" && from && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && c) {
            const r = await sendSms({ accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN }, { from, to: c.mobile, body: o.body });
            ok = r.ok;
            id = r.sid;
          } else if (o.channel === "email" && env.SENDGRID_API_KEY && env.EMAIL_FROM && c?.email) {
            const r = await sendEmail({ apiKey: env.SENDGRID_API_KEY, from: env.EMAIL_FROM, fromName: settings.clinicName }, { to: c.email, subject: `A reminder from ${settings.clinicName}`, text: o.body });
            ok = r.ok;
            id = r.id;
          } else {
            error = o.channel === "ai_call" ? "Reminder calls need the voice service." : "Sending is not set up for this channel.";
          }
        } catch (e) {
          logger.error("reminder send failed", { error: e, channel: o.channel });
          error = "Could not send.";
        }
        await setMessageResult(shell.clinic, { locationId: loc, messageId: o.messageId, ok, providerMessageId: id, error });
      }
    }
    revalidatePath("/reminders");
    revalidatePath("/messages");
    return { ok: true, summary, sandbox };
  } catch (error) {
    logger.error("reminder run failed", { error });
    return { ok: false, error: error instanceof ValidationError ? error.userMessage : "The run did not finish. Nothing was sent twice; please try again." };
  }
}

function safeFormat(phone: string) {
  try {
    return formatPhone(phone.startsWith("+") ? phone : `+1${phone.replace(/\D/g, "")}`);
  } catch {
    return phone;
  }
}

export async function stopReminderAction(input: { ruleId: string; patientId: string; dueAt: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const { shell, actor } = await allowed();
    if (!UUID.test(input.patientId) || !ISO.test(input.dueAt) || !/^[a-z_]+$/.test(input.ruleId)) throw new ValidationError("Choose a reminder.");
    await withTransaction(shell.clinic, (tx) => stopReminder(tx, { locationId: shell.location.id, ...input, actor }));
    revalidatePath("/reminders");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof ValidationError ? error.userMessage : "Could not stop the reminder." };
  }
}
