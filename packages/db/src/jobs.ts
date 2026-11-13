// Scheduled work for one location, called every minute by the scheduler
// (Cloud Scheduler in production). Each job runs at most once a day per
// location: job_runs is claimed first, so a repeated or late tick is harmless.
//
// - reminders: the daily retention run, at the later of 06:00 (pack) and the
//   end of quiet hours, so texts are not held back for a whole day;
// - fasting_check: 19:00, a text to clients with a fasting procedure tomorrow;
// - fasting_no_reply: 20:00, a staff task to verify fasting at drop-off.
import { fillScript, isQuietHours, localParts } from "@vetrix/domain";
import { getVeterinaryPack } from "@vetrix/pack";
import type { Actor } from "./clients";
import { runReminders, type RunSummary } from "./retention";
import type { SqlClient } from "./sql-client";
import { waitlistFollowUps } from "./waitlist";

const SYSTEM: Actor = { type: "system", id: null };
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export interface JobValues {
  clinicName: string;
  aiName: string;
  clinicPhone: string;
  bookingLink: string;
}

export interface JobResult {
  ran: string[];
  reminders?: RunSummary;
  fastingChecks?: number;
  fastingTasks?: number;
  waitlist?: { expired: number; calls: number };
  /** Live mode: messages saved as queued, to be sent by the caller. */
  outbound: { messageId: string; clientId: string; channel: "sms" | "email" | "ai_call"; body: string }[];
}

async function claim(db: SqlClient, locationId: string, job: string, date: string): Promise<boolean> {
  const { rows } = await db.query(`INSERT INTO job_runs (location_id, job, run_date) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING 1`, [locationId, job, date]);
  return rows.length > 0;
}

