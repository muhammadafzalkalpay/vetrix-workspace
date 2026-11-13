// Reminders against a clinic database: load what the engine needs, preview
// who is due, send the due touches (recorded in reminders, reminder_touches
// and messages), and stop a reminder.
import {
  dueReminders,
  NotFoundError,
  planSends,
  ValidationError,
  type DueReminder,
  type RetentionInput,
  type RetentionRule,
  type SendPlan,
} from "@vetrix/domain";
import { randomUUID } from "node:crypto";
import { getVeterinaryPack } from "@vetrix/pack";
import { writeAudit, type Actor } from "./clients";
import type { SqlClient } from "./sql-client";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

interface PackRetention {
  rules: RetentionRule[];
  templates: Record<string, string>;
  household_merge: { applies_to_rules: string[]; template_multi: string };
  engine: { household_merge_window_days: number };
}

const pack = () => getVeterinaryPack().retention as unknown as PackRetention;

/** Rules the engine runs here (enabled for the location; heartworm, dental, series and win-back are not run yet). */
const ENGINE_RULES = new Set(["annual_wellness", "senior_recheck", "vaccine_due", "parasite_prevention_refill", "post_surgery_recheck", "no_show_recovery"]);

export async function loadRetentionInput(db: SqlClient, locationId: string, asOf: string): Promise<RetentionInput & { stopped: Set<string> }> {
  if (!ISO.test(asOf)) throw new ValidationError("Choose a date.");
  const [enabled, patients, clients, vaccines, prevention, noShows, booked, stopped] = await Promise.all([
    db.query<{ pack_rule_id: string }>(`SELECT pack_rule_id FROM reminder_rules WHERE location_id = $1 AND enabled`, [locationId]),
    db.query<RetentionInput["patients"][number]>(
      `SELECT p.id, p.client_id AS "clientId", p.name, p.species, to_char(p.date_of_birth, 'YYYY-MM-DD') AS "dateOfBirth",
              p.approx_age_months AS "approxAgeMonths", p.status,
              to_char(greatest(p.last_wellness_exam_at, (SELECT max(a.start_at)::date FROM appointments a JOIN services s ON s.id = a.service_id
                 WHERE a.patient_id = p.id AND a.status = 'completed' AND s.pack_service_id IN ('wellness_exam', 'wellness_exam_new', 'senior_wellness'))), 'YYYY-MM-DD') AS "lastWellnessAt",
              to_char(greatest(p.last_surgery_at, (SELECT max(a.start_at)::date FROM appointments a JOIN services s ON s.id = a.service_id
                 WHERE a.patient_id = p.id AND a.status = 'completed' AND s.category = 'surgery')), 'YYYY-MM-DD') AS "lastSurgeryAt"
       FROM patients p WHERE p.location_id = $1`,
      [locationId],
    ),
    db.query<RetentionInput["clients"][number]>(
      `SELECT c.id, c.first_name AS "firstName", c.household_id AS "householdId", c.sms_consent AS "smsConsent", c.email,
              coalesce((SELECT array_agg(f.flag) FROM client_flags f WHERE f.client_id = c.id), '{}') AS flags
       FROM clients c WHERE c.location_id = $1`,
      [locationId],
    ),
    db.query<RetentionInput["vaccines"][number]>(
      `SELECT v.patient_id AS "patientId", split_part(t.name, ' (', 1) AS "vaccineName", to_char(v.due_at, 'YYYY-MM-DD') AS "dueAt"
       FROM vaccine_records v JOIN vaccine_types t ON t.id = v.vaccine_id JOIN patients p ON p.id = v.patient_id
       WHERE p.location_id = $1
         AND v.due_at = (SELECT max(v2.due_at) FROM vaccine_records v2 WHERE v2.patient_id = v.patient_id AND v2.vaccine_id = v.vaccine_id)`,
      [locationId],
    ),
    db.query<RetentionInput["prevention"][number]>(
      `SELECT pp.patient_id AS "patientId", pp.product_name AS "productName", to_char(pp.supply_end_at, 'YYYY-MM-DD') AS "supplyEndAt"
       FROM prevention_products pp JOIN patients p ON p.id = pp.patient_id WHERE p.location_id = $1`,
      [locationId],
    ),
    db.query<RetentionInput["noShows"][number]>(
      `SELECT a.patient_id AS "patientId", to_char((a.start_at AT TIME ZONE l.timezone)::date, 'YYYY-MM-DD') AS date
       FROM appointments a JOIN locations l ON l.id = a.location_id WHERE a.location_id = $1 AND a.status = 'no_show'`,
      [locationId],
    ),
    db.query<RetentionInput["booked"][number]>(
      `SELECT a.patient_id AS "patientId", s.pack_service_id AS "packServiceId", to_char((a.start_at AT TIME ZONE l.timezone)::date, 'YYYY-MM-DD') AS date
       FROM appointments a JOIN services s ON s.id = a.service_id JOIN locations l ON l.id = a.location_id
       WHERE a.location_id = $1 AND a.status IN ('requested', 'confirmed') AND (a.start_at AT TIME ZONE l.timezone)::date >= $2::date`,
      [locationId, asOf],
    ),
    db.query<{ k: string }>(
      `SELECT rr.pack_rule_id || '|' || r.patient_id || '|' || to_char(r.due_at, 'YYYY-MM-DD') AS k
       FROM reminders r JOIN reminder_rules rr ON rr.id = r.rule_id WHERE rr.location_id = $1 AND r.status IN ('stopped', 'booked', 'completed')`,
      [locationId],
    ),
  ]);
  const on = new Set(enabled.rows.map((r) => r.pack_rule_id));
  return {
    asOf,
    rules: pack().rules.filter((r) => on.has(r.id) && ENGINE_RULES.has(r.id)),
    patients: patients.rows,
    clients: clients.rows,
    vaccines: vaccines.rows,
    prevention: prevention.rows,
    noShows: noShows.rows,
    booked: booked.rows,
    stopped: new Set(stopped.rows.map((r) => r.k)),
  };
}

