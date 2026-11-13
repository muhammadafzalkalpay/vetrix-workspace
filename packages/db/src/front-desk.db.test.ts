// The AI front desk against the sample clinic, inside a transaction that is
// always rolled back. Skipped without the development database URL (CI).
import { describe, expect, it } from "vitest";
import { Pool } from "@neondatabase/serverless";
import { dateRange, localParts, zonedInstant } from "@vetrix/domain";
import { applyTextKeyword, continueFrontDesk, findOpenTextThread, getCall, listCalls, startFrontDesk, transferFailedFrontDesk } from "./front-desk";
import type { TransactionPool } from "./clients";
import type { SqlClient } from "./sql-client";

const url = process.env.CLINIC_DATABASE_URL_DEV;

interface Loc {
  id: string;
  timezone: string;
}

/** Runs `fn` with a pool whose transactions become savepoints of one outer transaction. */
async function withRollback(fn: (pool: TransactionPool, db: SqlClient, loc: Loc) => Promise<void>) {
  const real = new Pool({ connectionString: url, max: 1 });
  const db = await real.connect();
  const nested = {
    query: (sql: string, params?: unknown[]) => {
      const s = sql.trim().toUpperCase();
      if (s === "BEGIN") return db.query("SAVEPOINT test_tx");
      if (s === "COMMIT") return db.query("RELEASE SAVEPOINT test_tx");
      if (s === "ROLLBACK") return db.query("ROLLBACK TO SAVEPOINT test_tx");
      return db.query(sql, params);
    },
    release: () => undefined,
  } as unknown as SqlClient & { release(): void };
  const pool: TransactionPool = { connect: async () => nested };
  try {
    await db.query("BEGIN");
    const loc = (await db.query<Loc>(`SELECT id, timezone FROM locations ORDER BY name LIMIT 1`)).rows[0]!;
    await fn(pool, db, loc);
  } finally {
    await db.query("ROLLBACK");
    db.release();
    await real.end();
  }
}

/** The next date (from tomorrow) that falls on `weekday` in clinic time, at `time`. */
function next(loc: Loc, weekday: number, time: string): number {
  const today = localParts(Date.now(), loc.timezone).date;
  const date = dateRange(today, 9).slice(1).find((d) => new Date(`${d}T12:00:00Z`).getUTCDay() === weekday)!;
  return zonedInstant(date, time, loc.timezone);
}

async function oneDogOwner(db: SqlClient, loc: string) {
  const { rows } = await db.query<{ mobile: string; first_name: string; pet: string }>(
    `SELECT c.mobile, c.first_name, min(p.name) AS pet FROM clients c JOIN patients p ON p.client_id = c.id AND p.status = 'active'
     WHERE c.location_id = $1 GROUP BY c.id HAVING count(*) = 1 AND bool_and(p.species = 'dog') ORDER BY c.first_name LIMIT 1`,
    [loc],
  );
  return rows[0]!;
}