export async function runDueJobs(db: SqlClient, input: { locationId: string; now: number; sandbox: boolean; values: JobValues }): Promise<JobResult> {
  const { rows } = await db.query<{ timezone: string; quiet_start: string | null; quiet_end: string | null }>(
    `SELECT l.timezone, to_char(ms.quiet_start, 'HH24:MI') AS quiet_start, to_char(ms.quiet_end, 'HH24:MI') AS quiet_end
     FROM locations l LEFT JOIN location_messaging_settings ms ON ms.location_id = l.id WHERE l.id = $1`,
    [input.locationId],
  );
  const loc = rows[0];
  const result: JobResult = { ran: [], outbound: [] };
  if (!loc) return result;
  const here = localParts(input.now, loc.timezone);
  const pack = getVeterinaryPack().retention as unknown as {
    engine: { run_daily_at_local: string };
    templates: Record<string, string>;
    pre_visit: { fasting_check: { send_at_local: string; reply_by_local: string; template: string } };
  };
  const quietStart = loc.quiet_start ?? "20:00";
  const quietEnd = loc.quiet_end ?? "08:00";

  // 1. Daily reminders.
  const remindersAt = Math.max(toMin(pack.engine.run_daily_at_local), toMin(quietEnd));
  if (here.minutes >= remindersAt && !isQuietHours(here.minutes, quietStart, quietEnd) && (await claim(db, input.locationId, "reminders", here.date))) {
    const r = await runReminders(db, { locationId: input.locationId, asOf: here.date, sandbox: input.sandbox, quietHours: false, values: input.values, actor: SYSTEM });
    result.ran.push("reminders");
    result.reminders = r.summary;
    result.outbound.push(...r.outbound);
  }

  // 2. Fasting check, the evening before a fasting procedure.
  const fasting = pack.pre_visit.fasting_check;
  if (here.minutes >= toMin(fasting.send_at_local) && here.minutes < toMin(fasting.reply_by_local) && (await claim(db, input.locationId, "fasting_check", here.date))) {
    const tomorrow = localParts(input.now + 86_400_000, loc.timezone).date;
    const { rows: appts } = await db.query<{ id: string; client_id: string; patient_id: string; pet: string; sms_consent: boolean }>(
      `SELECT a.id, a.client_id, a.patient_id, p.name AS pet, c.sms_consent
       FROM appointments a JOIN services s ON s.id = a.service_id JOIN patients p ON p.id = a.patient_id JOIN clients c ON c.id = a.client_id
       WHERE a.location_id = $1 AND s.fasting_required AND a.status IN ('requested', 'confirmed') AND NOT a.fasting_confirmed
         AND (a.start_at AT TIME ZONE $3)::date = $2::date
         AND NOT EXISTS (SELECT 1 FROM appointment_confirmations ac WHERE ac.appointment_id = a.id AND ac.touch = 'fasting_evening')
         AND NOT EXISTS (SELECT 1 FROM client_flags f WHERE f.client_id = c.id AND f.flag = 'do_not_contact')`,
      [input.locationId, tomorrow, loc.timezone],
    );
    let sent = 0;
    for (const a of appts) {
      if (!a.sms_consent) {
        await db.query(
          `INSERT INTO staff_tasks (location_id, client_id, patient_id, type, title, details) VALUES ($1, $2, $3, 'fasting_call', $4, $5)`,
          [input.locationId, a.client_id, a.patient_id, `Call about fasting: ${a.pet}`, `${a.pet} has a procedure tomorrow. The client has no text consent: call to give the fasting instructions.`],
        );
        await db.query(`INSERT INTO appointment_confirmations (appointment_id, touch) VALUES ($1, 'fasting_evening') ON CONFLICT DO NOTHING`, [a.id]);
        continue;
      }
      const body = fillScript(pack.templates[fasting.template] ?? "", { clinic_name: input.values.clinicName, pet_name: a.pet });
      const { rows: m } = await db.query<{ id: string }>(
        `INSERT INTO messages (location_id, client_id, patient_id, appointment_id, channel, template_key, body, status, sent_at)
         VALUES ($1, $2, $3, $4, 'sms', $5, $6, $7, $8) RETURNING id`,
        [input.locationId, a.client_id, a.patient_id, a.id, fasting.template, body, input.sandbox ? "simulated" : "queued", input.sandbox ? new Date() : null],
      );
      await db.query(`INSERT INTO appointment_confirmations (appointment_id, touch, message_id) VALUES ($1, 'fasting_evening', $2) ON CONFLICT DO NOTHING`, [a.id, m[0]!.id]);
      if (!input.sandbox) result.outbound.push({ messageId: m[0]!.id, clientId: a.client_id, channel: "sms", body });
      sent += 1;
    }
    result.ran.push("fasting_check");
    result.fastingChecks = sent;
  }

  // 3. No reply by the deadline: staff verify fasting at drop-off (pack no_reply_action).
  if (here.minutes >= toMin(fasting.reply_by_local) && (await claim(db, input.locationId, "fasting_no_reply", here.date))) {
    const tomorrow = localParts(input.now + 86_400_000, loc.timezone).date;
    const { rows: open } = await db.query<{ id: string; client_id: string; patient_id: string; pet: string }>(
      `SELECT a.id, a.client_id, a.patient_id, p.name AS pet
       FROM appointment_confirmations ac JOIN appointments a ON a.id = ac.appointment_id JOIN patients p ON p.id = a.patient_id
       WHERE a.location_id = $1 AND ac.touch = 'fasting_evening' AND ac.response IS NULL AND NOT a.fasting_confirmed
         AND a.status IN ('requested', 'confirmed') AND (a.start_at AT TIME ZONE $3)::date = $2::date`,
      [input.locationId, tomorrow, loc.timezone],
    );
    for (const a of open) {
      await db.query(
        `INSERT INTO staff_tasks (location_id, client_id, patient_id, type, title, details) VALUES ($1, $2, $3, 'fasting_unverified', $4, $5)`,
        [input.locationId, a.client_id, a.patient_id, `Verify fasting at drop-off: ${a.pet}`, `No reply to last night's fasting check. Confirm ${a.pet} had no food after midnight before the procedure.`],
      );
    }
    result.ran.push("fasting_no_reply");
    result.fastingTasks = open.length;
  }

  // 4. Every tick: waitlist offers unclaimed for 30 minutes, then AI calls to the next two.
  const wl = await waitlistFollowUps(db, { locationId: input.locationId, now: input.now, sandbox: input.sandbox, values: { clinicName: input.values.clinicName, aiName: input.values.aiName, timezone: loc.timezone, claimBase: "" } });
  if (wl.expired || wl.calls) {
    result.ran.push("waitlist_follow_up");
    result.waitlist = wl;
  }
  return result;
}
