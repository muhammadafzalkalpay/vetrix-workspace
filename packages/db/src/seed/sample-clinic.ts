// Loads the sample clinic (docs/test-data) into one clinic database, for
// development and staging only. Everything runs in one transaction and is
// recorded as an import job, with every source row in import_rows.
//
// Weekdays use 0 = Sunday ... 6 = Saturday (Postgres EXTRACT(DOW)).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isTaskService, type Pack } from "@vetrix/pack";
import type { SqlClient } from "../migrations";
import { readCsv } from "./csv";

export const SAMPLE_DATA_DIR = fileURLToPath(new URL("../../../../docs/test-data", import.meta.url));

export const SAMPLE_LOCATION = {
  name: "Main Veterinary Clinic",
  address: "100 Sample Street",
  timezone: "Asia/Karachi",
  mainPhone: "555-010-1000",
  species: ["dog", "cat"],
  // Mon–Fri 07:00–18:00, Sat 08:00–18:00, closed Sunday.
  hours: [1, 2, 3, 4, 5].map((d) => ({ weekday: d, opens: "07:00", closes: "18:00" })).concat([
    { weekday: 6, opens: "08:00", closes: "18:00" },
  ]),
  holidays: [
    { date: "2026-11-26", name: "Thanksgiving" },
    { date: "2026-12-25", name: "Christmas Day" },
  ],
};

const DAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** "Mon-Fri 08:00-18:00" -> one row per weekday. */
export function parseSchedule(text: string): { weekday: number; starts: string; ends: string }[] {
  const match = text.match(/^(\w{3})-(\w{3}) (\d{2}:\d{2})-(\d{2}:\d{2})$/);
  if (!match) throw new Error(`Unrecognised schedule "${text}"`);
  const [, from, to, starts, ends] = match as unknown as [string, string, string, string, string];
  const a = DAY_INDEX[from];
  const b = DAY_INDEX[to];
  if (a === undefined || b === undefined || b < a) throw new Error(`Unrecognised schedule "${text}"`);
  return Array.from({ length: b - a + 1 }, (_, i) => ({ weekday: a + i, starts, ends }));
}

/** Picks the species-appropriate service when the source row has the wrong one. */
export function serviceForSpecies(pack: Pack, serviceId: string, species: string, sex: string): string {
  const service = pack.services.services.find((s) => s.id === serviceId);
  if (!service || service.species.includes(species)) return serviceId;
  const kind = serviceId.startsWith("spay") || serviceId.startsWith("neuter") ? (sex === "female" ? "spay" : "neuter") : null;
  const family = species === "cat" ? "feline" : species === "dog" ? "canine" : null;
  const candidate = kind && family ? `${kind}_${family}` : null;
  return candidate && pack.services.services.some((s) => s.id === candidate) ? candidate : serviceId;
}

export interface SeedSummary {
  locationId: string;
  clients: number;
  patients: number;
  appointments: number;
  vaccineRecords: number;
  warnings: string[];
}

export interface SeedOptions {
  configPackId: string;
  dataDir?: string;
  /** Today's date in the clinic's time zone, for the "due in 30 days" count. */
  today?: string;
}

