// Clinic settings for one location: read everything the Settings page shows,
// and save each section. Values arrive already validated by @vetrix/domain.
// Every save writes an audit entry with only the fields that changed.
import {
  NotFoundError,
  RuleViolationError,
  type ClinicDetails,
  type FrontDeskSettings,
  type MessagingSettingsInput,
  type PolicySettings,
  type WeekHours,
} from "@vetrix/domain";
import { getVeterinaryPack } from "@vetrix/pack";
import { diff, writeAudit, type Actor } from "./clients";
import { ENGINE_RULES } from "./retention";
import type { SqlClient } from "./sql-client";

export interface LocationSettings {
  details: ClinicDetails;
  hours: WeekHours["days"];
  holidays: { id: string; date: string; name: string | null }[];
  frontDesk: FrontDeskSettings;
  policies: PolicySettings;
  messaging: MessagingSettingsInput;
  reminderRules: { id: string; name: string; enabled: boolean; running: boolean }[];
  services: { id: string; name: string; category: string; durationMin: number; active: boolean }[];
}

export async function loadSettings(db: SqlClient, locationId: string): Promise<LocationSettings> {
  const [loc, hours, holidays, rules, services] = await Promise.all([
    db.query<{
      name: string; address: string | null; main_phone: string | null; website: string | null; timezone: string;
      ai_persona_name: string | null; emergency_transfer_number: string | null;
      behaviour: "er_only" | "er_and_book_next" | null; er_name: string | null; er_phone: string | null; er_address: string | null;
      cancellation_window_hours: number | null; cancellation_fee: string | null; surgery_deposit: string | null; refill_turnaround: string | null;
      new_client_policy: string | null; records_release_policy: string | null; recording_retention_months: number | null; telehealth_enabled: boolean | null;
      quiet_start: string | null; quiet_end: string | null;
    }>(
      `SELECT l.name, l.address, l.main_phone, l.website, l.timezone,
              ps.ai_persona_name, ps.emergency_transfer_number,
              ah.behaviour, ah.er_name, ah.er_phone, ah.er_address,
              lp.cancellation_window_hours, lp.cancellation_fee, lp.surgery_deposit, lp.refill_turnaround,
              lp.new_client_policy, lp.records_release_policy, lp.recording_retention_months, lp.telehealth_enabled,
              to_char(ms.quiet_start, 'HH24:MI') AS quiet_start, to_char(ms.quiet_end, 'HH24:MI') AS quiet_end
       FROM locations l
       LEFT JOIN location_phone_settings ps ON ps.location_id = l.id
       LEFT JOIN location_after_hours ah ON ah.location_id = l.id
       LEFT JOIN location_policies lp ON lp.location_id = l.id
       LEFT JOIN location_messaging_settings ms ON ms.location_id = l.id
       WHERE l.id = $1`,
      [locationId],
    ),
    db.query<{ weekday: number; opens: string; closes: string }>(
      `SELECT weekday, to_char(min(opens_at), 'HH24:MI') AS opens, to_char(max(closes_at), 'HH24:MI') AS closes
       FROM location_hours WHERE location_id = $1 GROUP BY weekday`,
      [locationId],
    ),
    db.query<{ id: string; date: string; name: string | null }>(
      `SELECT id, to_char(holiday_date, 'YYYY-MM-DD') AS date, name FROM location_holidays WHERE location_id = $1 ORDER BY holiday_date`,
      [locationId],
    ),
    db.query<{ pack_rule_id: string; enabled: boolean }>(`SELECT pack_rule_id, enabled FROM reminder_rules WHERE location_id = $1`, [locationId]),
    db.query<{ id: string; name: string; category: string; duration_min: number; active: boolean }>(
      `SELECT id, name, category, duration_min, active FROM services WHERE location_id = $1 ORDER BY category, name`,
      [locationId],
    ),
  ]);
  const l = loc.rows[0];
  if (!l) throw new NotFoundError("Location", locationId);
  const money = (v: string | null) => (v === null ? null : Number(v));
  const byDay = new Map(hours.rows.map((h) => [h.weekday, { opens: h.opens, closes: h.closes }]));
  const enabled = new Map(rules.rows.map((r) => [r.pack_rule_id, r.enabled]));
  const packRules = (getVeterinaryPack().retention as unknown as { rules: { id: string; name: string }[] }).rules;
  return {
    details: { name: l.name, address: l.address, mainPhone: l.main_phone, website: l.website, timezone: l.timezone },
    hours: [0, 1, 2, 3, 4, 5, 6].map((d) => byDay.get(d) ?? null),
    holidays: holidays.rows,
    frontDesk: {
      aiName: l.ai_persona_name ?? getVeterinaryPack().brand.ai_persona?.default_name ?? "Riley",
      emergencyTransferNumber: l.emergency_transfer_number,
      afterHoursBehaviour: l.behaviour ?? "er_and_book_next",
      erName: l.er_name,
      erPhone: l.er_phone,
      erAddress: l.er_address,
    },
    policies: {
      cancellationWindowHours: l.cancellation_window_hours ?? 24,
      cancellationFee: money(l.cancellation_fee),
      surgeryDeposit: money(l.surgery_deposit),
      refillTurnaround: l.refill_turnaround,
      newClientPolicy: l.new_client_policy,
      recordsReleasePolicy: l.records_release_policy,
      recordingRetentionMonths: l.recording_retention_months ?? 12,
      telehealthEnabled: l.telehealth_enabled ?? false,
    },
    messaging: { quietStart: l.quiet_start ?? "20:00", quietEnd: l.quiet_end ?? "08:00" },
    reminderRules: packRules
      .filter((r) => enabled.has(r.id))
      .map((r) => ({ id: r.id, name: r.name, enabled: enabled.get(r.id)!, running: ENGINE_RULES.has(r.id) })),
    services: services.rows.map((s) => ({ id: s.id, name: s.name, category: s.category, durationMin: s.duration_min, active: s.active })),
  };
}

