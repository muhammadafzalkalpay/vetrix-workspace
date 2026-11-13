"use server";

// Public: a client claims a waitlist offer from the link in their text.
// The token is the only key; it is long, random and single-use.
import { claimOffer, queuedMessages, withTransaction, type ClaimResult } from "@vetrix/db/runtime";
import { getMessagingMode } from "@/lib/env";
import { logger } from "@/lib/logger";
import { deliverQueued } from "@/lib/outbound";
import { tenancy } from "@/lib/tenancy";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

export async function claimAction(org: string, token: string): Promise<ClaimResult> {
  if (!UUID.test(org) || !TOKEN.test(token)) return { status: "invalid" };
  try {
    const { pool } = await tenancy().clinicPool(org);
    const loc = await pool.query<{ location_id: string; name: string }>(
      `SELECT w.location_id, l.name FROM waitlist_offers o JOIN waitlist_entries w ON w.id = o.waitlist_entry_id JOIN locations l ON l.id = w.location_id WHERE o.claim_token = $1`,
      [token],
    );
    if (!loc.rows[0]) return { status: "invalid" };
    const sandbox = getMessagingMode() === "sandbox";
    const r = await withTransaction(pool, (tx) => claimOffer(tx, { token, now: Date.now(), sandbox, clinicName: loc.rows[0]!.name }));
    if (!sandbox) await deliverQueued({ clinic: pool, organizationId: org, locationId: loc.rows[0].location_id, clinicName: loc.rows[0].name, messages: await queuedMessages(pool, loc.rows[0].location_id) });
    return r;
  } catch (error) {
    logger.error("waitlist claim failed", { error });
    return { status: "invalid" };
  }
}