const sentKey = (ruleId: string, patientId: string, dueAt: string, touchIndex: number) => `${ruleId}|${patientId}|${dueAt}|${touchIndex}`;

async function sentTouches(db: SqlClient, locationId: string): Promise<Set<string>> {
  const { rows } = await db.query<{ rule: string; patient_id: string; due: string; n: number }>(
    `SELECT rr.pack_rule_id AS rule, r.patient_id, to_char(r.due_at, 'YYYY-MM-DD') AS due, t.touch_number AS n
     FROM reminder_touches t JOIN reminders r ON r.id = t.reminder_id JOIN reminder_rules rr ON rr.id = r.rule_id
     WHERE rr.location_id = $1 AND t.status IN ('sent', 'suppressed')`,
    [locationId],
  );
  return new Set(rows.map((r) => sentKey(r.rule, r.patient_id, r.due, r.n - 1)));
}

export interface ReminderRow extends DueReminder {
  petName: string;
  species: string;
  clientName: string;
  clientId: string;
  /** The touch that would go out on a run (null when sent already or nothing is due today). */
  nextTouch: { index: number; channels: string[]; template: string; offsetDays: number } | null;
  lastSent: boolean;
}

/** Everyone the engine has a reminder for on `asOf`, with what would go out. */
export async function previewReminders(db: SqlClient, locationId: string, asOf: string): Promise<{ rows: ReminderRow[]; input: RetentionInput }> {
  const [input, sent] = await Promise.all([loadRetentionInput(db, locationId, asOf), sentTouches(db, locationId)]);
  const items = dueReminders(input);
  for (const it of items) if (!it.suppressed && input.stopped.has(`${it.ruleId}|${it.patientId}|${it.dueAt}`)) it.suppressed = "Stopped";
  const pets = new Map(input.patients.map((p) => [p.id, p]));
  const clientNames = new Map(
    (await db.query<{ id: string; name: string }>(`SELECT id, first_name || ' ' || last_name AS name FROM clients WHERE location_id = $1`, [locationId])).rows.map((r) => [r.id, r.name]),
  );
  const rows = items.map((it) => {
    const pending = it.active.filter((t) => !sent.has(sentKey(it.ruleId, it.patientId, it.dueAt, t.index))).sort((a, b) => b.index - a.index);
    const pet = pets.get(it.patientId)!;
    return {
      ...it,
      petName: pet.name,
      species: pet.species,
      clientName: clientNames.get(it.clientId) ?? "",
      nextTouch: it.suppressed ? null : (pending[0] ?? null),
      lastSent: it.active.some((t) => sent.has(sentKey(it.ruleId, it.patientId, it.dueAt, t.index))),
    };
  });
  rows.sort((a, b) => a.dueIn - b.dueIn);
  return { rows, input };
}