type Ctx = { locationId: string; actor: Actor };

async function audit(db: SqlClient, ctx: Ctx, section: string, before: Record<string, unknown>, after: Record<string, unknown>): Promise<void> {
  const changes = diff(before, after);
  if (Object.keys(changes).length === 0) return;
  await writeAudit(db, { locationId: ctx.locationId, actor: ctx.actor, action: `settings.${section}`, entityType: "location", entityId: ctx.locationId, changes });
}

export async function saveClinicDetails(db: SqlClient, ctx: Ctx, v: ClinicDetails): Promise<void> {
  const before = await loadSettings(db, ctx.locationId);
  await db.query(`UPDATE locations SET name = $2, address = $3, main_phone = $4, website = $5, timezone = $6 WHERE id = $1`, [
    ctx.locationId, v.name, v.address, v.mainPhone, v.website, v.timezone,
  ]);
  await audit(db, ctx, "details", { ...before.details }, { ...v });
}

/** Replaces the weekly hours (one opening per day). */
export async function saveWeekHours(db: SqlClient, ctx: Ctx, v: WeekHours): Promise<void> {
  const before = await loadSettings(db, ctx.locationId);
  await db.query(`DELETE FROM location_hours WHERE location_id = $1`, [ctx.locationId]);
  for (const [weekday, d] of v.days.entries()) {
    if (d) await db.query(`INSERT INTO location_hours (location_id, weekday, opens_at, closes_at) VALUES ($1, $2, $3, $4)`, [ctx.locationId, weekday, d.opens, d.closes]);
  }
  await audit(db, ctx, "hours", { days: before.hours }, { days: v.days });
}

