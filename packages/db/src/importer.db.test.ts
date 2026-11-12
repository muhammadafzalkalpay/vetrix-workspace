// Imports the sample clinic files inside a rolled-back transaction. Skipped
// when the development database URL is not set (CI).
import { describe, expect, it } from "vitest";
import { Pool } from "@neondatabase/serverless";
import { normalizeRows, planImport } from "@vetrix/domain";
import { importContext, runImport } from "./importer";
import { SAMPLE_DATA_DIR } from "./seed/sample-clinic";
import { readCsv } from "./seed/csv";
import path from "node:path";

const url = process.env.CLINIC_DATABASE_URL_DEV;
const TODAY = "2026-11-12"; // the day the sample clinic seed ran (pets_due_30d = 28)
const read = (f: string) => readCsv(path.join(SAMPLE_DATA_DIR, f));

async function withRollback(fn: (db: import("./sql-client").SqlClient, loc: string) => Promise<void>) {
  const pool = new Pool({ connectionString: url, max: 1 });
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const loc = (await db.query<{ id: string }>(`SELECT id FROM locations ORDER BY name LIMIT 1`)).rows[0]!.id;
    await fn(db, loc);
  } finally {
    await db.query("ROLLBACK");
    db.release();
    await pool.end();
  }
}

describe.skipIf(!url)("importer on the clinic database", () => {
  const source = {
    clients: normalizeRows(read("clients.csv"), "clients"),
    patients: normalizeRows(read("patients.csv"), "patients"),
    vaccines: normalizeRows(read("vaccine_records.csv"), "vaccines"),
  };
  const actor = { type: "staff" as const, id: null };

  it("imports the whole sample clinic in seconds", () =>
    withRollback(async (db, loc) => {
      await db.query(`TRUNCATE clients, patients, households CASCADE`);
      const plan = planImport({ ...source, today: TODAY, ...(await importContext(db, loc)) });
      expect(plan.summary).toMatchObject({ clientsNew: 50, patients: 67, vaccines: 156, errors: 0 });
      const started = Date.now();
      const result = await runImport(db, { locationId: loc, today: TODAY, plan, source, actor });
      const seconds = (Date.now() - started) / 1000;
      expect(result).toMatchObject({ clientsCreated: 50, petsCreated: 67, vaccinesCreated: 156, petsDue30d: 28 });
      expect(seconds).toBeLessThan(20);
      const rows = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM import_rows WHERE import_job_id = $1`, [result.jobId]);
      expect(rows.rows[0]!.n).toBe(50 + 67 + 156);
      const multiPet = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM (SELECT c.household_id FROM patients p JOIN clients c ON c.id = p.client_id
           WHERE p.status = 'active' GROUP BY c.household_id HAVING count(*) > 1) x`,
      );
      expect(multiPet.rows[0]!.n).toBe(17);
      console.info(`sample clinic imported in ${seconds.toFixed(1)}s`);
    }), 120_000);

  it("adds nothing when the same files are imported again", () =>
    withRollback(async (db, loc) => {
      const plan = planImport({ ...source, today: TODAY, ...(await importContext(db, loc)) });
      expect(plan.summary).toMatchObject({ clientsNew: 0, clientsMatched: 50, patients: 0, patientsMatched: 67, vaccines: 0, vaccinesMatched: 156 });
      const result = await runImport(db, { locationId: loc, today: TODAY, plan, source, actor });
      expect(result).toMatchObject({ clientsCreated: 0, petsCreated: 0, vaccinesCreated: 0 });
    }), 120_000);
});
