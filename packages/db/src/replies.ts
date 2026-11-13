// Replies to texts Vetrix sent (reminders, confirmations, fasting checks).
// Keywords act directly; anything else is handed back to the AI front desk.
import { classifyReply, fillScript, type ReplyIntent, type ReplyRules } from "@vetrix/domain";
import { getVeterinaryPack } from "@vetrix/pack";
import { writeAudit, type Actor } from "./clients";
import type { SqlClient } from "./sql-client";

const AI: Actor = { type: "ai", id: null };

interface LastOutbound {
  id: string;
  template_key: string;
  patient_id: string | null;
  appointment_id: string | null;
  pet_name: string | null;
}

export type ReplyOutcome =
  | { handled: true; intent: ReplyIntent; reply: string | null; notes: string[] }
  /** Not a keyword: continue as a conversation with the AI front desk, with this text. */
  | { handled: false; intent: ReplyIntent; text: string };

export interface ReplyValues {
  clinicName: string;
  clinicPhone: string;
  timezone: string;
}

const retention = () =>
  getVeterinaryPack().retention as unknown as { inbound_reply_handling: ReplyRules; templates: Record<string, string> };

async function lastOutbound(db: SqlClient, locationId: string, clientId: string): Promise<LastOutbound | null> {
  const { rows } = await db.query<LastOutbound>(
    `SELECT m.id, m.template_key, m.patient_id, m.appointment_id, p.name AS pet_name
     FROM messages m LEFT JOIN patients p ON p.id = m.patient_id
     WHERE m.location_id = $1 AND m.client_id = $2 AND m.created_at > now() - interval '14 days'
     ORDER BY m.created_at DESC LIMIT 1`,
    [locationId, clientId],
  );
  return rows[0] ?? null;
}

const when = (d: Date, tz: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz }).format(d);

/**
 * Handles one reply from a known client. Saves it against the message it
 * answers, acts on keywords, and says what to text back (null: nothing).
 */
export async function handleClientReply(
  db: SqlClient,
  input: { locationId: string; clientId: string; text: string; values: ReplyValues },
): Promise<ReplyOutcome> {
  const last = await lastOutbound(db, input.locationId, input.clientId);
  const intent = classifyReply(input.text, last?.template_key ?? null, retention().inbound_reply_handling);
  if (last) await db.query(`INSERT INTO message_replies (message_id, body, intent) VALUES ($1, $2, $3)`, [last.id, input.text.slice(0, 1000), intent]);
  const pet = last?.pet_name ?? "your pet";
  const task = (type: string, title: string, details: string, priority: "normal" | "urgent" = "normal") =>
    db.query(
      `INSERT INTO staff_tasks (location_id, client_id, patient_id, type, priority, title, details) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [input.locationId, input.clientId, last?.patient_id ?? null, type, priority, title.slice(0, 200), details.slice(0, 2000)],
    );

  switch (intent) {
    case "confirm": {
      // The visit the text was about, or the client's next open visit.
      const { rows } = await db.query<{ id: string; start_at: Date; name: string; status: string }>(
        `SELECT a.id, a.start_at, p.name, a.status FROM appointments a JOIN patients p ON p.id = a.patient_id
         WHERE a.location_id = $1 AND a.client_id = $2 AND a.status IN ('requested', 'confirmed') AND a.start_at > now()
         ORDER BY (a.id = $3) DESC, a.start_at LIMIT 1`,
        [input.locationId, input.clientId, last?.appointment_id ?? null],
      );
      const appt = rows[0];
      if (!appt) return { handled: true, intent, reply: "Thanks! We don't see an upcoming visit to confirm. Reply here if you'd like to book one.", notes: [] };
      if (appt.status === "requested") {
        await db.query(`UPDATE appointments SET status = 'confirmed', confirmed_at = now() WHERE id = $1`, [appt.id]);
        await db.query(`INSERT INTO appointment_status_history (appointment_id, from_status, to_status, actor_type) VALUES ($1, 'requested', 'confirmed', 'client')`, [appt.id]);
        await writeAudit(db, { locationId: input.locationId, actor: { type: "client", id: input.clientId }, action: "appointment.confirmed", entityType: "appointment", entityId: appt.id, changes: { by: "text reply" } });
      }
      return { handled: true, intent, reply: `Thanks! ${appt.name}'s visit on ${when(appt.start_at, input.values.timezone)} is confirmed.`, notes: [`Visit confirmed by text: ${appt.name}`] };
    }
    case "reschedule":
      return { handled: false, intent, text: "I need to move my appointment" };
    case "refill": {
      await task("refill_request", `Refill request: ${pet}`, `Replied REFILL to "${last?.template_key ?? "a text"}".`);
      return { handled: true, intent, reply: `Thanks! We'll get ${pet}'s refill ready and text you when it's ready to pick up.`, notes: [`Refill task created for ${pet}`] };
    }
    case "fasting_confirmed": {
      if (last?.appointment_id) {
        await db.query(`UPDATE appointments SET fasting_confirmed = true WHERE id = $1 AND location_id = $2`, [last.appointment_id, input.locationId]);
        await db.query(
          `UPDATE appointment_confirmations SET response = 'YES', responded_at = now() WHERE appointment_id = $1 AND touch = 'fasting_evening'`,
          [last.appointment_id],
        );
      }
      return { handled: true, intent, reply: `Thank you. No food for ${pet} after midnight, water is fine. See you at drop-off tomorrow.`, notes: [`Fasting confirmed for ${pet}`] };
    }
    case "help":
      return { handled: true, intent, reply: fillScript(retention().templates.help_reply ?? "", { clinic_name: input.values.clinicName, clinic_phone: input.values.clinicPhone }), notes: [] };
    case "moved": {
      // retention.json moved_action: mark the pet transferred and stop its reminders.
      if (last?.patient_id) {
        await db.query(`UPDATE patients SET status = 'transferred' WHERE id = $1 AND location_id = $2 AND status = 'active'`, [last.patient_id, input.locationId]);
        await db.query(`UPDATE reminders SET status = 'stopped', stopped_at = now(), stop_reason = 'transferred' WHERE patient_id = $1 AND status = 'open'`, [last.patient_id]);
        await writeAudit(db, { locationId: input.locationId, actor: AI, action: "patient.transferred", entityType: "patient", entityId: last.patient_id, changes: { by: "text reply" } });
      }
      await task("records_release", `Moved to another clinic: ${pet}`, `Client replied: "${input.text}". Reminders stopped. Send records if asked.`);
      return { handled: true, intent, reply: `Thanks for letting us know. We've stopped reminders for ${pet}. If the new clinic needs records, just ask.`, notes: [`${pet} marked as moved to another clinic`] };
    }
    case "post_op_concern": {
      await task("post_op_concern", `Post-op concern: ${pet}`, `Client replied to the check-in: "${input.text}"`, "urgent");
      return { handled: true, intent, reply: "Thanks for telling us. A member of the team will call you shortly. If it gets worse, call us or go to the nearest emergency hospital.", notes: [`Urgent task: post-op concern for ${pet}`] };
    }
    case "deceased":
    case "conversation":
      return { handled: false, intent, text: input.text };
  }
}
