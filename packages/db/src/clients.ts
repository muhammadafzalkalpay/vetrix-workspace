// Clients, households and patients in a clinic database. Inputs arrive
// already validated by @vetrix/domain (validateClient, validatePatient);
// this file only reads and writes, and records every change in audit_logs.
import {
  ConflictError,
  NotFoundError,
  confirmDeceased,
  type ClientFlag,
  type ClientSource,
  type DeceasedConfirmation,
  type PatientStatus,
  type Species,
  type TemperamentFlag,
  type ValidClient,
  type ValidPatient,
} from "@vetrix/domain";
import type { SqlClient } from "./sql-client";

/** Who made a change, for the audit log. */
export interface Actor {
  type: "ai" | "staff" | "client" | "system";
  id: string | null;
}

/** A pool that can hand out one connection for a transaction. */
export interface TransactionPool {
  connect(): Promise<SqlClient & { release(): void }>;
}

/** Runs `fn` in one transaction: all of it is saved, or none of it. */
export async function withTransaction<T>(pool: TransactionPool, fn: (tx: SqlClient) => Promise<T>): Promise<T> {
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    const result = await fn(tx);
    await tx.query("COMMIT");
    return result;
  } catch (error) {
    await tx.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    tx.release();
  }
}

export async function writeAudit(
  db: SqlClient,
  entry: { locationId: string; actor: Actor; action: string; entityType: string; entityId: string; changes?: Record<string, unknown> },
): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (location_id, actor_type, actor_id, action, entity_type, entity_id, changes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [entry.locationId, entry.actor.type, entry.actor.id, entry.action, entry.entityType, entry.entityId, JSON.stringify(entry.changes ?? {})],
  );
}

/** Only the fields that changed, as { field: [before, after] }. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const key of Object.keys(after)) {
    const a = JSON.stringify(before[key] ?? null);
    const b = JSON.stringify(after[key] ?? null);
    if (a !== b) out[key] = [before[key] ?? null, after[key] ?? null];
  }
  return out;
}

function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const e = error as { code?: string; constraint?: string };
  return e?.code === "23505" && (!constraint || e.constraint === constraint);
}

// ---------- Reading ----------

export interface ClientListItem {
  id: string;
  first_name: string;
  last_name: string;
  mobile: string;
  email: string | null;
  household_id: string | null;
  flags: ClientFlag[];
  pets: { id: string; name: string; species: Species; status: PatientStatus }[];
}

/**
 * Finds clients by name, phone (any format), email or pet name. An empty
 * search lists clients by last name.
 */
export async function searchClients(
  db: SqlClient,
  locationId: string,
  opts: { q?: string; limit?: number; offset?: number } = {},
): Promise<{ rows: ClientListItem[]; total: number }> {
  const q = opts.q?.trim() ?? "";
  const digits = q.replace(/\D/g, "");
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const where = `c.location_id = $1 AND (
      $2 = '' OR
      (c.first_name || ' ' || c.last_name) ILIKE '%' || $2 || '%' OR
      c.email ILIKE '%' || $2 || '%' OR
      (length($3) >= 3 AND regexp_replace(c.mobile, '\\D', '', 'g') LIKE '%' || $3 || '%') OR
      EXISTS (SELECT 1 FROM patients p WHERE p.client_id = c.id AND p.name ILIKE '%' || $2 || '%')
    )`;
  const [list, count] = await Promise.all([
    db.query<ClientListItem>(
      `SELECT c.id, c.first_name, c.last_name, c.mobile, c.email::text AS email, c.household_id,
              coalesce((SELECT array_agg(f.flag ORDER BY f.flag) FROM client_flags f WHERE f.client_id = c.id), '{}') AS flags,
              coalesce((SELECT json_agg(json_build_object('id', p.id, 'name', p.name, 'species', p.species, 'status', p.status)
                                 ORDER BY p.status = 'active' DESC, p.name)
                        FROM patients p WHERE p.client_id = c.id), '[]') AS pets
       FROM clients c WHERE ${where}
       ORDER BY c.last_name, c.first_name, c.id
       LIMIT $4 OFFSET $5`,
      [locationId, q, digits, limit, offset],
    ),
    db.query<{ n: number }>(`SELECT count(*)::int AS n FROM clients c WHERE ${where}`, [locationId, q, digits]),
  ]);
  return { rows: list.rows, total: count.rows[0]?.n ?? 0 };
}