export async function seedSampleClinic(client: SqlClient, pack: Pack, options: SeedOptions): Promise<SeedSummary> {
  const dir = options.dataDir ?? SAMPLE_DATA_DIR;
  const csv = (name: string) => readCsv(path.join(dir, name));
  const data = {
    providers: csv("providers.csv"),
    rooms: csv("rooms.csv"),
    equipment: csv("equipment.csv"),
    clients: csv("clients.csv"),
    patients: csv("patients.csv"),
    visits: csv("visits.csv"),
    vaccines: csv("vaccine_records.csv"),
    prevention: csv("prevention_products.csv"),
  };
  const warnings: string[] = [];
  const q = async <R = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await client.query<R>(sql, params)).rows;
  const one = async (sql: string, params: unknown[] = []) => (await q<{ id: string }>(sql, params))[0]!.id;
  const nullIfEmpty = (v: string | undefined) => (v === undefined || v === "" ? null : v);
  const bool = (v: string) => v === "true";

  // Location and its settings.
  const L = SAMPLE_LOCATION;
  const locationId = await one(
    `INSERT INTO locations (vertical_id, vertical_locked, name, address, timezone, main_phone, live_at, status)
     VALUES ($1, true, $2, $3, $4, $5, now(), 'live') RETURNING id`,
    [pack.manifest.vertical_id, L.name, L.address, L.timezone, L.mainPhone],
  );
  for (const s of L.species) await q(`INSERT INTO location_species VALUES ($1, $2)`, [locationId, s]);
  for (const h of L.hours) {
    await q(`INSERT INTO location_hours (location_id, weekday, opens_at, closes_at) VALUES ($1, $2, $3, $4)`, [
      locationId, h.weekday, h.opens, h.closes,
    ]);
  }
  for (const h of L.holidays) {
    await q(`INSERT INTO location_holidays (location_id, holiday_date, name) VALUES ($1, $2, $3)`, [locationId, h.date, h.name]);
  }
  await q(
    `INSERT INTO location_after_hours (location_id, er_name, er_phone, er_address, behaviour)
     VALUES ($1, 'Metro Animal Emergency Hospital', '555-010-9111', '900 Sample Avenue', 'er_and_book_next')`,
    [locationId],
  );
  await q(
    `INSERT INTO location_policies (location_id, cancellation_window_hours, cancellation_fee, surgery_deposit,
       new_client_policy, payment_methods, refill_turnaround, records_release_policy, telehealth_enabled)
     VALUES ($1, 24, 25.00, 100.00, 'New clients are welcome. Please bring previous records.',
       '["card", "cash"]'::jsonb, '24 hours', 'Records are released to the owner or another clinic on request.', false)`,
    [locationId],
  );
  await q(
    `INSERT INTO location_phone_settings (location_id, greeting_text, ai_persona_name, emergency_transfer_number, staff_transfer_number)
     VALUES ($1, $2, $3, '555-010-1001', '555-010-1002')`,
    [locationId, `Thanks for calling ${L.name}.`, pack.brand.ai_persona.default_name],
  );
  await q(
    `INSERT INTO location_messaging_settings (location_id, sms_sender_name, opt_out_handling, quiet_start, quiet_end)
     VALUES ($1, 'Main Vet Clinic', 'STOP stops all texts. Confirmations then go by email or AI call.', $2, $3)`,
    [locationId, pack.retention.engine.quiet_hours_local.start, pack.retention.engine.quiet_hours_local.end],
  );
  await q(`INSERT INTO location_pack_configs (location_id, config_pack_ref, pack_version) VALUES ($1, $2, $3)`, [
    locationId, options.configPackId, pack.manifest.pack_version,
  ]);

  // Rooms, equipment, providers.
  const roomIds = new Map<string, string>();
  for (const r of data.rooms) {
    roomIds.set(r.id!, await one(
      `INSERT INTO rooms (location_id, type, name, capacity) VALUES ($1, $2, $3, $4) RETURNING id`,
      [locationId, r.type, r.name, Number(r.capacity)],
    ));
  }
  for (const e of data.equipment) {
    await q(`INSERT INTO equipment (location_id, type, name, exclusive) VALUES ($1, $2, $3, $4)`, [
      locationId, e.type, e.name, bool(e.exclusive!),
    ]);
  }
  const providerIds = new Map<string, string>();
  for (const p of data.providers) {
    const id = await one(
      `INSERT INTO providers (location_id, display_name, role, bookable, max_concurrent) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [locationId, p.display_name, p.role, bool(p.bookable!), Number(p.max_concurrent)],
    );
    providerIds.set(p.id!, id);
    for (const skill of (p.skills ?? "").split(";").filter(Boolean)) {
      await q(`INSERT INTO provider_skills VALUES ($1, $2)`, [id, skill]);
    }
    for (const s of parseSchedule(p.schedule!)) {
      await q(`INSERT INTO provider_schedules (provider_id, weekday, starts_at, ends_at) VALUES ($1, $2, $3, $4)`, [
        id, s.weekday, s.starts, s.ends,
      ]);
    }
  }

  // Services from the pack (task-only entries such as refills are not booked).
  const settings: Record<string, boolean> = { telehealth_enabled: false };
  const serviceIds = new Map<string, { id: string; duration: number }>();
  for (const s of pack.services.services) {
    if (isTaskService(s)) continue;
    const setting = (s as { enabled_by_setting?: string }).enabled_by_setting;
    const id = await one(
      `INSERT INTO services (location_id, pack_service_id, name, category, duration_min, buffer_before_min, buffer_after_min,
         provider_role, room_type, requires_doctor_on_premises, drop_off, drop_off_window, fasting_required,
         requires_preop_bloodwork, prerequisites, price_low_usd, price_high_usd, bookable_by_ai, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
      [
        locationId, s.id, s.name, s.category, s.duration_min, s.buffer_before_min ?? 0, s.buffer_after_min,
        s.provider_role, s.room_type, s.requires_doctor_on_premises, s.drop_off, s.drop_off_window ?? null,
        s.fasting_required, s.requires_preop_bloodwork, JSON.stringify(s.prerequisites),
        s.price_range_usd[0], s.price_range_usd[1], s.bookable_by_ai, setting ? (settings[setting] ?? false) : true,
      ],
    );
    serviceIds.set(s.id, { id, duration: s.duration_min });
    for (const sp of s.species) await q(`INSERT INTO service_species VALUES ($1, $2)`, [id, sp]);
    for (const k of s.required_skills) await q(`INSERT INTO service_skills VALUES ($1, $2)`, [id, k]);
    for (const e of s.equipment) await q(`INSERT INTO service_equipment (service_id, equipment_type) VALUES ($1, $2)`, [id, e]);
  }
  for (const r of pack.retention.rules) {
    await q(`INSERT INTO reminder_rules (location_id, pack_rule_id) VALUES ($1, $2)`, [locationId, r.id]);
  }
  for (const v of pack.retention.vaccines) {
    await q(
      `INSERT INTO vaccine_types (id, name, species, default_interval_months, core) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [v.id, v.name, v.species.join(","), v.default_interval_months, v.core],
    );
  }

  // Import job: every source row is kept in import_rows.
  const jobId = await one(`INSERT INTO import_jobs (location_id, status) VALUES ($1, 'importing') RETURNING id`, [locationId]);
  let rowNumber = 0;
  const logRow = async (file: string, row: Record<string, string>, entityId: string | null, warning?: string) => {
    rowNumber += 1;
    await q(`INSERT INTO import_rows (import_job_id, row_number, raw_row, status, error) VALUES ($1, $2, $3, 'imported', $4)`, [
      jobId, rowNumber, JSON.stringify({ source_file: file, source_id: row.id ?? null, entity_id: entityId, data: row }), warning ?? null,
    ]);
  };

  // Households and clients.
  const householdIds = new Map<string, string>();
  const clientIds = new Map<string, string>();
  const householdMembers = new Map<string, string[]>();
  for (const c of data.clients) {
    let householdId = householdIds.get(c.household_id!);
    if (!householdId) {
      householdId = await one(`INSERT INTO households (location_id, address) VALUES ($1, $2) RETURNING id`, [locationId, nullIfEmpty(c.address)]);
      householdIds.set(c.household_id!, householdId);
    }
    const id = await one(
      `INSERT INTO clients (location_id, household_id, first_name, last_name, mobile, email, address, preferred_channel,
         sms_consent, sms_consent_at, sms_consent_source, marketing_consent, source, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [
        locationId, householdId, c.first_name, c.last_name, c.mobile, nullIfEmpty(c.email), nullIfEmpty(c.address),
        c.preferred_channel, bool(c.sms_consent!), nullIfEmpty(c.sms_consent_at), nullIfEmpty(c.sms_consent_source),
        bool(c.marketing_consent!), c.source, c.created_at,
      ],
    );
    clientIds.set(c.id!, id);
    householdMembers.set(householdId, [...(householdMembers.get(householdId) ?? []), id]);
    for (const flag of (c.flags ?? "").split(";").filter(Boolean)) await q(`INSERT INTO client_flags VALUES ($1, $2)`, [id, flag]);
    if (c.sms_consent === "true") {
      await q(`INSERT INTO client_consents (client_id, consent_type, granted, source, captured_at) VALUES ($1, 'sms', true, $2, $3)`, [
        id, c.sms_consent_source || "import", c.sms_consent_at || c.created_at,
      ]);
    }
    await q(`INSERT INTO client_consents (client_id, consent_type, granted, source, captured_at) VALUES ($1, 'marketing', $2, 'import', $3)`, [
      id, c.marketing_consent === "true", c.created_at,
    ]);
    await logRow("clients.csv", c, id);
  }
  for (const [householdId, members] of householdMembers) {
    await q(`UPDATE households SET primary_client_id = $2 WHERE id = $1`, [householdId, members[0]]);
  }

  // Patients. The owner receives reminders; other household members are
  // contacts without reminders, so a household gets one message, not two.
  const patientIds = new Map<string, string>();
  const patientRows = new Map<string, Record<string, string>>();
  for (const p of data.patients) {
    const ownerId = clientIds.get(p.client_id!);
    if (!ownerId) throw new Error(`patients.csv ${p.id}: unknown client ${p.client_id}`);
    const id = await one(
      `INSERT INTO patients (client_id, location_id, name, species, breed, sex, neutered, date_of_birth, weight_kg,
         color_markings, microchip_number, status, deceased_date, medical_alerts, active_prescriptions,
         last_wellness_exam_at, last_dental_at, last_surgery_at, referring_clinic, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING id`,
      [
        ownerId, locationId, p.name, p.species, nullIfEmpty(p.breed), nullIfEmpty(p.sex), p.neutered === "" ? null : bool(p.neutered!),
        nullIfEmpty(p.date_of_birth), nullIfEmpty(p.weight_kg), nullIfEmpty(p.color_markings), nullIfEmpty(p.microchip_number),
        p.status, nullIfEmpty(p.deceased_date), nullIfEmpty(p.medical_alerts), bool(p.active_prescriptions!),
        nullIfEmpty(p.last_wellness_exam_at), nullIfEmpty(p.last_dental_at), nullIfEmpty(p.last_surgery_at),
        nullIfEmpty(p.referring_clinic), p.created_at,
      ],
    );
    patientIds.set(p.id!, id);
    patientRows.set(p.id!, p);
    for (const flag of (p.temperament_flags ?? "").split(";").filter(Boolean)) {
      await q(`INSERT INTO patient_temperament_flags VALUES ($1, $2)`, [id, flag]);
    }
    const householdId = (await q<{ household_id: string }>(`SELECT household_id FROM clients WHERE id = $1`, [ownerId]))[0]!.household_id;
    for (const member of householdMembers.get(householdId) ?? [ownerId]) {
      await q(`INSERT INTO patient_contacts (patient_id, client_id, receives_reminders) VALUES ($1, $2, $3)`, [id, member, member === ownerId]);
    }
    await logRow("patients.csv", p, id);
  }

  for (const v of data.vaccines) {
    const patientId = patientIds.get(v.patient_id!);
    if (!patientId) throw new Error(`vaccine_records.csv: unknown patient ${v.patient_id}`);
    const id = await one(
      `INSERT INTO vaccine_records (patient_id, vaccine_id, administered_at, due_at, interval_months, administered_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [patientId, v.vaccine_id, v.administered_at, v.due_at, Number(v.interval_months), v.administered_by],
    );
    await logRow("vaccine_records.csv", v, id);
  }
  for (const pr of data.prevention) {
    const patientId = patientIds.get(pr.patient_id!);
    if (!patientId) throw new Error(`prevention_products.csv: unknown patient ${pr.patient_id}`);
    const id = await one(
      `INSERT INTO prevention_products (patient_id, product_type, product_name, dose_interval_days, doses_supplied, supply_start_at, supply_end_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [patientId, pr.product_type, pr.product_name, Number(pr.dose_interval_days), Number(pr.doses_supplied), pr.supply_start_at, pr.supply_end_at],
    );
    await logRow("prevention_products.csv", pr, id);
  }

  // Past visits become completed (or no-show) appointments. The source has
  // dates only, so they start at 09:00 local and hold no calendar resources:
  // history must never block future availability.
  let appointments = 0;
  for (const v of data.visits) {
    const patient = patientRows.get(v.patient_id!);
    if (!patient) throw new Error(`visits.csv ${v.id}: unknown patient ${v.patient_id}`);
    const mapped = serviceForSpecies(pack, v.service_id!, patient.species!, patient.sex!);
    const service = serviceIds.get(mapped);
    if (!service) throw new Error(`visits.csv ${v.id}: unknown service ${v.service_id}`);
    const warning = mapped !== v.service_id ? `service ${v.service_id} does not fit a ${patient.species}; imported as ${mapped}` : undefined;
    if (warning) warnings.push(`${v.id} (${patient.name}): ${warning}`);
    const id = await one(
      `INSERT INTO appointments (location_id, patient_id, client_id, service_id, provider_id, room_id, start_at, end_at, status, booked_by)
       VALUES ($1, $2, $3, $4, $5, $6,
               ($7::date + time '09:00') AT TIME ZONE $8,
               ($7::date + time '09:00' + make_interval(mins => $9)) AT TIME ZONE $8,
               $10, 'staff') RETURNING id`,
      [
        locationId, patientIds.get(v.patient_id!), clientIds.get(v.client_id!), service.id,
        providerIds.get(v.provider_id!) ?? null, roomIds.get(v.room_id!) ?? null, v.date, L.timezone,
        Math.max(service.duration, 15), v.status,
      ],
    );
    await q(`INSERT INTO appointment_status_history (appointment_id, from_status, to_status, actor_type, changed_at)
             VALUES ($1, NULL, $2, 'system', ($3::date + time '09:00') AT TIME ZONE $4)`, [id, v.status, v.date, L.timezone]);
    if (v.status === "no_show") {
      await q(`UPDATE clients SET no_show_count = no_show_count + 1 WHERE id = $1`, [clientIds.get(v.client_id!)]);
    }
    appointments += 1;
    await logRow("visits.csv", v, id, warning);
  }

  // Patients with a wellness exam or vaccine due in the next 30 days.
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const due = await q<{ n: number }>(
    `SELECT count(DISTINCT p.id)::int AS n FROM patients p
     LEFT JOIN vaccine_records v ON v.patient_id = p.id
     WHERE p.location_id = $1 AND p.status = 'active' AND (
       (p.last_wellness_exam_at + 365) BETWEEN $2::date AND $2::date + 30
       OR v.due_at BETWEEN $2::date AND $2::date + 30)`,
    [locationId, today],
  );
  await q(`UPDATE import_jobs SET status = 'completed', clients_created = $2, pets_created = $3, pets_due_30d = $4 WHERE id = $1`, [
    jobId, clientIds.size, patientIds.size, due[0]!.n,
  ]);

  return {
    locationId,
    clients: clientIds.size,
    patients: patientIds.size,
    appointments,
    vaccineRecords: data.vaccines.length,
    warnings,
  };
}
