// Messages on the sample clinic, inside a transaction that is rolled back.
import { describe, expect, it } from "vitest";
import { Pool } from "@neondatabase/serverless";
import { getClientThread, listMessages, recordOutbound, setMessageResult } from "./messages";

const url = process.env.CLINIC_DATABASE_URL_DEV;

describe.skipIf(!url)("messages on the clinic database", () => {
  it("records a staff text, lists it and shows it in the client's history", async () => {
    const pool = new Pool({ connectionString: url, max: 1 });
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const { rows } = await db.query<{ loc: string; client: string; staff: string }>(
        `SELECT c.location_id AS loc, c.id AS client, (SELECT id FROM staff_users LIMIT 1) AS staff FROM clients c ORDER BY c.last_name LIMIT 1`,
      );
      const { loc, client, staff } = rows[0]!;
      const id = await recordOutbound(db, { locationId: loc, clientId: client, channel: "sms", subject: null, body: "Max's results are in.", sandbox: true, staffUserId: staff, actor: { type: "staff", id: staff } });
      const list = await listMessages(db, loc, { channel: "sms" });
      expect(list.rows[0]).toMatchObject({ id, status: "simulated", template_key: "staff_message", body: "Max's results are in." });
      const live = await recordOutbound(db, { locationId: loc, clientId: client, channel: "email", subject: "Results", body: "All good.", sandbox: false, staffUserId: staff, actor: { type: "staff", id: staff } });
      await setMessageResult(db, { locationId: loc, messageId: live, ok: false, providerMessageId: null, error: "Email is not set up (SendGrid)." });
      const thread = await getClientThread(db, loc, client);
      expect(thread.items.filter((i) => i.kind === "out").map((i) => (i.kind === "out" ? [i.status, i.error] : null))).toEqual(
        expect.arrayContaining([["simulated", null], ["failed", "Email is not set up (SendGrid)."]]),
      );
      const audit = await db.query(`SELECT changes FROM audit_logs WHERE entity_id = $1`, [id]);
      expect(JSON.stringify(audit.rows[0]!.changes)).not.toContain("results"); // content is not copied to the audit log
    } finally {
      await db.query("ROLLBACK");
      db.release();
      await pool.end();
    }
  }, 120_000);
});
