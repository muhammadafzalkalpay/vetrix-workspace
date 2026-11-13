// Reminders on the sample clinic, inside a transaction that is rolled back.
import { describe, expect, it } from "vitest";
import { Pool } from "@neondatabase/serverless";
import { reminderCounts } from "@vetrix/domain";
import { previewReminders, runReminders, stopReminder } from "./retention";

const url = process.env.CLINIC_DATABASE_URL_DEV;
const values = { clinicName: "Main Veterinary Clinic", aiName: "Riley", clinicPhone: "(555) 010-1000", bookingLink: "reply to this text" };
const actor = { type: "staff" as const, id: null };

describe.skipIf(!url)("reminders on the clinic database", () => {
  it("previews the reference date, sends once, never twice, and stops a reminder", async () => {
    const pool = new Pool({ connectionString: url, max: 1 });
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const loc = (await db.query<{ id: string }>(`SELECT id FROM locations ORDER BY name LIMIT 1`)).rows[0]!.id;
      const { rows } = await previewReminders(db, loc, "2026-11-03");
      const counts = reminderCounts(rows);
      // The seeded sample clinic is the pack's test data: same counts, unless
      // a visit booked since (in this dev database) now suppresses one.
      expect(counts.get("vaccine_due:-30")).toBeGreaterThan(15);
      expect(counts.get("parasite_prevention_refill:0")).toBe(13);
      expect(rows.some((r) => r.suppressed === "Client is marked do not contact")).toBe(true);

      const first = await runReminders(db, { locationId: loc, asOf: "2026-11-03", sandbox: true, quietHours: false, values, actor });
      expect(first.summary.messages).toBeGreaterThan(20);
      expect(first.outbound).toHaveLength(0); // Sandbox: nothing to send
      const saved = await db.query<{ n: number }>(`SELECT count(*)::int n FROM messages WHERE location_id = $1 AND status = 'simulated' AND template_key <> 'staff_message' AND sent_at > now() - interval '1 hour'`, [loc]);
      expect(saved.rows[0]!.n).toBeGreaterThanOrEqual(first.summary.messages);
      const again = await runReminders(db, { locationId: loc, asOf: "2026-11-03", sandbox: true, quietHours: false, values, actor });
      expect(again.summary.messages).toBe(0);

      const target = rows.find((r) => !r.suppressed)!;
      await stopReminder(db, { locationId: loc, ruleId: target.ruleId, patientId: target.patientId, dueAt: target.dueAt, actor });
      const after = await previewReminders(db, loc, "2026-11-03");
      expect(after.rows.find((r) => r.patientId === target.patientId && r.ruleId === target.ruleId && r.dueAt === target.dueAt)!.suppressed).toBe("Stopped");
      console.log("sample clinic counts on 2026-11-03:", Object.fromEntries([...counts].filter(([k]) => !k.endsWith(":all") || k.startsWith("no_show") || k.startsWith("post_surgery"))));
    } finally {
      await db.query("ROLLBACK");
      db.release();
      await pool.end();
    }
  }, 300_000);
});
