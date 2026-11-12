// Booking against real doctors, rooms and equipment. Reads what the
// scheduling rules need, and books, cancels and reschedules safely:
// every booking re-checks its slot inside the transaction while holding a
// per-location lock, and the database's exclusion constraints are the last
// line of defence against double-booking.
import {
  checkEligibility,
  ConflictError,
  findSlots,
  localParts,
  NotFoundError,
  RuleViolationError,
  timeToMinutes,
  type ClinicCalendar,
  type EquipmentUnit,
  type Hold,
  type PatientForBooking,
  type ProviderInfo,
  type ProviderRole,
  type RoomInfo,
  type RoomType,
  type SchedulingData,
  type ServiceRules,
  type Slot,
  type Species,
  type TemperamentFlag,
} from "@vetrix/domain";
import { getVeterinaryPack } from "@vetrix/pack";
import { writeAudit, type Actor } from "./clients";
import type { SqlClient } from "./sql-client";

const DAY_MS = 86_400_000;

// ---------- Reading ----------

export interface ServiceSummary {
  id: string;
  pack_service_id: string;
  name: string;
  category: string;
  duration_min: number;
  provider_role: string | null;
  species: Species[];
  drop_off: boolean;
}

export async function listServices(db: SqlClient, locationId: string): Promise<ServiceSummary[]> {
  const { rows } = await db.query<ServiceSummary>(
    `SELECT s.id, s.pack_service_id, s.name, s.category, s.duration_min, s.provider_role, s.drop_off,
            coalesce((SELECT array_agg(ss.species ORDER BY ss.species) FROM service_species ss WHERE ss.service_id = s.id), '{}') AS species
     FROM services s WHERE s.location_id = $1 AND s.active AND s.duration_min > 0
     ORDER BY s.category, s.name`,
    [locationId],
  );
  return rows;
}

/** Pack rules that are not stored per clinic (e.g. which other roles may do a service). */
function packService(packServiceId: string) {
  return getVeterinaryPack().services.services.find((s) => s.id === packServiceId) as
    | { also_bookable_by_roles?: ProviderRole[] }
    | undefined;
}

export async function loadService(db: SqlClient, locationId: string, serviceId: string): Promise<ServiceRules> {
  const { rows } = await db.query<{
    id: string; pack_service_id: string; name: string; duration_min: number; buffer_before_min: number; buffer_after_min: number;
    provider_role: ProviderRole | null; room_type: RoomType | null; requires_doctor_on_premises: boolean; drop_off: boolean;
    drop_off_window: string | null; prerequisites: Record<string, unknown>; active: boolean;
    species: Species[]; skills: string[]; equipment: { type: string; quantity: number }[];
  }>(
    `SELECT s.*,
            coalesce((SELECT array_agg(species) FROM service_species WHERE service_id = s.id), '{}') AS species,
            coalesce((SELECT array_agg(skill_id) FROM service_skills WHERE service_id = s.id), '{}') AS skills,
            coalesce((SELECT json_agg(json_build_object('type', equipment_type, 'quantity', quantity)) FROM service_equipment WHERE service_id = s.id), '[]') AS equipment
     FROM services s WHERE s.id = $1 AND s.location_id = $2`,
    [serviceId, locationId],
  );
  const s = rows[0];
  if (!s) throw new NotFoundError("Service", serviceId);
  return {
    id: s.id,
    packServiceId: s.pack_service_id,
    name: s.name,
    durationMin: s.duration_min,
    bufferBeforeMin: s.buffer_before_min,
    bufferAfterMin: s.buffer_after_min,
    providerRole: s.provider_role,
    alsoRoles: packService(s.pack_service_id)?.also_bookable_by_roles ?? [],
    roomType: s.room_type,
    equipment: s.equipment,
    skills: s.skills,
    species: s.species,
    requiresDoctorOnPremises: s.requires_doctor_on_premises,
    dropOff: s.drop_off,
    dropOffWindow: s.drop_off_window,
    prerequisites: s.prerequisites ?? {},
    active: s.active,
  };
}

