// Saves an import plan (from @vetrix/domain planImport) into a clinic
// database. Rows are inserted in batches with unnest(), so thousands of
// records take a handful of round trips instead of one per row. Call it
// inside a transaction: a failure leaves nothing half-imported.
import { randomUUID } from "node:crypto";
import { petKey, type CsvRow, type ImportPlan } from "@vetrix/domain";
import { writeAudit, type Actor } from "./clients";
import type { SqlClient } from "./sql-client";

const BATCH = 1000;

async function inBatches<T>(items: T[], run: (batch: T[]) => Promise<unknown>) {
  for (let i = 0; i < items.length; i += BATCH) await run(items.slice(i, i + BATCH));
}

/** Facts the planner needs from the clinic database. */
export async function importContext(db: SqlClient, locationId: string) {
  const [mobiles, pets, vaccines, records] = await Promise.all([
    db.query<{ mobile: string; id: string }>(`SELECT mobile, id FROM clients WHERE location_id = $1`, [locationId]),
    db.query<{ client_id: string; name: string; species: string; id: string }>(
      `SELECT client_id, name, species, id FROM patients WHERE location_id = $1`,
      [locationId],
    ),
    db.query<{ id: string; species: string; default_interval_months: number }>(`SELECT id, species, default_interval_months FROM vaccine_types`),
    db.query<{ k: string }>(
      `SELECT v.patient_id || '|' || v.vaccine_id || '|' || to_char(v.administered_at, 'YYYY-MM-DD') AS k
       FROM vaccine_records v JOIN patients p ON p.id = v.patient_id WHERE p.location_id = $1`,
      [locationId],
    ),
  ]);
  return {
    existingMobiles: new Map(mobiles.rows.map((r) => [r.mobile, r.id])),
    existingPets: new Map(pets.rows.map((r) => [petKey(r.client_id, r.name, r.species), r.id])),
    existingVaccines: new Set(records.rows.map((r) => r.k)),
    vaccineTypes: new Map(vaccines.rows.map((r) => [r.id, { species: r.species, intervalMonths: r.default_interval_months }])),
  };
}

export interface ImportResult {
  jobId: string;
  clientsCreated: number;
  clientsMatched: number;
  petsCreated: number;
  vaccinesCreated: number;
  petsDue30d: number;
  rowsFailed: number;
}