export interface ClientDetail {
  id: string;
  location_id: string;
  household_id: string | null;
  first_name: string;
  last_name: string;
  mobile: string;
  email: string | null;
  alt_phone: string | null;
  address: string | null;
  preferred_channel: "sms" | "email" | "call";
  sms_consent: boolean;
  marketing_consent: boolean;
  notes: string | null;
  no_show_count: number;
  source: ClientSource;
  created_at: Date;
  flags: ClientFlag[];
  household: { id: string; first_name: string; last_name: string; mobile: string; is_primary: boolean }[];
  pets: PatientListItem[];
}

export async function getClient(db: SqlClient, locationId: string, clientId: string): Promise<ClientDetail> {
  const { rows } = await db.query<ClientDetail>(
    `SELECT c.id, c.location_id, c.household_id, c.first_name, c.last_name, c.mobile, c.email::text AS email, c.alt_phone,
            c.address, c.preferred_channel, c.sms_consent, c.marketing_consent, c.notes, c.no_show_count, c.source, c.created_at,
            coalesce((SELECT array_agg(f.flag ORDER BY f.flag) FROM client_flags f WHERE f.client_id = c.id), '{}') AS flags,
            coalesce((SELECT json_agg(json_build_object('id', o.id, 'first_name', o.first_name, 'last_name', o.last_name,
                                                        'mobile', o.mobile, 'is_primary', h.primary_client_id = o.id)
                                      ORDER BY h.primary_client_id = o.id DESC, o.first_name)
                      FROM clients o JOIN households h ON h.id = o.household_id
                      WHERE o.household_id = c.household_id AND o.id <> c.id), '[]') AS household
     FROM clients c WHERE c.id = $1 AND c.location_id = $2`,
    [clientId, locationId],
  );
  const client = rows[0];
  if (!client) throw new NotFoundError("Client", clientId);
  // Pets of this client plus pets they are a contact for (shared household pets).
  client.pets = (
    await db.query<PatientListItem>(
      `${PATIENT_LIST_SELECT}
       WHERE p.location_id = $1 AND (p.client_id = $2 OR EXISTS
         (SELECT 1 FROM patient_contacts pc WHERE pc.patient_id = p.id AND pc.client_id = $2))
       ORDER BY p.status = 'active' DESC, p.name`,
      [locationId, clientId],
    )
  ).rows;
  return client;
}

export interface PatientListItem {
  id: string;
  name: string;
  species: Species;
  breed: string | null;
  sex: "male" | "female" | null;
  date_of_birth: string | null;
  approx_age_months: number | null;
  status: PatientStatus;
  owner_id: string;
  owner_name: string;
  temperament_flags: TemperamentFlag[];
}

const PATIENT_LIST_SELECT = `
  SELECT p.id, p.name, p.species, p.breed, p.sex, to_char(p.date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
         p.approx_age_months, p.status, c.id AS owner_id, c.first_name || ' ' || c.last_name AS owner_name,
         coalesce((SELECT array_agg(t.flag ORDER BY t.flag) FROM patient_temperament_flags t WHERE t.patient_id = p.id), '{}')
           AS temperament_flags
  FROM patients p JOIN clients c ON c.id = p.client_id`;

export async function searchPatients(
  db: SqlClient,
  locationId: string,
  opts: { q?: string; status?: PatientStatus | "all"; species?: Species; limit?: number; offset?: number } = {},
): Promise<{ rows: PatientListItem[]; total: number }> {
  const q = opts.q?.trim() ?? "";
  const status = opts.status ?? "active";
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const where = `p.location_id = $1
    AND ($2 = 'all' OR p.status = $2)
    AND ($3::text IS NULL OR p.species = $3)
    AND ($4 = '' OR p.name ILIKE '%' || $4 || '%' OR (c.first_name || ' ' || c.last_name) ILIKE '%' || $4 || '%'
         OR p.microchip_number = regexp_replace($4, '\\s', '', 'g'))`;
  const params = [locationId, status, opts.species ?? null, q];
  const [list, count] = await Promise.all([
    db.query<PatientListItem>(`${PATIENT_LIST_SELECT} WHERE ${where} ORDER BY p.name, p.id LIMIT $5 OFFSET $6`, [...params, limit, offset]),
    db.query<{ n: number }>(`SELECT count(*)::int AS n FROM patients p JOIN clients c ON c.id = p.client_id WHERE ${where}`, params),
  ]);
  return { rows: list.rows, total: count.rows[0]?.n ?? 0 };
}

export interface PatientDetail extends PatientListItem {
  location_id: string;
  neutered: boolean | null;
  weight_kg: string | null;
  color_markings: string | null;
  microchip_number: string | null;
  deceased_date: string | null;
  medical_alerts: string | null;
  active_prescriptions: boolean;
  last_wellness_exam_at: string | null;
  last_dental_at: string | null;
  last_surgery_at: string | null;
  contacts: { client_id: string; name: string; mobile: string; receives_reminders: boolean }[];
  vaccines: { vaccine: string; administered_at: string; due_at: string | null }[];
}

