// Scheduled jobs and text replies on the sample clinic, rolled back.
import { describe, expect, it } from "vitest";
import { Pool } from "@neondatabase/serverless";
import { dateRange, findSlots, localParts, zonedInstant } from "@vetrix/domain";
import { bookAppointment, loadPatientForBooking, loadSchedulingData, loadService } from "./booking";
import { runDueJobs } from "./jobs";
import { handleClientReply } from "./replies";

const url = process.env.CLINIC_DATABASE_URL_DEV;
const values = { clinicName: "Main Veterinary Clinic", aiName: "Riley", clinicPhone: "(555) 010-1000", bookingLink: "reply to this text" };

describe.skipIf(!url)("scheduled jobs and replies", () => {
  it("fasting check at 7 PM, YES confirms, no task at 8 PM, C confirms, reminders once a day", async () => {
    const pool = new Pool({ connectionString: url, max: 1 });
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const loc = (await db.query<{ id: string; timezone: string }>(`SELECT id, timezone FROM locations ORDER BY name LIMIT 1`)).rows[0]!;
      // An intact female dog whose owner allows texts.
      const pet = (await db.query<{ id: string; client_id: string }>(
        `SELECT p.id, p.client_id FROM patients p JOIN clients c ON c.id = p.client_id
         WHERE p.location_id = $1 AND p.species = 'dog' AND p.sex = 'female' AND p.neutered = false AND p.status = 'active' AND c.sms_consent
           AND NOT EXISTS (SELECT 1 FROM client_flags f WHERE f.client_id = c.id) LIMIT 1`,
        [loc.id],
      )).rows[0]!;
      const spayId = (await db.query<{ id: string }>(`SELECT id FROM services WHERE location_id = $1 AND pack_service_id = 'spay_canine'`, [loc.id])).rows[0]!.id;
      const today = localParts(Date.now(), loc.timezone).date;
      const days = dateRange(today, 10).slice(1);
      const [service, patient, data] = await Promise.all([loadService(db, loc.id, spayId), loadPatientForBooking(db, loc.id, pet.id), loadSchedulingData(db, loc.id, days[0]!, 9)]);
      const slot = findSlots(data, { service, patient, dates: days, notBefore: Date.now(), limit: 1 })[0]!;
      const booked = await bookAppointment(db, { locationId: loc.id, patientId: pet.id, serviceId: spayId, start: slot.start, bookedBy: "staff", actor: { type: "staff", id: null }, today });
      const procedureDay = localParts(slot.start, loc.timezone).date;
      const dayBefore = new Date(Date.parse(`${procedureDay}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

      const at7 = await runDueJobs(db, { locationId: loc.id, now: zonedInstant(dayBefore, "19:05", loc.timezone), sandbox: true, values });
      expect(at7.ran).toContain("fasting_check");
      expect(at7.fastingChecks).toBeGreaterThanOrEqual(1);
      const msg = (await db.query<{ body: string; template_key: string }>(`SELECT body, template_key FROM messages WHERE appointment_id = $1`, [booked.appointmentId])).rows[0]!;
      expect(msg.template_key).toBe("fasting_check_evening");
      expect(msg.body).toContain("No food after midnight");

      const yes = await handleClientReply(db, { locationId: loc.id, clientId: pet.client_id, text: "YES", values: { clinicName: "C", clinicPhone: "1", timezone: loc.timezone } });
      expect(yes).toMatchObject({ handled: true, intent: "fasting_confirmed" });
      const appt = (await db.query<{ fasting_confirmed: boolean }>(`SELECT fasting_confirmed FROM appointments WHERE id = $1`, [booked.appointmentId])).rows[0]!;
      expect(appt.fasting_confirmed).toBe(true);

      const at8 = await runDueJobs(db, { locationId: loc.id, now: zonedInstant(dayBefore, "20:10", loc.timezone), sandbox: true, values });
      expect(at8.ran).toContain("fasting_no_reply");
      const tasks = await db.query(`SELECT 1 FROM staff_tasks WHERE patient_id = $1 AND type = 'fasting_unverified'`, [pet.id]);
      expect(tasks.rows).toHaveLength(0);

      const c = await handleClientReply(db, { locationId: loc.id, clientId: pet.client_id, text: "C", values: { clinicName: "C", clinicPhone: "1", timezone: loc.timezone } });
      expect(c).toMatchObject({ handled: true, intent: "confirm" });
      expect((await db.query<{ status: string }>(`SELECT status FROM appointments WHERE id = $1`, [booked.appointmentId])).rows[0]!.status).toBe("confirmed");

      // A day with no other run yet: the morning reminder run happens once.
      const morning = zonedInstant(dateRange(today, 20)[15]!, "09:00", loc.timezone);
      expect((await runDueJobs(db, { locationId: loc.id, now: morning, sandbox: true, values })).ran).toContain("reminders");
      expect((await runDueJobs(db, { locationId: loc.id, now: morning + 60_000, sandbox: true, values })).ran).not.toContain("reminders");
    } finally {
      await db.query("ROLLBACK");
      db.release();
      await pool.end();
    }
  }, 300_000);
});
