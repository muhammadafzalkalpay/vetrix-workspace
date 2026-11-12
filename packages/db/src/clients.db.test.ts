// Runs against the development clinic database inside a transaction that is
// always rolled back, so nothing is saved. Skipped when the database URL is
// not set (CI).
import { describe, expect, it } from "vitest";
import { Pool } from "@neondatabase/serverless";
import { ConflictError, RuleViolationError, validateClient, validatePatient } from "@vetrix/domain";
import {
  createClient,
  createPatient,
  getClient,
  getPatient,
  markPatientDeceased,
  searchClients,
  searchPatients,
  updateClient,
  type Actor,
} from "./clients";
import type { SqlClient } from "./sql-client";

const url = process.env.CLINIC_DATABASE_URL_DEV;
const actor: Actor = { type: "staff", id: null };
const TODAY = "2026-11-12";

/** Runs fn in a transaction that is rolled back afterwards. */
async function rolledBack(fn: (db: SqlClient, locationId: string) => Promise<void>) {
  const pool = new Pool({ connectionString: url, max: 1 });
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const loc = await db.query<{ id: string }>(`SELECT id FROM locations ORDER BY name LIMIT 1`);
    await fn(db, loc.rows[0]!.id);
  } finally {
    await db.query("ROLLBACK");
    db.release();
    await pool.end();
  }
}

describe.skipIf(!url)("clients and patients on the clinic database", () => {
  it("finds clients by name, any phone format, email and pet name", () =>
    rolledBack(async (db, loc) => {
      const byName = await searchClients(db, loc, { q: "lopez" });
      expect(byName.rows.some((c) => c.last_name === "Lopez")).toBe(true);
      const maria = byName.rows.find((c) => c.first_name === "Maria")!;
      const digits = maria.mobile.replace(/\D/g, "").slice(-7);
      expect((await searchClients(db, loc, { q: `${digits.slice(0, 3)}-${digits.slice(3)}` })).rows.map((c) => c.id)).toContain(maria.id);
      expect((await searchClients(db, loc, { q: "Penny" })).rows.map((c) => c.id)).toContain(maria.id);
      const all = await searchClients(db, loc, { limit: 10 });
      expect(all.total).toBe(50);
      expect(all.rows).toHaveLength(10);
    }), 60_000);

  it("creates a client with household, consent record and audit entry, and refuses a duplicate mobile", () =>
    rolledBack(async (db, loc) => {
      const client = validateClient({ firstName: "Test", lastName: "Owner", mobile: "+1 202 555 0199", smsConsent: true });
      const id = await createClient(db, { locationId: loc, client, source: "staff", actor });
      const saved = await getClient(db, loc, id);
      expect(saved).toMatchObject({ mobile: "+12025550199", sms_consent: true, household: [] });
      expect(saved.household_id).not.toBeNull();
      const consents = await db.query(`SELECT * FROM client_consents WHERE client_id = $1`, [id]);
      expect(consents.rows).toHaveLength(1);
      const audit = await db.query<{ action: string; changes: Record<string, unknown> }>(
        `SELECT action, changes FROM audit_logs WHERE entity_id = $1`,
        [id],
      );
      expect(audit.rows[0]?.action).toBe("client.created");
      expect(audit.rows[0]?.changes.mobile).toBe("[set]");
      await expect(createClient(db, { locationId: loc, client, source: "staff", actor })).rejects.toBeInstanceOf(ConflictError);
    }), 60_000);

  it("records consent changes and logs only what changed", () =>
    rolledBack(async (db, loc) => {
      const id = await createClient(db, {
        locationId: loc,
        client: validateClient({ firstName: "Ana", lastName: "Diaz", mobile: "2025550123", smsConsent: true }),
        source: "staff",
        actor,
      });
      await updateClient(db, {
        locationId: loc,
        clientId: id,
        actor,
        client: validateClient({ firstName: "Ana", lastName: "Diaz", mobile: "2025550123", smsConsent: false }),
        consentSource: "sms_stop",
      });
      const c = await getClient(db, loc, id);
      expect(c.sms_consent).toBe(false);
      const audit = await db.query<{ changes: Record<string, unknown> }>(
        `SELECT changes FROM audit_logs WHERE entity_id = $1 AND action = 'client.updated'`,
        [id],
      );
      expect(Object.keys(audit.rows[0]!.changes)).toEqual(["smsConsent"]);
      const consents = await db.query<{ granted: boolean; source: string }>(
        `SELECT granted, source FROM client_consents WHERE client_id = $1 ORDER BY captured_at`,
        [id],
      );
      expect(consents.rows.at(-1)).toEqual({ granted: false, source: "sms_stop" });
    }), 60_000);

  it("creates a pet, lists it, and stops its reminders when it dies", () =>
    rolledBack(async (db, loc) => {
      const ownerId = await createClient(db, {
        locationId: loc,
        client: validateClient({ firstName: "Sam", lastName: "Reed", mobile: "2025550177" }),
        source: "staff",
        actor,
      });
      const petId = await createPatient(db, {
        locationId: loc,
        clientId: ownerId,
        actor,
        patient: validatePatient({ name: "Biscuit", species: "dog", dateOfBirth: "2019-05-01", temperamentFlags: ["anxious"] }, TODAY),
      });
      expect((await searchPatients(db, loc, { q: "biscuit" })).rows[0]).toMatchObject({ id: petId, owner_name: "Sam Reed", temperament_flags: ["anxious"] });

      const rule = await db.query<{ id: string }>(`SELECT id FROM reminder_rules WHERE location_id = $1 LIMIT 1`, [loc]);
      await db.query(`INSERT INTO reminders (rule_id, patient_id, due_at) VALUES ($1, $2, '2026-12-01')`, [rule.rows[0]!.id, petId]);

      const confirmation = { confirmedName: "Biscuit", confirmedSpecies: "cat" as const, deathConfirmed: true, deceasedDate: "2026-11-11" };
      await expect(markPatientDeceased(db, { locationId: loc, patientId: petId, confirmation, today: TODAY, actor })).rejects.toBeInstanceOf(
        RuleViolationError,
      );
      const result = await markPatientDeceased(db, {
        locationId: loc,
        patientId: petId,
        confirmation: { ...confirmation, confirmedSpecies: "dog" },
        today: TODAY,
        actor,
      });
      expect(result.remindersStopped).toBe(1);
      const pet = await getPatient(db, loc, petId);
      expect(pet).toMatchObject({ status: "deceased", deceased_date: "2026-11-11" });
      expect((await searchPatients(db, loc, { q: "biscuit" })).rows).toHaveLength(0);
      expect((await searchPatients(db, loc, { q: "biscuit", status: "all" })).rows).toHaveLength(1);
    }), 60_000);

  it("shows a pet's vaccines and contacts", () =>
    rolledBack(async (db, loc) => {
      const penny = (await searchPatients(db, loc, { q: "Penny" })).rows[0]!;
      const detail = await getPatient(db, loc, penny.id);
      expect(detail.contacts[0]?.client_id).toBe(penny.owner_id);
      expect(detail.vaccines.length).toBeGreaterThan(0);
    }), 60_000);
});
