// Messages staff send to clients by text or email. Pure rules, shared by the
// web app and (later) the reminder dispatcher.
// - STOP blocks all texts; do_not_contact blocks everything (canContact).
// - No texts in quiet hours (pack retention.json engine.quiet_hours_local, per location).
import { canContact, type ClientFlag } from "./clients";
import { RuleViolationError, ValidationError } from "./errors";

export type MessageChannel = "sms" | "email";

/** Four SMS segments: longer texts get split and cost more. */
export const SMS_MAX = 640;
export const EMAIL_MAX = 5000;
export const SUBJECT_MAX = 150;

export interface ValidOutbound {
  channel: MessageChannel;
  subject: string | null;
  body: string;
}

export function validateOutbound(
  input: { channel: string; subject?: string | null; body: string },
  client: { smsConsent: boolean; email: string | null; flags: readonly ClientFlag[] },
): ValidOutbound {
  if (input.channel !== "sms" && input.channel !== "email") throw new ValidationError("Choose text or email.", { field: "channel" });
  const channel: MessageChannel = input.channel;
  const body = input.body.trim();
  if (!body) throw new ValidationError("Write a message.", { field: "body" });
  const max = channel === "sms" ? SMS_MAX : EMAIL_MAX;
  if (body.length > max) throw new ValidationError(`Keep ${channel === "sms" ? "texts" : "emails"} under ${max} characters.`, { field: "body" });
  let subject: string | null = null;
  if (channel === "email") {
    subject = input.subject?.trim() || null;
    if (!subject) throw new ValidationError("Add a subject.", { field: "subject" });
    if (subject.length > SUBJECT_MAX) throw new ValidationError(`Keep the subject under ${SUBJECT_MAX} characters.`, { field: "subject" });
  }
  if (!canContact(client, channel)) {
    if (client.flags.includes("do_not_contact")) throw new RuleViolationError("contact.blocked", "This client is marked do not contact.");
    throw channel === "sms"
      ? new RuleViolationError("contact.sms_opt_out", "This client has opted out of texts (STOP). Send an email or call instead.")
      : new RuleViolationError("contact.no_email", "There is no email address on file for this client.");
  }
  return { channel, subject, body };
}

/** True inside quiet hours. The window may cross midnight ("20:00" to "08:00"). */
export function isQuietHours(minutes: number, start: string, end: string): boolean {
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const s = toMin(start);
  const e = toMin(end);
  if (s === e) return false;
  return s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
}

/** Plain words for the kinds of message in the log. */
export const MESSAGE_KIND_LABEL: Record<string, string> = {
  staff_message: "From staff",
  appointment_confirmation: "Booking confirmation",
  after_hours_er: "Emergency details",
  fasting_check_evening: "Fasting check",
  deceased_reply: "Condolence",
  help_reply: "Help reply",
};