export interface RunSummary {
  messages: number;
  texts: number;
  emails: number;
  calls: number;
  households: number;
  heldForQuietHours: number;
  skipped: { pet: string; reason: string }[];
}

/**
 * Sends today's due touches. Sandbox: messages are saved as "simulated".
 * Live: they are saved as "queued" and returned for the caller to send.
 * In quiet hours, texts and calls wait for the next run.
 */
export async function runReminders(
  db: SqlClient,
  input: { locationId: string; asOf: string; sandbox: boolean; quietHours: boolean; values: { clinicName: string; aiName: string; clinicPhone: string; bookingLink: string }; actor: Actor },
): Promise<{ summary: RunSummary; outbound: { messageId: string; clientId: string; channel: SendPlan["channel"]; body: string }[] }> {
  const { rows, input: data } = await previewReminders(db, input.locationId, input.asOf);
  const sent = await sentTouches(db, input.locationId);
  const p = pack();
  const plan = planSends({
    items: rows,
    patients: data.patients,
    clients: data.clients,
    sent,
    templates: p.templates,
    merge: { ...p.household_merge, windowDays: p.engine.household_merge_window_days },
    values: input.values,
  });
  const ruleIds = new Map(
    (await db.query<{ id: string; pack_rule_id: string }>(`SELECT id, pack_rule_id FROM reminder_rules WHERE location_id = $1`, [input.locationId])).rows.map((r) => [r.pack_rule_id, r.id]),
  );
  const summary: RunSummary = { messages: 0, texts: 0, emails: 0, calls: 0, households: 0, heldForQuietHours: 0, skipped: [] };
  const outbound: { messageId: string; clientId: string; channel: SendPlan["channel"]; body: string }[] = [];
  const petName = new Map(data.patients.map((x) => [x.id, x.name]));
  for (const s of plan.skipped) summary.skipped.push({ pet: petName.get(s.touch.patientId) ?? "", reason: s.reason });

  // Everything is written in a few batched statements (one round trip each).
  type T = { ruleId: string; patientId: string; dueAt: string; touchIndex: number };
  const toSend = plan.plans.filter((m) => {
    if (input.quietHours && m.channel !== "email") {
      summary.heldForQuietHours += 1;
      return false;
    }
    return true;
  });
  const messages = toSend.map((m) => ({ ...m, id: randomUUID() }));
  const touches: { t: T; messageId: string | null; status: "sent" | "suppressed"; reason: string | null }[] = [
    ...plan.superseded.map((t) => ({ t, messageId: null, status: "suppressed" as const, reason: "superseded by a later reminder" })),
    ...messages.flatMap((m) => m.touches.map((t) => ({ t, messageId: m.id, status: "sent" as const, reason: null }))),
  ];
  const ruleOf = (t: T) => {
    const id = ruleIds.get(t.ruleId);
    if (!id) throw new NotFoundError("Reminder rule", t.ruleId);
    return id;
  };
  const reminders = new Map<string, string>();
  if (touches.length) {
    const unique = [...new Map(touches.map((x) => [`${x.t.ruleId}|${x.t.patientId}|${x.t.dueAt}`, x.t])).values()];
    const { rows: r } = await db.query<{ id: string; k: string }>(
      `INSERT INTO reminders (rule_id, patient_id, due_at)
       SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::date[])
       ON CONFLICT (rule_id, patient_id, due_at) DO UPDATE SET due_at = EXCLUDED.due_at
       RETURNING id, rule_id || '|' || patient_id || '|' || to_char(due_at, 'YYYY-MM-DD') AS k`,
      [unique.map(ruleOf), unique.map((t) => t.patientId), unique.map((t) => t.dueAt)],
    );
    for (const row of r) reminders.set(row.k, row.id);
  }
  if (messages.length) {
    await db.query(
      `INSERT INTO messages (id, location_id, client_id, channel, template_key, body, status, sent_at)
       SELECT u.id, $1, u.client_id, u.channel, u.template_key, u.body, $2, $3
       FROM unnest($4::uuid[], $5::uuid[], $6::text[], $7::text[], $8::text[]) AS u(id, client_id, channel, template_key, body)`,
      [input.locationId, input.sandbox ? "simulated" : "queued", input.sandbox ? new Date() : null,
       messages.map((m) => m.id), messages.map((m) => m.clientId), messages.map((m) => m.channel), messages.map((m) => m.templateKey), messages.map((m) => m.body)],
    );
  }
  if (touches.length) {
    const rid = (t: T) => reminders.get(`${ruleOf(t)}|${t.patientId}|${t.dueAt}`)!;
    await db.query(
      `INSERT INTO reminder_touches (reminder_id, message_id, touch_number, scheduled_for, status, suppression_reason)
       SELECT u.r, u.m, u.n, now(), u.s, u.why FROM unnest($1::uuid[], $2::uuid[], $3::int[], $4::text[], $5::text[]) AS u(r, m, n, s, why)
       ON CONFLICT (reminder_id, touch_number) DO NOTHING`,
      [touches.map((x) => rid(x.t)), touches.map((x) => x.messageId), touches.map((x) => x.t.touchIndex + 1), touches.map((x) => x.status), touches.map((x) => x.reason)],
    );
    const sentIds = touches.filter((x) => x.status === "sent").map((x) => rid(x.t));
    if (sentIds.length) {
      await db.query(
        `UPDATE reminders r SET touches_sent = r.touches_sent + c.n FROM (SELECT id, count(*)::int n FROM unnest($1::uuid[]) id GROUP BY id) c WHERE r.id = c.id`,
        [sentIds],
      );
    }
  }
  for (const m of messages) {
    summary.messages += 1;
    if (m.channel === "sms") summary.texts += 1;
    else if (m.channel === "email") summary.emails += 1;
    else summary.calls += 1;
    if (m.templateKey === "household_reminder") summary.households += 1;
    if (!input.sandbox) outbound.push({ messageId: m.id, clientId: m.clientId, channel: m.channel, body: m.body });
  }
  await writeAudit(db, {
    locationId: input.locationId,
    actor: input.actor,
    action: "reminders.run",
    entityType: "location",
    entityId: input.locationId,
    changes: { asOf: input.asOf, messages: summary.messages, sandbox: input.sandbox },
  });
  return { summary, outbound };
}

