// Clinic settings on the sample clinic, inside a transaction that is rolled back.
import { describe, expect, it } from "vitest";
import { Pool } from "@neondatabase/serverless";
import { validateFrontDesk, validateWeekHours } from "@vetrix/domain";
import { addHoliday, loadSettings, removeHoliday, saveFrontDesk, saveMessaging, saveWeekHours, setReminderRuleEnabled, setServiceActive } from "./settings";

const url = process.env.CLINIC_DATABASE_URL_DEV;
const actor = { type: "staff" as const, id: null };

describe.skipIf(!url)("settings on the clinic database", () => {
  it("loads, saves each section, audits changes and rejects a duplicate closed day", async () => {
    const pool = new Pool({ connectionString: url, max: 1 });
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const locationId = (await db.query<{ id: string }>(`SELECT id FROM locations ORDER BY name LIMIT 1`)).rows[0]!.id;
      const ctx = { locationId, actor };
      const before = await loadSettings(db, locationId);
      expect(before.hours.filter(Boolean).length).toBeGreaterThan(0);
      expect(before.reminderRules.some((r) => r.id === "annual_wellness" && r.running)).toBe(true);

      // Hours: closed on Sunday, short Saturday.
      const f: Record<string, string> = { closed_0: "on" };
      for (let d = 1; d < 7; d++) Object.assign(f, { [`opens_${d}`]: "08:00", [`closes_${d}`]: d === 6 ? "12:00" : "18:00" });
      await saveWeekHours(db, ctx, validateWeekHours(f));
      const after = await loadSettings(db, locationId);
      expect(after.hours[0]).toBeNull();
      expect(after.hours[6]).toEqual({ opens: "08:00", closes: "12:00" });

      await saveFrontDesk(db, ctx, validateFrontDesk({ aiName: "Sam", afterHoursBehaviour: "er_only", erName: "City ER", erPhone: "555-010-2222", erAddress: "1 Main St" }));
      await saveMessaging(db, ctx, { quietStart: "21:00", quietEnd: "07:30" });
      const fd = await loadSettings(db, locationId);
      expect(fd.frontDesk).toMatchObject({ aiName: "Sam", afterHoursBehaviour: "er_only", erPhone: "+15550102222" });
      expect(fd.messaging).toEqual({ quietStart: "21:00", quietEnd: "07:30" });

      await addHoliday(db, ctx, { date: "2031-12-25", name: "Christmas" });
      await expect(addHoliday(db, ctx, { date: "2031-12-25", name: null })).rejects.toThrow(/already a closed day/);
      const h = (await loadSettings(db, locationId)).holidays.find((x) => x.date === "2031-12-25")!;
      await removeHoliday(db, ctx, h.id);

      await setReminderRuleEnabled(db, ctx, "annual_wellness", false);
      expect((await loadSettings(db, locationId)).reminderRules.find((r) => r.id === "annual_wellness")!.enabled).toBe(false);
      const svc = before.services[0]!;
      await setServiceActive(db, ctx, svc.id, false);
      expect((await loadSettings(db, locationId)).services.find((x) => x.id === svc.id)!.active).toBe(false);

      const audit = (await db.query<{ action: string; changes: Record<string, unknown> }>(
        `SELECT action, changes FROM audit_logs WHERE location_id = $1 AND (action LIKE 'settings.%' OR action LIKE 'service.%')`,
        [locationId],
      )).rows;
      expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["settings.hours", "settings.front_desk", "settings.messaging", "settings.holiday_added", "settings.holiday_removed", "settings.reminder_rule", "service.deactivated"]));
      // Changes are recorded as [before, after].
      expect(audit.find((a) => a.action === "settings.front_desk")!.changes.aiName).toEqual([before.frontDesk.aiName, "Sam"]);
    } finally {
      await db.query("ROLLBACK");
      db.release();
      await pool.end();
    }
  }, 120_000);
});
