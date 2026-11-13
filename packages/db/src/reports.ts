// Numbers for the Reports page over a date range (clinic dates, inclusive).
import type { SqlClient } from "./sql-client";

export interface Report {
  calls: { total: number; voice: number; sms: number; afterHours: number; emergency: number; urgent: number; transferred: number; erReferred: number; booked: number; sandbox: number };
  callsByDay: { day: string; total: number; booked: number }[];
  visits: { total: number; byAi: number; byStaff: number; byOnline: number; completed: number; noShow: number; cancelled: number; lateCancel: number; urgent: number };
  topServices: { name: string; visits: number }[];
  messages: { sms: number; email: number; failed: number; sandbox: number };
  reminders: { touchesSent: number; open: number; booked: number };
  tasks: { created: number; done: number; openUrgent: number };
  newClients: { total: number; byAi: number };
}

export async function loadReport(db: SqlClient, locationId: string, from: string, to: string): Promise<Report> {
  // [from, to] in clinic time: compare on local dates.
  const tz = (await db.query<{ timezone: string }>(`SELECT timezone FROM locations WHERE id = $1`, [locationId])).rows[0]?.timezone ?? "UTC";
  const p = [locationId, from, to, tz];
  const inRange = (col: string) => `(${col} AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date`;
  const [calls, byDay, visits, services, messages, reminders, tasks, clients] = await Promise.all([
    db.query(
      `SELECT count(*)::int total, count(*) FILTER (WHERE channel = 'voice')::int voice, count(*) FILTER (WHERE channel = 'sms')::int sms,
              count(*) FILTER (WHERE after_hours)::int after_hours, count(*) FILTER (WHERE triage_level = 'emergency')::int emergency,
              count(*) FILTER (WHERE triage_level = 'urgent')::int urgent, count(*) FILTER (WHERE transfer_outcome = 'transferred')::int transferred,
              count(*) FILTER (WHERE transfer_outcome IN ('er_referred', 'failed'))::int er_referred,
              count(*) FILTER (WHERE appointment_id IS NOT NULL)::int booked, count(*) FILTER (WHERE sandbox)::int sandbox
       FROM calls WHERE location_id = $1 AND ${inRange("started_at")}`,
      p,
    ),
    db.query<{ day: string; total: number; booked: number }>(
      `SELECT to_char(d, 'YYYY-MM-DD') AS day, count(k.id)::int total, count(k.appointment_id)::int booked
       FROM generate_series($2::date, $3::date, interval '1 day') d
       LEFT JOIN calls k ON k.location_id = $1 AND (k.started_at AT TIME ZONE $4)::date = d::date
       GROUP BY d ORDER BY d`,
      p,
    ),
    db.query(
      `SELECT count(*)::int total, count(*) FILTER (WHERE booked_by = 'ai')::int by_ai, count(*) FILTER (WHERE booked_by = 'staff')::int by_staff,
              count(*) FILTER (WHERE booked_by IN ('web', 'client'))::int by_online, count(*) FILTER (WHERE status = 'completed')::int completed,
              count(*) FILTER (WHERE status = 'no_show')::int no_show, count(*) FILTER (WHERE status = 'cancelled')::int cancelled,
              count(*) FILTER (WHERE late_cancel)::int late_cancel, count(*) FILTER (WHERE triage_level <> 'routine')::int urgent
       FROM appointments WHERE location_id = $1 AND ${inRange("start_at")}`,
      p,
    ),
    db.query<{ name: string; visits: number }>(
      `SELECT s.name, count(*)::int visits FROM appointments a JOIN services s ON s.id = a.service_id
       WHERE a.location_id = $1 AND a.status <> 'cancelled' AND ${inRange("a.start_at")}
       GROUP BY s.name ORDER BY visits DESC, s.name LIMIT 6`,
      p,
    ),
    db.query(
      `SELECT count(*) FILTER (WHERE channel = 'sms')::int sms, count(*) FILTER (WHERE channel = 'email')::int email,
              count(*) FILTER (WHERE status = 'failed')::int failed, count(*) FILTER (WHERE status = 'simulated')::int sandbox
       FROM messages WHERE location_id = $1 AND ${inRange("created_at")}`,
      p,
    ),
    db.query(
      `SELECT (SELECT count(*)::int FROM reminder_touches t JOIN reminders r ON r.id = t.reminder_id JOIN reminder_rules rr ON rr.id = r.rule_id
               WHERE rr.location_id = $1 AND t.status = 'sent' AND ${inRange("t.scheduled_for")}) AS touches_sent,
              (SELECT count(*)::int FROM reminders r JOIN reminder_rules rr ON rr.id = r.rule_id WHERE rr.location_id = $1 AND r.status = 'open') AS open,
              (SELECT count(*)::int FROM appointments a WHERE a.location_id = $1 AND a.reminder_id IS NOT NULL AND ${inRange("a.start_at")}) AS booked`,
      p,
    ),
    db.query(
      `SELECT count(*) FILTER (WHERE ${inRange("created_at")})::int created, count(*) FILTER (WHERE status = 'done' AND ${inRange("completed_at")})::int done,
              count(*) FILTER (WHERE status <> 'done' AND priority = 'urgent')::int open_urgent
       FROM staff_tasks WHERE location_id = $1`,
      p,
    ),
    db.query(
      `SELECT count(*)::int total, count(*) FILTER (WHERE source = 'phone_ai')::int by_ai FROM clients WHERE location_id = $1 AND ${inRange("created_at")}`,
      p,
    ),
  ]);
  const c = calls.rows[0] as Record<string, number>;
  const v = visits.rows[0] as Record<string, number>;
  const m = messages.rows[0] as Record<string, number>;
  const r = reminders.rows[0] as Record<string, number>;
  const t = tasks.rows[0] as Record<string, number>;
  const n = clients.rows[0] as Record<string, number>;
  return {
    calls: { total: c.total!, voice: c.voice!, sms: c.sms!, afterHours: c.after_hours!, emergency: c.emergency!, urgent: c.urgent!, transferred: c.transferred!, erReferred: c.er_referred!, booked: c.booked!, sandbox: c.sandbox! },
    callsByDay: byDay.rows,
    visits: { total: v.total!, byAi: v.by_ai!, byStaff: v.by_staff!, byOnline: v.by_online!, completed: v.completed!, noShow: v.no_show!, cancelled: v.cancelled!, lateCancel: v.late_cancel!, urgent: v.urgent! },
    topServices: services.rows,
    messages: { sms: m.sms!, email: m.email!, failed: m.failed!, sandbox: m.sandbox! },
    reminders: { touchesSent: r.touches_sent!, open: r.open!, booked: r.booked! },
    tasks: { created: t.created!, done: t.done!, openUrgent: t.open_urgent! },
    newClients: { total: n.total!, byAi: n.by_ai! },
  };
}