export async function loadPatientForBooking(
  db: SqlClient,
  locationId: string,
  patientId: string,
): Promise<PatientForBooking & { id: string; name: string; clientId: string; status: string }> {
  const { rows } = await db.query<{
    id: string; name: string; client_id: string; status: string; species: Species; sex: "male" | "female" | null; neutered: boolean | null;
    date_of_birth: string | null; approx_age_months: number | null; active_prescriptions: boolean; flags: TemperamentFlag[];
  }>(
    `SELECT p.id, p.name, p.client_id, p.status, p.species, p.sex, p.neutered, to_char(p.date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
            p.approx_age_months, p.active_prescriptions,
            coalesce((SELECT array_agg(flag) FROM patient_temperament_flags WHERE patient_id = p.id), '{}') AS flags
     FROM patients p WHERE p.id = $1 AND p.location_id = $2`,
    [patientId, locationId],
  );
  const p = rows[0];
  if (!p) throw new NotFoundError("Patient", patientId);
  return {
    id: p.id, name: p.name, clientId: p.client_id, status: p.status, species: p.species, sex: p.sex, neutered: p.neutered,
    dateOfBirth: p.date_of_birth, approxAgeMonths: p.approx_age_months, activePrescriptions: p.active_prescriptions,
    temperamentFlags: p.flags,
  };
}

/** Everything findSlots needs for a location over a range of days. */
export async function loadSchedulingData(db: SqlClient, locationId: string, fromDate: string, days: number): Promise<SchedulingData> {
  const loc = await db.query<{ timezone: string }>(`SELECT timezone FROM locations WHERE id = $1`, [locationId]);
  const timezone = loc.rows[0]?.timezone;
  if (!timezone) throw new NotFoundError("Location", locationId);
  // Wide instant window around the dates; exact days are handled in clinic time by findSlots.
  const [y, m, d] = fromDate.split("-").map(Number) as [number, number, number];
  const rangeStart = new Date(Date.UTC(y, m - 1, d) - DAY_MS);
  const rangeEnd = new Date(Date.UTC(y, m - 1, d) + (days + 1) * DAY_MS);
  const rules = getVeterinaryPack().resources.scheduling_rules as { slot_granularity_min?: number; temperament_buffer_min?: number };

  const [hours, holidays, providers, schedules, blocked, rooms, equipment, holds] = await Promise.all([
    db.query<{ weekday: number; opens: string; closes: string }>(
      `SELECT weekday, min(to_char(opens_at, 'HH24:MI')) AS opens, max(to_char(closes_at, 'HH24:MI')) AS closes
       FROM location_hours WHERE location_id = $1 GROUP BY weekday`,
      [locationId],
    ),
    db.query<{ d: string }>(`SELECT to_char(holiday_date, 'YYYY-MM-DD') AS d FROM location_holidays WHERE location_id = $1`, [locationId]),
    db.query<{ id: string; display_name: string; role: ProviderRole; bookable: boolean; max_concurrent: number; skills: string[] }>(
      `SELECT p.id, p.display_name, p.role, p.bookable, p.max_concurrent,
              coalesce((SELECT array_agg(skill_id) FROM provider_skills WHERE provider_id = p.id), '{}') AS skills
       FROM providers p WHERE p.location_id = $1 ORDER BY p.display_name`,
      [locationId],
    ),
    db.query<{ provider_id: string; weekday: number; starts: string; ends: string }>(
      `SELECT ps.provider_id, ps.weekday, to_char(ps.starts_at, 'HH24:MI') AS starts, to_char(ps.ends_at, 'HH24:MI') AS ends
       FROM provider_schedules ps JOIN providers p ON p.id = ps.provider_id WHERE p.location_id = $1`,
      [locationId],
    ),
    db.query<{ provider_id: string; s: Date; e: Date }>(
      `SELECT x.provider_id, lower(x.blocked_range) AS s, upper(x.blocked_range) AS e
       FROM provider_schedule_exceptions x JOIN providers p ON p.id = x.provider_id
       WHERE p.location_id = $1 AND x.blocked_range && tstzrange($2, $3)`,
      [locationId, rangeStart, rangeEnd],
    ),
    db.query<RoomInfo>(`SELECT id, name, type, capacity FROM rooms WHERE location_id = $1 ORDER BY name`, [locationId]),
    db.query<EquipmentUnit>(`SELECT id, type, exclusive FROM equipment WHERE location_id = $1 ORDER BY name`, [locationId]),
    db.query<{ provider_id: string | null; room_id: string | null; equipment_id: string | null; s: Date; e: Date }>(
      `SELECT provider_id, room_id, equipment_id, lower(held_range) AS s, upper(held_range) AS e
       FROM appointment_resources WHERE location_id = $1 AND active AND held_range && tstzrange($2, $3)`,
      [locationId, rangeStart, rangeEnd],
    ),
  ]);

  const calendar: ClinicCalendar = {
    timezone,
    hours: new Map(hours.rows.map((h) => [h.weekday, { open: timeToMinutes(h.opens), close: timeToMinutes(h.closes) }])),
    holidays: new Set(holidays.rows.map((h) => h.d)),
    slotMinutes: rules.slot_granularity_min ?? 15,
    temperamentBufferMin: rules.temperament_buffer_min ?? 15,
  };
  const providerInfo: ProviderInfo[] = providers.rows.map((p) => {
    const schedule = new Map<number, { start: number; end: number }[]>();
    for (const s of schedules.rows.filter((x) => x.provider_id === p.id)) {
      schedule.set(s.weekday, [...(schedule.get(s.weekday) ?? []), { start: timeToMinutes(s.starts), end: timeToMinutes(s.ends) }]);
    }
    return {
      id: p.id,
      name: p.display_name,
      role: p.role,
      bookable: p.bookable,
      maxConcurrent: p.max_concurrent,
      skills: p.skills,
      schedule,
      blocked: blocked.rows.filter((b) => b.provider_id === p.id).map((b) => ({ start: b.s.getTime(), end: b.e.getTime() })),
    };
  });
  const holdList: Hold[] = holds.rows.map((h) => ({
    providerId: h.provider_id,
    roomId: h.room_id,
    equipmentId: h.equipment_id,
    start: h.s.getTime(),
    end: h.e.getTime(),
  }));
  return { calendar, providers: providerInfo, rooms: rooms.rows, equipment: equipment.rows, holds: holdList };
}