export async function addHoliday(db: SqlClient, ctx: Ctx, v: { date: string; name: string | null }): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO location_holidays (location_id, holiday_date, name) VALUES ($1, $2, $3) ON CONFLICT (location_id, holiday_date) DO NOTHING RETURNING id`,
    [ctx.locationId, v.date, v.name],
  );
  if (!rows[0]) throw new RuleViolationError("settings.holiday_exists", "That date is already a closed day.");
  await writeAudit(db, { locationId: ctx.locationId, actor: ctx.actor, action: "settings.holiday_added", entityType: "location", entityId: ctx.locationId, changes: v });
}

export async function removeHoliday(db: SqlClient, ctx: Ctx, holidayId: string): Promise<void> {
  const { rows } = await db.query<{ date: string; name: string | null }>(
    `DELETE FROM location_holidays WHERE id = $1 AND location_id = $2 RETURNING to_char(holiday_date, 'YYYY-MM-DD') AS date, name`,
    [holidayId, ctx.locationId],
  );
  if (!rows[0]) throw new NotFoundError("Closed day", holidayId);
  await writeAudit(db, { locationId: ctx.locationId, actor: ctx.actor, action: "settings.holiday_removed", entityType: "location", entityId: ctx.locationId, changes: rows[0] });
}

export async function saveFrontDesk(db: SqlClient, ctx: Ctx, v: FrontDeskSettings): Promise<void> {
  const before = await loadSettings(db, ctx.locationId);
  await db.query(
    `INSERT INTO location_phone_settings (location_id, ai_persona_name, emergency_transfer_number) VALUES ($1, $2, $3)
     ON CONFLICT (location_id) DO UPDATE SET ai_persona_name = EXCLUDED.ai_persona_name, emergency_transfer_number = EXCLUDED.emergency_transfer_number`,
    [ctx.locationId, v.aiName, v.emergencyTransferNumber],
  );
  await db.query(
    `INSERT INTO location_after_hours (location_id, er_name, er_phone, er_address, behaviour) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (location_id) DO UPDATE SET er_name = EXCLUDED.er_name, er_phone = EXCLUDED.er_phone, er_address = EXCLUDED.er_address, behaviour = EXCLUDED.behaviour`,
    [ctx.locationId, v.erName, v.erPhone, v.erAddress, v.afterHoursBehaviour],
  );
  await audit(db, ctx, "front_desk", { ...before.frontDesk }, { ...v });
}

export async function savePolicies(db: SqlClient, ctx: Ctx, v: PolicySettings): Promise<void> {
  const before = await loadSettings(db, ctx.locationId);
  await db.query(
    `INSERT INTO location_policies (location_id, cancellation_window_hours, cancellation_fee, surgery_deposit, refill_turnaround,
       new_client_policy, records_release_policy, recording_retention_months, telehealth_enabled)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (location_id) DO UPDATE SET cancellation_window_hours = EXCLUDED.cancellation_window_hours, cancellation_fee = EXCLUDED.cancellation_fee,
       surgery_deposit = EXCLUDED.surgery_deposit, refill_turnaround = EXCLUDED.refill_turnaround, new_client_policy = EXCLUDED.new_client_policy,
       records_release_policy = EXCLUDED.records_release_policy, recording_retention_months = EXCLUDED.recording_retention_months,
       telehealth_enabled = EXCLUDED.telehealth_enabled`,
    [ctx.locationId, v.cancellationWindowHours, v.cancellationFee, v.surgeryDeposit, v.refillTurnaround, v.newClientPolicy, v.recordsReleasePolicy, v.recordingRetentionMonths, v.telehealthEnabled],
  );
  await audit(db, ctx, "policies", { ...before.policies }, { ...v });
}

export async function saveMessaging(db: SqlClient, ctx: Ctx, v: MessagingSettingsInput): Promise<void> {
  const before = await loadSettings(db, ctx.locationId);
  await db.query(
    `INSERT INTO location_messaging_settings (location_id, quiet_start, quiet_end) VALUES ($1, $2, $3)
     ON CONFLICT (location_id) DO UPDATE SET quiet_start = EXCLUDED.quiet_start, quiet_end = EXCLUDED.quiet_end`,
    [ctx.locationId, v.quietStart, v.quietEnd],
  );
  await audit(db, ctx, "messaging", { ...before.messaging }, { ...v });
}

export async function setReminderRuleEnabled(db: SqlClient, ctx: Ctx, packRuleId: string, enabled: boolean): Promise<void> {
  const { rows } = await db.query(`UPDATE reminder_rules SET enabled = $3 WHERE location_id = $1 AND pack_rule_id = $2 RETURNING 1`, [ctx.locationId, packRuleId, enabled]);
  if (!rows[0]) throw new NotFoundError("Reminder", packRuleId);
  await writeAudit(db, { locationId: ctx.locationId, actor: ctx.actor, action: "settings.reminder_rule", entityType: "location", entityId: ctx.locationId, changes: { rule: packRuleId, enabled } });
}

export async function setServiceActive(db: SqlClient, ctx: Ctx, serviceId: string, active: boolean): Promise<void> {
  const { rows } = await db.query<{ name: string }>(`UPDATE services SET active = $3 WHERE id = $1 AND location_id = $2 RETURNING name`, [serviceId, ctx.locationId, active]);
  if (!rows[0]) throw new NotFoundError("Service", serviceId);
  await writeAudit(db, { locationId: ctx.locationId, actor: ctx.actor, action: active ? "service.activated" : "service.deactivated", entityType: "service", entityId: serviceId, changes: { name: rows[0].name } });
}
