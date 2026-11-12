// Booking against the sample clinic's real doctors, rooms and equipment,
// inside a transaction that is always rolled back. Skipped without the
// development database URL (CI).
import { describe, expect, it } from "vitest";
import { Pool } from "@neondatabase/serverless";
import { ConflictError, dateRange, findSlots, localParts } from "@vetrix/domain";
import {
  bookAppointment,
  cancelAppointment,
  listAppointmentsForDay,
  loadPatientForBooking,
  loadSchedulingData,
  loadService,
  rescheduleAppointment,
} from "./booking";
import type { SqlClient } from "./sql-client";

const url = process.env.CLINIC_DATABASE_URL_DEV;
const actor = { type: "staff" as const, id: null };

async function withRollback(fn: (db: SqlClient, loc: { id: string; timezone: string }) => Promise<void>) {
  const pool = new Pool({ connectionString: url, max: 1 });
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const loc = (await db.query<{ id: string; timezone: string }>(`SELECT id, timezone FROM locations ORDER BY name LIMIT 1`)).rows[0]!;
    await fn(db, loc);
  } finally {
    await db.query("ROLLBACK");
    db.release();
    await pool.end();
  }
}

async function ids(db: SqlClient, loc: string) {
  const one = async (sql: string, params: unknown[] = []) => (await db.query<{ id: string }>(sql, params)).rows[0]!.id;
  return {
    wellness: await one(`SELECT id FROM services WHERE location_id = $1 AND pack_service_id = 'wellness_exam'`, [loc]),
    euthanasia: await one(`SELECT id FROM services WHERE location_id = $1 AND pack_service_id = 'euthanasia'`, [loc]),
    dogs: (await db.query<{ id: string }>(`SELECT id FROM patients WHERE location_id = $1 AND species = 'dog' AND status = 'active' ORDER BY name LIMIT 3`, [loc])).rows.map((r) => r.id),
  };
}

/** First slots over the next two weeks, starting tomorrow in clinic time. */
async function slotsFor(db: SqlClient, loc: { id: string; timezone: string }, serviceId: string, patientId: string, providerId?: string) {
  const tomorrow = dateRange(localParts(Date.now(), loc.timezone).date, 2)[1]!;
  const data = await loadSchedulingData(db, loc.id, tomorrow, 14);
  const service = await loadService(db, loc.id, serviceId);
  const patient = await loadPatientForBooking(db, loc.id, patientId);
  return { today: localParts(Date.now(), loc.timezone).date, slots: findSlots(data, { service, patient, dates: dateRange(tomorrow, 14), notBefore: Date.now(), providerId, limit: 20 }) };
}

describe.skipIf(!url)("booking on the clinic database", () => {
  it("finds slots and books one with its doctor, room and hold", () =>
    withRollback(async (db, loc) => {
      const { wellness, dogs } = await ids(db, loc.id);
      const { slots, today } = await slotsFor(db, loc, wellness, dogs[0]!);
      expect(slots.length).toBeGreaterThan(0);
      const slot = slots[0]!;
      expect(slot.roomId).not.toBeNull();
      const booked = await bookAppointment(db, { locationId: loc.id, patientId: dogs[0]!, serviceId: wellness, start: slot.start, bookedBy: "staff", actor, today });
      const day = localParts(slot.start, loc.timezone).date;
      const list = await listAppointmentsForDay(db, loc.id, day);
      expect(list.map((a) => a.id)).toContain(booked.appointmentId);
      const resources = await db.query(`SELECT * FROM appointment_resources WHERE appointment_id = $1`, [booked.appointmentId]);
      expect(resources.rows).toHaveLength(2); // doctor and room
    }), 120_000);

  it("never double-books the same doctor, and frees the time when cancelled", () =>
    withRollback(async (db, loc) => {
      const { wellness, dogs } = await ids(db, loc.id);
      const { slots, today } = await slotsFor(db, loc, wellness, dogs[0]!);
      const slot = slots[0]!;
      const first = await bookAppointment(db, {
        locationId: loc.id, patientId: dogs[0]!, serviceId: wellness, start: slot.start, providerId: slot.providerId, bookedBy: "staff", actor, today,
      });
      await expect(
        bookAppointment(db, { locationId: loc.id, patientId: dogs[1]!, serviceId: wellness, start: slot.start, providerId: slot.providerId, bookedBy: "staff", actor, today }),
      ).rejects.toBeInstanceOf(ConflictError);
      await cancelAppointment(db, { locationId: loc.id, appointmentId: first.appointmentId, reason: "Owner called", actor });
      const again = await bookAppointment(db, {
        locationId: loc.id, patientId: dogs[1]!, serviceId: wellness, start: slot.start, providerId: slot.providerId, bookedBy: "staff", actor, today,
      });
      expect(again.slot.providerId).toBe(slot.providerId);
    }), 120_000);

  it("reschedules to a new time and releases the old one", () =>
    withRollback(async (db, loc) => {
      const { wellness, dogs } = await ids(db, loc.id);
      const { slots, today } = await slotsFor(db, loc, wellness, dogs[0]!);
      const booked = await bookAppointment(db, { locationId: loc.id, patientId: dogs[0]!, serviceId: wellness, start: slots[0]!.start, bookedBy: "staff", actor, today });
      const moved = await rescheduleAppointment(db, { locationId: loc.id, appointmentId: booked.appointmentId, start: slots[4]!.start, actor, today });
      const old = await db.query<{ status: string }>(`SELECT status FROM appointments WHERE id = $1`, [booked.appointmentId]);
      expect(old.rows[0]!.status).toBe("cancelled");
      expect(moved.slot.start).toBe(slots[4]!.start);
      const active = await db.query(`SELECT 1 FROM appointment_resources WHERE appointment_id = $1 AND active`, [booked.appointmentId]);
      expect(active.rows).toHaveLength(0);
    }), 120_000);

  it("pauses a pet's reminders when euthanasia is booked (pack v0.2)", () =>
    withRollback(async (db, loc) => {
      const { euthanasia, dogs } = await ids(db, loc.id);
      const rule = await db.query<{ id: string }>(`SELECT id FROM reminder_rules WHERE location_id = $1 LIMIT 1`, [loc.id]);
      await db.query(`INSERT INTO reminders (rule_id, patient_id, due_at) VALUES ($1, $2, '2027-01-01')`, [rule.rows[0]!.id, dogs[2]!]);
      const { slots, today } = await slotsFor(db, loc, euthanasia, dogs[2]!);
      expect(slots.length).toBeGreaterThan(0);
      const booked = await bookAppointment(db, { locationId: loc.id, patientId: dogs[2]!, serviceId: euthanasia, start: slots[0]!.start, bookedBy: "staff", actor, today });
      expect(booked.remindersPaused).toBe(1);
      const r = await db.query<{ status: string; stop_reason: string }>(`SELECT status, stop_reason FROM reminders WHERE patient_id = $1`, [dogs[2]!]);
      expect(r.rows.every((x) => x.status === "stopped" && x.stop_reason === "euthanasia_booked")).toBe(true);
    }), 120_000);
});