// ---------- Booking ----------

export type BookedBy = "ai" | "staff" | "web" | "client";

export interface BookInput {
  locationId: string;
  patientId: string;
  serviceId: string;
  /** The exact start the person chose (from findSlots). */
  start: number;
  /** Keep the provider they chose; otherwise any eligible provider free then. */
  providerId?: string | null;
  bookedBy: BookedBy;
  actor: Actor;
  reasonText?: string | null;
  triageLevel?: "routine" | "urgent" | "emergency";
  notesForStaff?: string | null;
  /** Clinic date, YYYY-MM-DD, for eligibility (age). */
  today: string;
  /** For bookedBy 'ai' clinical warnings block too. */
  strict?: boolean;
}

export interface BookResult {
  appointmentId: string;
  slot: Slot;
  warnings: string[];
  remindersPaused: number;
}

function isExclusionViolation(error: unknown): boolean {
  return (error as { code?: string })?.code === "23P01";
}

/** Serialises bookings per location so shared-capacity checks cannot race. Call inside a transaction. */
async function lockLocation(db: SqlClient, locationId: string) {
  await db.query(`SELECT pg_advisory_xact_lock(hashtext('booking:' || $1))`, [locationId]);
}

export async function bookAppointment(db: SqlClient, input: BookInput): Promise<BookResult> {
  await lockLocation(db, input.locationId);
  const [service, patient] = await Promise.all([
    loadService(db, input.locationId, input.serviceId),
    loadPatientForBooking(db, input.locationId, input.patientId),
  ]);
  if (patient.status !== "active") throw new RuleViolationError("patient.not_active", `${patient.name} is not an active patient.`);
  const eligibility = checkEligibility(service, patient, input.today);
  const blocking = input.strict ? [...eligibility.blocking, ...eligibility.warnings] : eligibility.blocking;
  if (blocking.length > 0) throw new RuleViolationError(blocking[0]!.ruleId, blocking[0]!.message);

  const loc = await db.query<{ timezone: string }>(`SELECT timezone FROM locations WHERE id = $1`, [input.locationId]);
  const date = localParts(input.start, loc.rows[0]!.timezone).date;
  const data = await loadSchedulingData(db, input.locationId, date, 1);
  const slot = findSlots(data, {
    service,
    patient,
    dates: [date],
    notBefore: 0,
    providerId: input.providerId ?? undefined,
    limit: 1000,
  }).find((s) => s.start === input.start);
  if (!slot) throw new ConflictError("That time is no longer free. Please choose another.");

  const provider = data.providers.find((p) => p.id === slot.providerId)!;
  const room = data.rooms.find((r) => r.id === slot.roomId);
  let appointmentId: string;
  try {
    appointmentId = (
      await db.query<{ id: string }>(
        `INSERT INTO appointments (location_id, patient_id, client_id, service_id, provider_id, room_id, start_at, end_at, status,
                                   booked_by, reason_text, triage_level, drop_off, notes_for_staff)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'requested', $9, $10, $11, $12, $13) RETURNING id`,
        [input.locationId, patient.id, patient.clientId, service.id, slot.providerId, slot.roomId, new Date(slot.start), new Date(slot.end),
         input.bookedBy, input.reasonText ?? null, input.triageLevel ?? "routine", service.dropOff, input.notesForStaff ?? null],
      )
    ).rows[0]!.id;
    const held = `[${new Date(slot.holdStart).toISOString()},${new Date(slot.holdEnd).toISOString()})`;
    const resources: [string | null, string | null, string | null, boolean][] = [
      [slot.providerId, null, null, provider.maxConcurrent <= 1],
      ...(slot.roomId ? [[null, slot.roomId, null, (room?.capacity ?? 1) <= 1] as [null, string, null, boolean]] : []),
      ...slot.equipmentIds.map((id) => [null, null, id, data.equipment.find((e) => e.id === id)?.exclusive ?? true] as [null, null, string, boolean]),
    ];
    await db.query(
      `INSERT INTO appointment_resources (appointment_id, location_id, provider_id, room_id, equipment_id, held_range, is_exclusive)
       SELECT $1, $2, u.p, u.r, u.e, $3::tstzrange, u.x FROM unnest($4::uuid[], $5::uuid[], $6::uuid[], $7::bool[]) AS u(p, r, e, x)`,
      [appointmentId, input.locationId, held, resources.map((r) => r[0]), resources.map((r) => r[1]), resources.map((r) => r[2]), resources.map((r) => r[3])],
    );
  } catch (error) {
    if (isExclusionViolation(error)) throw new ConflictError("That time was just taken. Please choose another.");
    throw error;
  }
  await db.query(
    `INSERT INTO appointment_status_history (appointment_id, from_status, to_status, actor_type) VALUES ($1, NULL, 'requested', $2)`,
    [appointmentId, input.actor.type],
  );

  // Pack v0.2: booking euthanasia pauses that pet's reminders.
  let remindersPaused = 0;
  if (service.packServiceId === "euthanasia") {
    const stopped = await db.query(
      `UPDATE reminders SET status = 'stopped', stopped_at = now(), stop_reason = 'euthanasia_booked'
       WHERE patient_id = $1 AND status = 'open' RETURNING id`,
      [patient.id],
    );
    await db.query(
      `UPDATE reminder_touches t SET status = 'cancelled', suppression_reason = 'euthanasia_booked'
       FROM reminders r WHERE r.id = t.reminder_id AND r.patient_id = $1 AND t.status = 'scheduled'`,
      [patient.id],
    );
    remindersPaused = stopped.rows.length;
  }

  await writeAudit(db, {
    locationId: input.locationId,
    actor: input.actor,
    action: "appointment.booked",
    entityType: "appointment",
    entityId: appointmentId,
    changes: { service: service.packServiceId, start: new Date(slot.start).toISOString(), providerId: slot.providerId, roomId: slot.roomId, bookedBy: input.bookedBy, remindersPaused },
  });
  return { appointmentId, slot, warnings: eligibility.warnings.map((w) => w.message), remindersPaused };
}