export async function runImport(
  db: SqlClient,
  input: {
    locationId: string;
    /** Clinic date, YYYY-MM-DD, for the "due in 30 days" count. */
    today: string;
    plan: ImportPlan;
    /** The original rows, kept in import_rows for tracing. */
    source: { clients: CsvRow[]; patients: CsvRow[]; vaccines: CsvRow[] };
    actor: Actor;
  },
): Promise<ImportResult> {
  const { locationId, plan, actor } = input;
  const jobId = (
    await db.query<{ id: string }>(`INSERT INTO import_jobs (location_id, status) VALUES ($1, 'importing') RETURNING id`, [locationId])
  ).rows[0]!.id;

  // ---- Households: one per household key among new clients ----
  const newClients = plan.clients.filter((c) => !c.existingId);
  const householdIds = new Map<string, string>();
  for (const c of newClients) if (!householdIds.has(c.householdKey)) householdIds.set(c.householdKey, randomUUID());
  const householdAddress = new Map<string, string | null>();
  for (const c of newClients) if (!householdAddress.has(c.householdKey)) householdAddress.set(c.householdKey, c.client.address);
  await inBatches([...householdIds], (batch) =>
    db.query(`INSERT INTO households (id, location_id, address) SELECT u.id, $1, u.address FROM unnest($2::uuid[], $3::text[]) AS u(id, address)`, [
      locationId,
      batch.map(([, id]) => id),
      batch.map(([key]) => householdAddress.get(key) ?? null),
    ]),
  );

  // ---- Clients ----
  const clientIds = new Map<string, string>(); // source id -> database id
  for (const c of plan.clients) clientIds.set(c.sourceId, c.existingId ?? randomUUID());
  await inBatches(newClients, (batch) =>
    db.query(
      `INSERT INTO clients (id, location_id, household_id, first_name, last_name, mobile, email, alt_phone, address,
                            preferred_channel, sms_consent, sms_consent_at, sms_consent_source, marketing_consent, notes, source)
       SELECT u.id, $1, u.household_id, u.first_name, u.last_name, u.mobile, u.email, u.alt_phone, u.address,
              u.channel, u.sms, CASE WHEN u.sms THEN now() END, u.sms_source, u.marketing, u.notes, 'import'
       FROM unnest($2::uuid[], $3::uuid[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[],
                   $10::text[], $11::bool[], $12::text[], $13::bool[], $14::text[])
         AS u(id, household_id, first_name, last_name, mobile, email, alt_phone, address, channel, sms, sms_source, marketing, notes)`,
      [
        locationId,
        batch.map((c) => clientIds.get(c.sourceId)),
        batch.map((c) => householdIds.get(c.householdKey)),
        batch.map((c) => c.client.firstName),
        batch.map((c) => c.client.lastName),
        batch.map((c) => c.client.mobile),
        batch.map((c) => c.client.email),
        batch.map((c) => c.client.altPhone),
        batch.map((c) => c.client.address),
        batch.map((c) => c.client.preferredChannel),
        batch.map((c) => c.client.smsConsent),
        batch.map((c) => c.smsConsentSource),
        batch.map((c) => c.client.marketingConsent),
        batch.map((c) => c.client.notes),
      ],
    ),
  );
  // First new client in each household is its main contact.
  await db.query(
    `UPDATE households h SET primary_client_id = first.id
     FROM (SELECT DISTINCT ON (household_id) household_id, id FROM clients
           WHERE household_id = ANY($1::uuid[]) ORDER BY household_id, created_at, id) first
     WHERE h.id = first.household_id AND h.primary_client_id IS NULL`,
    [[...householdIds.values()]],
  );
  const flagRows = newClients.flatMap((c) => c.client.flags.map((f) => [clientIds.get(c.sourceId)!, f] as const));
  await inBatches(flagRows, (batch) =>
    db.query(`INSERT INTO client_flags (client_id, flag) SELECT * FROM unnest($1::uuid[], $2::text[]) ON CONFLICT DO NOTHING`, [
      batch.map((r) => r[0]),
      batch.map((r) => r[1]),
    ]),
  );
  const consentRows = newClients.flatMap((c) => [
    ...(c.client.smsConsent ? [[clientIds.get(c.sourceId)!, "sms", c.smsConsentSource ?? "import"] as const] : []),
    ...(c.client.marketingConsent ? [[clientIds.get(c.sourceId)!, "marketing", "import"] as const] : []),
  ]);
  await inBatches(consentRows, (batch) =>
    db.query(
      `INSERT INTO client_consents (client_id, consent_type, granted, source) SELECT u.c, u.t, true, u.s FROM unnest($1::uuid[], $2::text[], $3::text[]) AS u(c, t, s)`,
      [batch.map((r) => r[0]), batch.map((r) => r[1]), batch.map((r) => r[2])],
    ),
  );

  // ---- Patients ----
  const patientIds = new Map<string, string>();
  for (const p of plan.patients) patientIds.set(p.sourceId, p.existingId ?? randomUUID());
  const newPatients = plan.patients.filter((p) => !p.existingId);
  await inBatches(newPatients, (batch) =>
    db.query(
      `INSERT INTO patients (id, client_id, location_id, name, species, breed, sex, neutered, date_of_birth, weight_kg,
                             color_markings, microchip_number, status, deceased_date, medical_alerts, active_prescriptions,
                             last_wellness_exam_at, last_dental_at, last_surgery_at, referring_clinic)
       SELECT u.id, u.client_id, $1, u.name, u.species, u.breed, u.sex, u.neutered, u.dob, u.weight, u.color, u.chip,
              u.status, u.deceased, u.alerts, u.rx, u.exam, u.dental, u.surgery, u.referring
       FROM unnest($2::uuid[], $3::uuid[], $4::text[], $5::text[], $6::text[], $7::text[], $8::bool[], $9::date[],
                   $10::numeric[], $11::text[], $12::text[], $13::text[], $14::date[], $15::text[], $16::bool[],
                   $17::date[], $18::date[], $19::date[], $20::text[])
         AS u(id, client_id, name, species, breed, sex, neutered, dob, weight, color, chip, status, deceased, alerts, rx,
              exam, dental, surgery, referring)`,
      [
        locationId,
        batch.map((p) => patientIds.get(p.sourceId)),
        batch.map((p) => clientIds.get(p.clientSourceId)),
        batch.map((p) => p.patient.name),
        batch.map((p) => p.patient.species),
        batch.map((p) => p.patient.breed),
        batch.map((p) => p.patient.sex),
        batch.map((p) => p.patient.neutered),
        batch.map((p) => p.patient.dateOfBirth),
        batch.map((p) => p.patient.weightKg),
        batch.map((p) => p.patient.colorMarkings),
        batch.map((p) => p.patient.microchipNumber),
        batch.map((p) => p.status),
        batch.map((p) => p.deceasedDate),
        batch.map((p) => p.patient.medicalAlerts),
        batch.map((p) => p.activePrescriptions),
        batch.map((p) => p.lastWellnessExamAt),
        batch.map((p) => p.lastDentalAt),
        batch.map((p) => p.lastSurgeryAt),
        batch.map((p) => p.referringClinic),
      ],
    ),
  );
  await inBatches(newPatients, (batch) =>
    db.query(`INSERT INTO patient_contacts (patient_id, client_id, receives_reminders) SELECT u.p, u.c, true FROM unnest($1::uuid[], $2::uuid[]) AS u(p, c)`, [
      batch.map((p) => patientIds.get(p.sourceId)),
      batch.map((p) => clientIds.get(p.clientSourceId)),
    ]),
  );
  const temperRows = newPatients.flatMap((p) => p.patient.temperamentFlags.map((f) => [patientIds.get(p.sourceId)!, f] as const));
  await inBatches(temperRows, (batch) =>
    db.query(`INSERT INTO patient_temperament_flags (patient_id, flag) SELECT * FROM unnest($1::uuid[], $2::text[]) ON CONFLICT DO NOTHING`, [
      batch.map((r) => r[0]),
      batch.map((r) => r[1]),
    ]),
  );

  // ---- Vaccines ----
  let vaccinesCreated = 0;
  await inBatches(plan.vaccines, async (batch) => {
    const r = await db.query<{ id: string }>(
      `INSERT INTO vaccine_records (patient_id, vaccine_id, administered_at, due_at, interval_months, administered_by)
       SELECT * FROM unnest($1::uuid[], $2::text[], $3::date[], $4::date[], $5::smallint[], $6::text[])
       ON CONFLICT DO NOTHING RETURNING id`,
      [
        batch.map((v) => patientIds.get(v.patientSourceId)),
        batch.map((v) => v.vaccineId),
        batch.map((v) => v.administeredAt),
        batch.map((v) => v.dueAt),
        batch.map((v) => v.intervalMonths),
        batch.map((v) => v.administeredBy),
      ],
    );
    vaccinesCreated += r.rows.length;
  });

  // ---- Every source row, with its outcome ----
  const sourceRows = { clients: input.source.clients, patients: input.source.patients, vaccines: input.source.vaccines };
  const traced = plan.rows.map((r, i) => {
    const entityId =
      r.outcome === "error" || r.outcome === "skip"
        ? undefined
        : r.file === "clients"
          ? clientIds.get(r.sourceId)
          : r.file === "patients"
            ? patientIds.get(r.sourceId)
            : undefined;
    return {
      rowNumber: i + 1,
      raw: { source_file: r.file, source_row: r.rowNumber, source_id: r.sourceId, entity_id: entityId ?? null, data: sourceRows[r.file][r.rowNumber - 2] ?? {} },
      status: r.outcome === "error" ? "failed" : r.outcome === "skip" ? "skipped" : "imported",
      error: r.message ?? null,
    };
  });
  await inBatches(traced, (batch) =>
    db.query(
      `INSERT INTO import_rows (import_job_id, row_number, raw_row, status, error)
       SELECT $1, u.n, u.raw, u.status, u.error FROM unnest($2::int[], $3::jsonb[], $4::text[], $5::text[]) AS u(n, raw, status, error)`,
      [jobId, batch.map((r) => r.rowNumber), batch.map((r) => JSON.stringify(r.raw)), batch.map((r) => r.status), batch.map((r) => r.error)],
    ),
  );

  // Pets with a wellness exam or a vaccine falling due in the next 30 days:
  // the first win the clinic sees. Same definition as the sample clinic seed.
  const due = await db.query<{ n: number }>(
    `SELECT count(DISTINCT p.id)::int AS n FROM patients p
     LEFT JOIN vaccine_records v ON v.patient_id = p.id
     WHERE p.id = ANY($1::uuid[]) AND p.status = 'active' AND (
       (p.last_wellness_exam_at + 365) BETWEEN $2::date AND $2::date + 30
       OR v.due_at BETWEEN $2::date AND $2::date + 30)`,
    [newPatients.map((p) => patientIds.get(p.sourceId)), input.today],
  );
  const result: ImportResult = {
    jobId,
    clientsCreated: newClients.length,
    clientsMatched: plan.clients.length - newClients.length,
    petsCreated: newPatients.length,
    vaccinesCreated,
    petsDue30d: due.rows[0]?.n ?? 0,
    rowsFailed: plan.summary.errors,
  };
  await db.query(`UPDATE import_jobs SET status = 'completed', clients_created = $2, pets_created = $3, pets_due_30d = $4 WHERE id = $1`, [
    jobId,
    result.clientsCreated,
    result.petsCreated,
    result.petsDue30d,
  ]);
  await writeAudit(db, {
    locationId,
    actor,
    action: "import.completed",
    entityType: "import_job",
    entityId: jobId,
    changes: { ...result, jobId: undefined },
  });
  return result;
}