export async function getPatient(db: SqlClient, locationId: string, patientId: string): Promise<PatientDetail> {
  const { rows } = await db.query<PatientDetail>(
    `SELECT p.id, p.location_id, p.name, p.species, p.breed, p.sex, p.neutered, p.weight_kg::text AS weight_kg,
            to_char(p.date_of_birth, 'YYYY-MM-DD') AS date_of_birth, p.approx_age_months, p.status,
            p.color_markings, p.microchip_number, to_char(p.deceased_date, 'YYYY-MM-DD') AS deceased_date,
            p.medical_alerts, p.active_prescriptions,
            to_char(p.last_wellness_exam_at, 'YYYY-MM-DD') AS last_wellness_exam_at,
            to_char(p.last_dental_at, 'YYYY-MM-DD') AS last_dental_at,
            to_char(p.last_surgery_at, 'YYYY-MM-DD') AS last_surgery_at,
            c.id AS owner_id, c.first_name || ' ' || c.last_name AS owner_name,
            coalesce((SELECT array_agg(t.flag ORDER BY t.flag) FROM patient_temperament_flags t WHERE t.patient_id = p.id), '{}')
              AS temperament_flags,
            coalesce((SELECT json_agg(json_build_object('client_id', o.id, 'name', o.first_name || ' ' || o.last_name,
                                                        'mobile', o.mobile, 'receives_reminders', pc.receives_reminders)
                                      ORDER BY o.id = p.client_id DESC, o.first_name)
                      FROM patient_contacts pc JOIN clients o ON o.id = pc.client_id WHERE pc.patient_id = p.id), '[]') AS contacts,
            coalesce((SELECT json_agg(json_build_object('vaccine', vt.name, 'administered_at', to_char(v.administered_at, 'YYYY-MM-DD'),
                                                        'due_at', to_char(v.due_at, 'YYYY-MM-DD'))
                                      ORDER BY v.administered_at DESC)
                      FROM vaccine_records v JOIN vaccine_types vt ON vt.id = v.vaccine_id WHERE v.patient_id = p.id), '[]') AS vaccines
     FROM patients p JOIN clients c ON c.id = p.client_id
     WHERE p.id = $1 AND p.location_id = $2`,
    [patientId, locationId],
  );
  if (!rows[0]) throw new NotFoundError("Patient", patientId);
  return rows[0];
}

// ---------- Writing clients ----------

const CLIENT_COLUMNS = {
  firstName: "first_name",
  lastName: "last_name",
  mobile: "mobile",
  email: "email",
  altPhone: "alt_phone",
  address: "address",
  preferredChannel: "preferred_channel",
  smsConsent: "sms_consent",
  marketingConsent: "marketing_consent",
  notes: "notes",
} as const;

async function setClientFlags(db: SqlClient, clientId: string, flags: ClientFlag[]) {
  await db.query(`DELETE FROM client_flags WHERE client_id = $1 AND NOT (flag = ANY($2::text[]))`, [clientId, flags]);
  await db.query(`INSERT INTO client_flags (client_id, flag) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`, [clientId, flags]);
}

async function recordConsent(db: SqlClient, clientId: string, type: "sms" | "marketing", granted: boolean, source: string) {
  await db.query(`INSERT INTO client_consents (client_id, consent_type, granted, source) VALUES ($1, $2, $3, $4)`, [
    clientId,
    type,
    granted,
    source,
  ]);
}

function duplicateMobile(error: unknown): never {
  if (isUniqueViolation(error, "clients_location_id_mobile_key")) {
    throw new ConflictError("Another client at this location already has that mobile number.", { field: "mobile" });
  }
  throw error;
}