const OPEN_STATUSES = ["requested", "confirmed"];

async function loadAppointment(db: SqlClient, locationId: string, appointmentId: string) {
  const { rows } = await db.query<{ id: string; status: string; patient_id: string; service_id: string; provider_id: string | null; start_at: Date }>(
    `SELECT id, status, patient_id, service_id, provider_id, start_at FROM appointments WHERE id = $1 AND location_id = $2 FOR UPDATE`,
    [appointmentId, locationId],
  );
  if (!rows[0]) throw new NotFoundError("Appointment", appointmentId);
  return rows[0];
}

export async function cancelAppointment(
  db: SqlClient,
  input: { locationId: string; appointmentId: string; reason: string; actor: Actor; lateCancel?: boolean },
): Promise<void> {
  const appt = await loadAppointment(db, input.locationId, input.appointmentId);
  if (!OPEN_STATUSES.includes(appt.status)) {
    throw new RuleViolationError("appointment.not_open", `This visit is already ${appt.status.replace("_", " ")} and cannot be cancelled.`);
  }
  await db.query(
    `UPDATE appointments SET status = 'cancelled', cancellation_reason = $2, late_cancel = $3 WHERE id = $1`,
    [appt.id, input.reason, input.lateCancel ?? false],
  );
  await db.query(`UPDATE appointment_resources SET active = false WHERE appointment_id = $1`, [appt.id]);
  await db.query(
    `INSERT INTO appointment_status_history (appointment_id, from_status, to_status, actor_type) VALUES ($1, $2, 'cancelled', $3)`,
    [appt.id, appt.status, input.actor.type],
  );
  await writeAudit(db, {
    locationId: input.locationId,
    actor: input.actor,
    action: "appointment.cancelled",
    entityType: "appointment",
    entityId: appt.id,
    changes: { reason: input.reason },
  });
}

