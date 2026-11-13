// Scheduler endpoint: Cloud Scheduler calls this every minute with
// "Authorization: Bearer <JOBS_SECRET>". For every clinic and location it
// runs whatever is due (daily reminders, the 7 PM fasting check, the 8 PM
// no-reply tasks). Each job claims its day first, so repeats are harmless.
import { timingSafeEqual } from "node:crypto";
import { aiPersonaName, listTenantDatabases, queuedMessages, runDueJobs, withTransaction } from "@vetrix/db/runtime";
import { formatPhone } from "@vetrix/domain";
import { getEnv, getMessagingMode } from "@/lib/env";
import { logger } from "@/lib/logger";
import { deliverQueued } from "@/lib/outbound";
import { tenancy } from "@/lib/tenancy";

export const dynamic = "force-dynamic";

function authorised(request: Request): boolean {
  const env = getEnv();
  if (!env.JOBS_SECRET) return env.NODE_ENV !== "production"; // local development only
  const given = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  const want = Buffer.from(env.JOBS_SECRET);
  return given.length === want.length && timingSafeEqual(given, want);
}

const phone = (p: string | null) => {
  if (!p) return "the clinic";
  try {
    return formatPhone(p.startsWith("+") ? p : `+1${p.replace(/\D/g, "")}`);
  } catch {
    return p;
  }
};

export async function POST(request: Request) {
  if (!authorised(request)) return new Response("Unauthorized", { status: 401 });
  const sandbox = getMessagingMode() === "sandbox";
  const t = tenancy();
  const now = Date.now();
  const report: { organization: string; location: string; ran: string[]; error?: string }[] = [];
  for (const tenant of await listTenantDatabases(t.registry)) {
    if (tenant.status !== "active") continue;
    try {
      const { pool } = await t.clinicPool(tenant.organization_id);
      const { rows: locations } = await pool.query<{ id: string; name: string; main_phone: string | null }>(
        `SELECT id, name, main_phone FROM locations WHERE status <> 'closed' ORDER BY name`,
      );
      for (const loc of locations) {
        try {
          const aiName = await aiPersonaName(pool, loc.id);
          const values = { clinicName: loc.name, aiName, clinicPhone: phone(loc.main_phone), bookingLink: "reply to this text" };
          const r = await withTransaction(pool, (tx) => runDueJobs(tx, { locationId: loc.id, now, sandbox, values }));
          // Live: send everything queued at this location (this run's messages,
          // waitlist offers, replies saved by other paths).
          if (!sandbox) {
            await deliverQueued({ clinic: pool, organizationId: tenant.organization_id, locationId: loc.id, clinicName: loc.name, messages: await queuedMessages(pool, loc.id) });
          }
          report.push({ organization: tenant.organization_slug, location: loc.name, ran: r.ran });
        } catch (error) {
          logger.error("scheduled jobs failed for a location", { error, organization: tenant.organization_slug });
          report.push({ organization: tenant.organization_slug, location: loc.name, ran: [], error: "failed" });
        }
      }
    } catch (error) {
      logger.error("scheduled jobs: clinic unavailable", { error, organization: tenant.organization_slug });
      report.push({ organization: tenant.organization_slug, location: "*", ran: [], error: "clinic unavailable" });
    }
  }
  return Response.json({ ok: true, sandbox, report });
}