export async function createClient(
  db: SqlClient,
  input: { locationId: string; client: ValidClient; source: ClientSource; householdId?: string | null; actor: Actor },
): Promise<string> {
  const c = input.client;
  let householdId = input.householdId ?? null;
  if (householdId) {
    const h = await db.query(`SELECT 1 FROM households WHERE id = $1 AND location_id = $2`, [householdId, input.locationId]);
    if (!h.rows[0]) throw new NotFoundError("Household", householdId);
  } else {
    householdId = (
      await db.query<{ id: string }>(`INSERT INTO households (location_id, address) VALUES ($1, $2) RETURNING id`, [
        input.locationId,
        c.address,
      ])
    ).rows[0]!.id;
  }
  let id: string;
  try {
    id = (
      await db.query<{ id: string }>(
        `INSERT INTO clients (location_id, household_id, first_name, last_name, mobile, email, alt_phone, address,
                              preferred_channel, sms_consent, sms_consent_at, sms_consent_source, marketing_consent, notes, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CASE WHEN $10 THEN now() END, CASE WHEN $10 THEN $11 END, $12, $13, $11)
         RETURNING id`,
        [input.locationId, householdId, c.firstName, c.lastName, c.mobile, c.email, c.altPhone, c.address,
         c.preferredChannel, c.smsConsent, input.source, c.marketingConsent, c.notes],
      )
    ).rows[0]!.id;
  } catch (error) {
    duplicateMobile(error);
  }
  await db.query(`UPDATE households SET primary_client_id = $1 WHERE id = $2 AND primary_client_id IS NULL`, [id, householdId]);
  await setClientFlags(db, id, c.flags);
  if (c.smsConsent) await recordConsent(db, id, "sms", true, input.source);
  if (c.marketingConsent) await recordConsent(db, id, "marketing", true, input.source);
  await writeAudit(db, {
    locationId: input.locationId,
    actor: input.actor,
    action: "client.created",
    entityType: "client",
    entityId: id,
    changes: { ...c, mobile: "[set]", email: c.email ? "[set]" : null },
  });
  return id;
}

export async function updateClient(
  db: SqlClient,
  input: { locationId: string; clientId: string; client: ValidClient; actor: Actor; consentSource?: string },
): Promise<void> {
  const before = await getClient(db, input.locationId, input.clientId);
  const c = input.client;
  const beforeValues: Record<string, unknown> = {};
  const afterValues: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(CLIENT_COLUMNS)) {
    beforeValues[key] = before[column as keyof ClientDetail];
    afterValues[key] = c[key as keyof ValidClient];
  }
  beforeValues.flags = before.flags;
  afterValues.flags = c.flags;
  const changes = diff(beforeValues, afterValues);
  if (Object.keys(changes).length === 0) return;

  const source = input.consentSource ?? "staff";
  try {
    await db.query(
      `UPDATE clients SET first_name = $3, last_name = $4, mobile = $5, email = $6, alt_phone = $7, address = $8,
              preferred_channel = $9, marketing_consent = $11, notes = $12,
              sms_consent = $10,
              sms_consent_at = CASE WHEN $10 AND NOT sms_consent THEN now() WHEN NOT $10 THEN NULL ELSE sms_consent_at END,
              sms_consent_source = CASE WHEN $10 AND NOT sms_consent THEN $13 WHEN NOT $10 THEN NULL ELSE sms_consent_source END
       WHERE id = $1 AND location_id = $2`,
      [input.clientId, input.locationId, c.firstName, c.lastName, c.mobile, c.email, c.altPhone, c.address,
       c.preferredChannel, c.smsConsent, c.marketingConsent, c.notes, source],
    );
  } catch (error) {
    duplicateMobile(error);
  }
  await setClientFlags(db, input.clientId, c.flags);
  if (changes.smsConsent) await recordConsent(db, input.clientId, "sms", c.smsConsent, source);
  if (changes.marketingConsent) await recordConsent(db, input.clientId, "marketing", c.marketingConsent, source);
  // Contact details are personal data: the log says they changed, not to what.
  for (const k of ["mobile", "email", "altPhone", "address"]) if (changes[k]) changes[k] = ["[changed]", "[changed]"];
  await writeAudit(db, { locationId: input.locationId, actor: input.actor, action: "client.updated", entityType: "client", entityId: input.clientId, changes });
}

// ---------- Writing patients ----------

async function setTemperament(db: SqlClient, patientId: string, flags: TemperamentFlag[]) {
  await db.query(`DELETE FROM patient_temperament_flags WHERE patient_id = $1 AND NOT (flag = ANY($2::text[]))`, [patientId, flags]);
  await db.query(`INSERT INTO patient_temperament_flags (patient_id, flag) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`, [
    patientId,
    flags,
  ]);
}

