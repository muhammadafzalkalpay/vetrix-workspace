// The waitlist (W7) on the sample clinic, inside a transaction that is rolled back.
import { describe, expect, it } from "vitest";
import { Pool } from "@neondatabase/serverless";
import { dateRange, findSlots, localParts } from "@vetrix/domain";
import { bookAppointment, cancelAppointment, loadPatientForBooking, loadSchedulingData, loadService } from "./booking";
import { handleClientReply } from "./replies";
import { addToWaitlist, claimOffer, offerFreedSlot, waitlistFollowUps } from "./waitlist";

const url = process.env.CLINIC_DATABASE_URL_DEV;
const actor = { type: "staff" as const, id: null };

describe.skipIf(!url)("waitlist on the clinic database", () => {
  it("offers a cancelled time to three, first claim wins, then calls the next two", async () => {
    const pool = new Pool({ connectionString: url, max: 1 });
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const loc = (await db.query<{ id: string; timezone: string }>(`SELECT id, timezone FROM locations ORDER BY name LIMIT 1`)).rows[0]!;
      const values = { clinicName: "Main Veterinary Clinic", aiName: "Riley", timezone: loc.timezone, claimBase: "https://app.test/claim/org" };
      const nail = (await db.query<{ id: string }>(`SELECT id FROM services WHERE location_id = $1 AND pack_service_id = 'nail_trim'`, [loc.id])).rows[0]!.id;
      // Dogs whose owners allow texts and have no flags.
      const dogs = (await db.query<{ id: string; client_id: string }>(
        `SELECT p.id, p.client_id FROM patients p JOIN clients c ON c.id = p.client_id
         WHERE p.location_id = $1 AND p.species = 'dog' AND p.status = 'active' AND c.sms_consent
           AND NOT EXISTS (SELECT 1 FROM client_flags f WHERE f.client_id = c.id) ORDER BY p.name LIMIT 7`,
        [loc.id],
      )).rows;
      const today = localParts(Date.now(), loc.timezone).date;
      const days = dateRange(today, 3).slice(1);
      const [service, first, data] = await Promise.all([loadService(db, loc.id, nail), loadPatientForBooking(db, loc.id, dogs[0]!.id), loadSchedulingData(db, loc.id, days[0]!, 2)]);
      const slot = findSlots(data, { service, patient: first, dates: days, notBefore: Date.now() + 3_600_000, limit: 1 })[0]!;
      const visit = await bookAppointment(db, { locationId: loc.id, patientId: dogs[0]!.id, serviceId: nail, start: slot.start, providerId: slot.providerId, bookedBy: "staff", actor, today });
      for (const d of dogs.slice(1)) await addToWaitlist(db, { locationId: loc.id, patientId: d.id, serviceId: nail, preferredProviderId: null, actor });

      await cancelAppointment(db, { locationId: loc.id, appointmentId: visit.appointmentId, reason: "Owner cancelled", actor });
      const now = Date.now();
      expect((await offerFreedSlot(db, { locationId: loc.id, appointmentId: visit.appointmentId, now, sandbox: true, values })).offers).toBe(3);
      const offers = (await db.query<{ claim_token: string; patient_id: string }>(
        `SELECT o.claim_token, w.patient_id FROM waitlist_offers o JOIN waitlist_entries w ON w.id = o.waitlist_entry_id WHERE o.source_appointment_id = $1 ORDER BY w.created_at`,
        [visit.appointmentId],
      )).rows;
      // Same transaction, same "added" time: which three is arbitrary here; in use it is oldest first.
      expect(offers).toHaveLength(3);
      expect(offers.every((o) => dogs.slice(1).some((d) => d.id === o.patient_id))).toBe(true);
      const offerText = (await db.query<{ body: string }>(`SELECT body FROM messages WHERE template_key = 'waitlist_offer' AND patient_id = $1`, [offers[0]!.patient_id])).rows[0]!.body;
      expect(offerText).toContain("https://app.test/claim/org/");

      const won = await claimOffer(db, { token: offers[1]!.claim_token, now, sandbox: true, clinicName: "C" });
      expect(won.status).toBe("claimed");
      expect((await claimOffer(db, { token: offers[0]!.claim_token, now, sandbox: true, clinicName: "C" })).status).toBe("taken");
      const taken = await db.query(`SELECT 1 FROM messages WHERE template_key = 'waitlist_taken'`);
      expect(taken.rows.length).toBe(2);

      // Cancel the claimed visit: offered again; nobody answers; the AI calls the next two.
      const claimedId = won.status === "claimed" ? won.appointmentId : "";
      await cancelAppointment(db, { locationId: loc.id, appointmentId: claimedId, reason: "Changed mind", actor });
      expect((await offerFreedSlot(db, { locationId: loc.id, appointmentId: claimedId, now, sandbox: true, values })).offers).toBe(3);
      const later = await waitlistFollowUps(db, { locationId: loc.id, now: now + 31 * 60_000, sandbox: true, values });
      expect(later.expired).toBe(3);
      expect(later.calls).toBe(2);

    } finally {
      await db.query("ROLLBACK");
      db.release();
      await pool.end();
    }
  }, 300_000);

  it("YES to a waitlist offer text claims it", async () => {
    const pool = new Pool({ connectionString: url, max: 1 });
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const loc = (await db.query<{ id: string; timezone: string }>(`SELECT id, timezone FROM locations ORDER BY name LIMIT 1`)).rows[0]!;
      const nail = (await db.query<{ id: string }>(`SELECT id FROM services WHERE location_id = $1 AND pack_service_id = 'nail_trim'`, [loc.id])).rows[0]!.id;
      const dogs = (await db.query<{ id: string; client_id: string }>(
        `SELECT p.id, p.client_id FROM patients p JOIN clients c ON c.id = p.client_id WHERE p.location_id = $1 AND p.species = 'dog' AND p.status = 'active'
           AND c.sms_consent AND NOT EXISTS (SELECT 1 FROM client_flags f WHERE f.client_id = c.id) ORDER BY p.name DESC LIMIT 2`,
        [loc.id],
      )).rows;
      const today = localParts(Date.now(), loc.timezone).date;
      const days = dateRange(today, 3).slice(1);
      const [service, pet, data] = await Promise.all([loadService(db, loc.id, nail), loadPatientForBooking(db, loc.id, dogs[0]!.id), loadSchedulingData(db, loc.id, days[0]!, 2)]);
      const slot = findSlots(data, { service, patient: pet, dates: days, notBefore: Date.now() + 3_600_000, limit: 1 })[0]!;
      const visit = await bookAppointment(db, { locationId: loc.id, patientId: dogs[0]!.id, serviceId: nail, start: slot.start, providerId: slot.providerId, bookedBy: "staff", actor, today });
      await addToWaitlist(db, { locationId: loc.id, patientId: dogs[1]!.id, serviceId: nail, preferredProviderId: null, actor });
      await cancelAppointment(db, { locationId: loc.id, appointmentId: visit.appointmentId, reason: "x", actor });
      await offerFreedSlot(db, { locationId: loc.id, appointmentId: visit.appointmentId, now: Date.now(), sandbox: true, values: { clinicName: "C", aiName: "Riley", timezone: loc.timezone, claimBase: "https://x/claim/o" } });
      const r = await handleClientReply(db, { locationId: loc.id, clientId: dogs[1]!.client_id, text: "YES", values: { clinicName: "C", clinicPhone: "1", timezone: loc.timezone }, sandbox: true });
      expect(r).toMatchObject({ handled: true, intent: "waitlist_claim" });
      if (r.handled) expect(r.reply).toMatch(/You're booked/);
      const booked = await db.query(`SELECT 1 FROM appointments WHERE patient_id = $1 AND status = 'requested' AND booked_by = 'client'`, [dogs[1]!.id]);
      expect(booked.rows).toHaveLength(1);
    } finally {
      await db.query("ROLLBACK");
      db.release();
      await pool.end();
    }
  }, 300_000);
});
