// Routing phone numbers to clinic locations (registry). Twilio webhooks
// arrive with the number the client dialled or texted; this finds whose it is.
import { normalizePhone } from "@vetrix/domain";
import type { SqlClient } from "./sql-client";

export interface PhoneRoute {
  e164: string;
  organizationId: string;
  locationId: string;
}

export async function routePhoneNumber(registry: SqlClient, number: string): Promise<PhoneRoute | null> {
  let e164: string;
  try {
    e164 = normalizePhone(number);
  } catch {
    return null;
  }
  const { rows } = await registry.query<{ e164: string; organization_id: string; location_id: string }>(
    `SELECT p.e164, p.organization_id, p.location_id FROM phone_numbers p JOIN organizations o ON o.id = p.organization_id
     WHERE p.e164 = $1 AND o.status = 'active'`,
    [e164],
  );
  const r = rows[0];
  return r ? { e164: r.e164, organizationId: r.organization_id, locationId: r.location_id } : null;
}

/** Assigns a number to a location, replacing any earlier assignment. */
export async function assignPhoneNumber(registry: SqlClient, input: { number: string; organizationId: string; locationId: string }): Promise<PhoneRoute> {
  const e164 = normalizePhone(input.number);
  await registry.query(
    `INSERT INTO phone_numbers (e164, organization_id, location_id) VALUES ($1, $2, $3)
     ON CONFLICT (e164) DO UPDATE SET organization_id = EXCLUDED.organization_id, location_id = EXCLUDED.location_id`,
    [e164, input.organizationId, input.locationId],
  );
  return { e164, organizationId: input.organizationId, locationId: input.locationId };
}

/** The number a location texts from (its first assigned number), or null. */
export async function numberForLocation(registry: SqlClient, input: { organizationId: string; locationId: string }): Promise<string | null> {
  const { rows } = await registry.query<{ e164: string }>(
    `SELECT e164 FROM phone_numbers WHERE organization_id = $1 AND location_id = $2 ORDER BY created_at LIMIT 1`,
    [input.organizationId, input.locationId],
  );
  return rows[0]?.e164 ?? null;
}