export async function createPatient(
  db: SqlClient,
  input: { locationId: string; clientId: string; patient: ValidPatient; actor: Actor; provisional?: boolean },
): Promise<string> {
  const owner = await db.query(`SELECT 1 FROM clients WHERE id = $1 AND location_id = $2`, [input.clientId, input.locationId]);
  if (!owner.rows[0]) throw new NotFoundError("Client", input.clientId);
  const p = input.patient;
  const id = (
    await db.query<{ id: string }>(
      `INSERT INTO patients (client_id, location_id, name, species, breed, sex, neutered, date_of_birth, approx_age_months,
                             weight_kg, color_markings, microchip_number, medical_alerts, provisional)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
      [input.clientId, input.locationId, p.name, p.species, p.breed, p.sex, p.neutered, p.dateOfBirth, p.approxAgeMonths,
       p.weightKg, p.colorMarkings, p.microchipNumber, p.medicalAlerts, input.provisional ?? false],
    )
  ).rows[0]!.id;
  await db.query(`INSERT INTO patient_contacts (patient_id, client_id, receives_reminders) VALUES ($1, $2, true)`, [id, input.clientId]);
  await setTemperament(db, id, p.temperamentFlags);
  await writeAudit(db, { locationId: input.locationId, actor: input.actor, action: "patient.created", entityType: "patient", entityId: id, changes: { ...p } });
  return id;
}

export async function updatePatient(
  db: SqlClient,
  input: { locationId: string; patientId: string; patient: ValidPatient; actor: Actor },
): Promise<void> {
  const before = await getPatient(db, input.locationId, input.patientId);
  const p = input.patient;
  const changes = diff(
    {
      name: before.name, species: before.species, breed: before.breed, sex: before.sex, neutered: before.neutered,
      dateOfBirth: before.date_of_birth, approxAgeMonths: before.approx_age_months,
      weightKg: before.weight_kg == null ? null : Number(before.weight_kg), colorMarkings: before.color_markings,
      microchipNumber: before.microchip_number, medicalAlerts: before.medical_alerts, temperamentFlags: before.temperament_flags,
    },
    { ...p },
  );
  if (Object.keys(changes).length === 0) return;
  await db.query(
    `UPDATE patients SET name = $3, species = $4, breed = $5, sex = $6, neutered = $7, date_of_birth = $8, approx_age_months = $9,
            weight_kg = $10, color_markings = $11, microchip_number = $12, medical_alerts = $13
     WHERE id = $1 AND location_id = $2`,
    [input.patientId, input.locationId, p.name, p.species, p.breed, p.sex, p.neutered, p.dateOfBirth, p.approxAgeMonths,
     p.weightKg, p.colorMarkings, p.microchipNumber, p.medicalAlerts],
  );
  await setTemperament(db, input.patientId, p.temperamentFlags);
  await writeAudit(db, { locationId: input.locationId, actor: input.actor, action: "patient.updated", entityType: "patient", entityId: input.patientId, changes });
}

export interface DeceasedResult {
  remindersStopped: number;
  messagesCancelled: number;
  /** Future visits still booked; staff decide what to do with each. */
  upcomingAppointments: { id: string; start_at: Date; service_name: string }[];
}

/**
 * Marks a pet deceased after confirming the death, name and species (pack
 * v0.2), and stops every open reminder so the family is not contacted about it.
 */
export async function markPatientDeceased(
  db: SqlClient,
  input: { locationId: string; patientId: string; confirmation: DeceasedConfirmation; today: string; actor: Actor },
): Promise<DeceasedResult> {
  const patient = await getPatient(db, input.locationId, input.patientId);
  const { deceasedDate } = confirmDeceased(patient, input.confirmation, input.today);
  await db.query(`UPDATE patients SET status = 'deceased', deceased_date = $2 WHERE id = $1`, [input.patientId, deceasedDate]);
  const stopped = await db.query<{ id: string }>(
    `UPDATE reminders SET status = 'stopped', stopped_at = now(), stop_reason = 'deceased'
     WHERE patient_id = $1 AND status = 'open' RETURNING id`,
    [input.patientId],
  );
  const cancelled = await db.query<{ id: string }>(
    `UPDATE reminder_touches t SET status = 'cancelled', suppression_reason = 'deceased'
     FROM reminders r WHERE r.id = t.reminder_id AND r.patient_id = $1 AND t.status = 'scheduled' RETURNING t.id`,
    [input.patientId],
  );
  const upcoming = await db.query<DeceasedResult["upcomingAppointments"][number]>(
    `SELECT a.id, a.start_at, s.name AS service_name FROM appointments a JOIN services s ON s.id = a.service_id
     WHERE a.patient_id = $1 AND a.start_at > now() AND a.status NOT IN ('cancelled', 'completed', 'no_show')
     ORDER BY a.start_at`,
    [input.patientId],
  );
  await writeAudit(db, {
    locationId: input.locationId,
    actor: input.actor,
    action: "patient.deceased",
    entityType: "patient",
    entityId: input.patientId,
    changes: { deceasedDate, remindersStopped: stopped.rows.length, messagesCancelled: cancelled.rows.length },
  });
  return { remindersStopped: stopped.rows.length, messagesCancelled: cancelled.rows.length, upcomingAppointments: upcoming.rows };
}