/** Stops one reminder for one pet (no more touches for that due date). */
export async function stopReminder(
  db: SqlClient,
  input: { locationId: string; ruleId: string; patientId: string; dueAt: string; actor: Actor },
): Promise<void> {
  if (!ISO.test(input.dueAt)) throw new ValidationError("Choose a reminder.");
  const rule = await db.query<{ id: string }>(`SELECT id FROM reminder_rules WHERE location_id = $1 AND pack_rule_id = $2`, [input.locationId, input.ruleId]);
  const pet = await db.query(`SELECT 1 FROM patients WHERE id = $1 AND location_id = $2`, [input.patientId, input.locationId]);
  if (!rule.rows[0] || !pet.rows[0]) throw new NotFoundError("Reminder", input.ruleId);
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO reminders (rule_id, patient_id, due_at, status, stopped_at, stop_reason) VALUES ($1, $2, $3, 'stopped', now(), 'staff')
     ON CONFLICT (rule_id, patient_id, due_at) DO UPDATE SET status = 'stopped', stopped_at = now(), stop_reason = 'staff' RETURNING id`,
    [rule.rows[0].id, input.patientId, input.dueAt],
  );
  await writeAudit(db, { locationId: input.locationId, actor: input.actor, action: "reminder.stopped", entityType: "reminder", entityId: rows[0]!.id, changes: { rule: input.ruleId } });
}