describe.skipIf(!url)("AI front desk on the clinic database", () => {
  it("verifies a known caller with a pet's name and books by text", () =>
    withRollback(async (pool, db, loc) => {
      const now = next(loc, 2, "10:00"); // Tuesday morning, open
      const owner = await oneDogOwner(db, loc.id);
      const start = await startFrontDesk(pool, { locationId: loc.id, channel: "sms", callerNumber: owner.mobile, sandbox: true }, now);
      expect(start.replies[0]).not.toContain(owner.first_name); // not verified yet
      const verify = await continueFrontDesk(pool, { locationId: loc.id, callId: start.callId, text: "Can I book a nail trim?" }, now);
      expect(verify.replies.join(" ")).toBe(`Is this ${owner.first_name}? And which of your pets is this about?`);
      const offer = await continueFrontDesk(pool, { locationId: loc.id, callId: start.callId, text: `It's for ${owner.pet}` }, now);
      expect(offer.replies.join(" ")).toMatch(/Which works better|Does that work/);
      const booked = await continueFrontDesk(pool, { locationId: loc.id, callId: start.callId, text: "the first one" }, now);
      expect(booked.replies.join(" ")).toContain(`So that's ${owner.pet} for a nail trim`);
      const appt = await db.query<{ booked_by: string; status: string }>(
        `SELECT a.booked_by, a.status FROM appointments a JOIN calls k ON k.appointment_id = a.id WHERE k.id = $1`,
        [start.callId],
      );
      expect(appt.rows[0]).toEqual({ booked_by: "ai", status: "requested" });
      const call = await getCall(db, loc.id, start.callId);
      expect(call.turns.filter((t) => t.speaker === "caller")).toHaveLength(3);
      expect(call.summary).toBe("Booked 1 visit");
      expect(call.sandbox).toBe(true);
    }), 180_000);

  it("adds a new caller and their pet, then books a first exam", () =>
    withRollback(async (pool, db, loc) => {
      const now = next(loc, 3, "09:00");
      const s = await startFrontDesk(pool, { locationId: loc.id, channel: "voice", callerNumber: "+15555550987", sandbox: true }, now);
      for (const text of ["I'd like to book a checkup", "My name is Jordan Rivera", "yes", "no", "yes please", "Biscuit", "a dog", "beagle", "3 years", "boy", "yes", "no", "the first one"]) {
        await continueFrontDesk(pool, { locationId: loc.id, callId: s.callId, text }, now);
      }
      const client = await db.query<{ id: string; source: string; sms_consent: boolean; sms_consent_source: string }>(
        `SELECT id, source, sms_consent, sms_consent_source FROM clients WHERE location_id = $1 AND mobile = '+15555550987'`,
        [loc.id],
      );
      expect(client.rows[0]).toMatchObject({ source: "phone_ai", sms_consent: true, sms_consent_source: "phone_ai" });
      const pet = await db.query(`SELECT provisional, breed, sex, neutered, approx_age_months FROM patients WHERE client_id = $1`, [client.rows[0]!.id]);
      expect(pet.rows[0]).toMatchObject({ provisional: true, breed: "Beagle", sex: "male", neutered: true, approx_age_months: 36 });
      const call = await getCall(db, loc.id, s.callId);
      expect(call.tasks.map((t) => t.type)).not.toContain("records_transfer"); // no previous clinic named
      expect(call.appointment_id).not.toBeNull();
      expect(call.client_name).toBe("Jordan Rivera");
    }), 180_000);

  it("refers an after-hours emergency to the ER, texts the details, alerts staff and logs triage", () =>
    withRollback(async (pool, db, loc) => {
      const now = next(loc, 0, "12:00"); // Sunday: closed
      const owner = await oneDogOwner(db, loc.id);
      const s = await startFrontDesk(pool, { locationId: loc.id, channel: "voice", callerNumber: owner.mobile, sandbox: true }, now);
      const r = await continueFrontDesk(pool, { locationId: loc.id, callId: s.callId, text: "He got into the rat poison" }, now);
      expect(r.triageLevel).toBe("emergency");
      expect(r.replies.join(" ")).toContain("Metro Animal Emergency Hospital");
      const call = await getCall(db, loc.id, s.callId);
      expect(call.after_hours).toBe(true);
      expect(call.transfer_outcome).toBe("er_referred");
      expect(call.triage[0]).toMatchObject({ level: "emergency", trigger_id: "toxin_ingestion", action_taken: "er_referral" });
      expect(call.tasks[0]).toMatchObject({ type: "emergency_alert", priority: "urgent" });
      const sms = await db.query<{ status: string }>(`SELECT m.status FROM messages m JOIN clients c ON c.id = m.client_id WHERE c.mobile = $1 AND m.template_key = 'after_hours_er'`, [owner.mobile]);
      expect(sms.rows[0]!.status).toBe("simulated");
      const list = await listCalls(db, loc.id, { level: "emergency" });
      expect(list.rows.map((c) => c.id)).toContain(s.callId);
    }), 180_000);

  it("warm-transfers an in-hours emergency call and ends it", () =>
    withRollback(async (pool, db, loc) => {
      const now = next(loc, 4, "11:00");
      const s = await startFrontDesk(pool, { locationId: loc.id, channel: "voice", callerNumber: "+15555550111", sandbox: true }, now);
      const r = await continueFrontDesk(pool, { locationId: loc.id, callId: s.callId, text: "my cat is having a seizure" }, now);
      expect(r.ended).toBe(true);
      expect(r.notes.join(" ")).toMatch(/Sandbox: Warm transfer to/);
      const call = await getCall(db, loc.id, s.callId);
      expect(call.transfer_outcome).toBe("transferred");
      expect(call.ended_at).not.toBeNull();
    }), 180_000);

  it("live calls: hands back the transfer number, then the ER fallback when it does not connect", () =>
    withRollback(async (pool, db, loc) => {
      const now = next(loc, 4, "11:00");
      const s = await startFrontDesk(pool, { locationId: loc.id, channel: "voice", callerNumber: "+15555550112", sandbox: false, providerCallId: "CAlive1" }, now);
      const r = await continueFrontDesk(pool, { locationId: loc.id, callId: s.callId, text: "she collapsed and won't wake up" }, now);
      const transfer = (await db.query<{ n: string }>(`SELECT emergency_transfer_number AS n FROM location_phone_settings WHERE location_id = $1`, [loc.id])).rows[0]!.n;
      expect(r.transferTo).toBe(transfer);
      expect(r.ended).toBe(false);
      const failed = await transferFailedFrontDesk(pool, { locationId: loc.id, callId: s.callId }, now);
      expect(failed.replies.join(" ")).toMatch(/couldn't reach the team/);
      expect(failed.outbound[0]).toMatchObject({ to: "+15555550112", messageId: null });
      const call = await getCall(db, loc.id, s.callId);
      expect(call).toMatchObject({ transfer_outcome: "failed" });
      expect(call.ended_at).not.toBeNull();
      expect(call.tasks.some((t) => t.type === "emergency_alert")).toBe(true);
    }), 180_000);

  it("continues a client's open text thread, and STOP turns texting off", () =>
    withRollback(async (pool, db, loc) => {
      const owner = await oneDogOwner(db, loc.id);
      expect(await findOpenTextThread(db, loc.id, owner.mobile)).toBeNull();
      const s = await startFrontDesk(pool, { locationId: loc.id, channel: "sms", callerNumber: owner.mobile, sandbox: true });
      expect(await findOpenTextThread(db, loc.id, owner.mobile)).toBe(s.callId);
      expect(await findOpenTextThread(db, loc.id, owner.mobile, 0)).toBeNull();
      expect(await applyTextKeyword(db, { locationId: loc.id, mobile: owner.mobile, body: " Stop " })).toBe("stop");
      const c = await db.query<{ sms_consent: boolean }>(`SELECT sms_consent FROM clients WHERE location_id = $1 AND mobile = $2`, [loc.id, owner.mobile]);
      expect(c.rows[0]!.sms_consent).toBe(false);
      expect(await applyTextKeyword(db, { locationId: loc.id, mobile: owner.mobile, body: "START" })).toBe("start");
      expect(await applyTextKeyword(db, { locationId: loc.id, mobile: owner.mobile, body: "cancel my appointment" })).toBeNull();
    }), 180_000);
});