/** Moves a visit: frees its old resources, books the new time, and cancels the old one, all in the same transaction. */
export async function rescheduleAppointment(
  db: SqlClient,
  input: { locationId: string; appointmentId: string; start: number; providerId?: string | null; actor: Actor; today: string },
): Promise<BookResult> {
  const appt = await loadAppointment(db, input.locationId, input.appointmentId);
  if (!OPEN_STATUSES.includes(appt.status)) {
    throw new RuleViolationError("appointment.not_open", `This visit is already ${appt.status.replace("_", " ")} and cannot be moved.`);
  }
  const details = await db.query<{ booked_by: BookedBy; reason_text: string | null; triage_level: "routine" | "urgent" | "emergency"; notes_for_staff: string | null }>(
    `SELECT booked_by, reason_text, triage_level, notes_for_staff FROM appointments WHERE id = $1`,
    [appt.id],
  );
  const d = details.rows[0]!;
  await db.query(`UPDATE appointment_resources SET active = false WHERE appointment_id = $1`, [appt.id]);
  const booked = await bookAppointment(db, {
    locationId: input.locationId,
    patientId: appt.patient_id,
    serviceId: appt.service_id,
    start: input.start,
    providerId: input.providerId,
    bookedBy: d.booked_by,
    actor: input.actor,
    reasonText: d.reason_text,
    triageLevel: d.triage_level,
    notesForStaff: d.notes_for_staff,
    today: input.today,
  });
  await db.query(`UPDATE appointments SET status = 'cancelled', cancellation_reason = 'Rescheduled' WHERE id = $1`, [appt.id]);
  await db.query(
    `INSERT INTO appointment_status_history (appointment_id, from_status, to_status, actor_type) VALUES ($1, $2, 'cancelled', $3)`,
    [appt.id, appt.status, input.actor.type],
  );
  await writeAudit(db, {
    locationId: input.locationId,
    actor: input.actor,
    action: "appointment.rescheduled",
    entityType: "appointment",
    entityId: appt.id,
    changes: { newAppointmentId: booked.appointmentId, from: appt.start_at.toISOString(), to: new Date(booked.slot.start).toISOString() },
  });
  return booked;
}

// ---------- Calendar ----------

export interface CalendarAppointment {
  id: string;
  start_at: Date;
  end_at: Date;
  status: string;
  triage_level: "routine" | "urgent" | "emergency";
  booked_by: BookedBy;
  patient_id: string;
  patient_name: string;
  species: Species;
  client_id: string;
  client_name: string;
  service_name: string;
  category: string;
  provider_id: string | null;
  provider_name: string | null;
  room_id: string | null;
  room_name: string | null;
  room_type: RoomType | null;
}

/** Visits that start on a clinic date (cancelled ones excluded). */
export async function listAppointmentsForDay(db: SqlClient, locationId: string, date: string): Promise<CalendarAppointment[]> {
  const { rows } = await db.query<CalendarAppointment>(
    `WITH l AS (SELECT timezone FROM locations WHERE id = $1)
     SELECT a.id, a.start_at, a.end_at, a.status, a.triage_level, a.booked_by,
            p.id AS patient_id, p.name AS patient_name, p.species,
            c.id AS client_id, c.first_name || ' ' || c.last_name AS client_name,
            s.name AS service_name, s.category,
            pr.id AS provider_id, pr.display_name AS provider_name, r.id AS room_id, r.name AS room_name, r.type AS room_type
     FROM l
     JOIN appointments a ON a.location_id = $1
       AND a.start_at >= ($2::date::timestamp AT TIME ZONE l.timezone)
       AND a.start_at < (($2::date + 1)::timestamp AT TIME ZONE l.timezone)
     JOIN patients p ON p.id = a.patient_id
     JOIN clients c ON c.id = a.client_id
     JOIN services s ON s.id = a.service_id
     LEFT JOIN providers pr ON pr.id = a.provider_id
     LEFT JOIN rooms r ON r.id = a.room_id
     WHERE a.status <> 'cancelled'
     ORDER BY a.start_at, pr.display_name`,
    [locationId, date],
  );
  return rows;
}
