// Registry side of staff access: people and which organizations they belong to.
// What they may do inside an organization lives in its clinic database.
import type { SqlClient } from "./sql-client";

export interface PlatformUser {
  id: string;
  email: string;
  name: string;
  status: "active" | "invited" | "disabled";
}

export interface Membership {
  organization_id: string;
  organization_slug: string;
  organization_name: string;
}

/** Finds the person by email or creates them (no password yet). */
export async function ensurePlatformUser(registry: SqlClient, email: string, name: string): Promise<PlatformUser> {
  const { rows } = await registry.query<PlatformUser>(
    `INSERT INTO platform_users (email, name) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET name = CASE WHEN platform_users.name = '' THEN EXCLUDED.name ELSE platform_users.name END,
                                       updated_at = now()
     RETURNING id, email::text AS email, name, status`,
    [email.trim().toLowerCase(), name.trim()],
  );
  return rows[0]!;
}

export async function addOrganizationMember(registry: SqlClient, organizationId: string, platformUserId: string) {
  await registry.query(
    `INSERT INTO organization_members (organization_id, platform_user_id, status) VALUES ($1, $2, 'active')
     ON CONFLICT (organization_id, platform_user_id) DO UPDATE SET status = 'active'`,
    [organizationId, platformUserId],
  );
}

/** Active organizations this active person may open. */
export async function membershipsFor(registry: SqlClient, platformUserId: string): Promise<Membership[]> {
  const { rows } = await registry.query<Membership>(
    `SELECT o.id AS organization_id, o.slug AS organization_slug, o.name AS organization_name
     FROM organization_members m
     JOIN organizations o ON o.id = m.organization_id
     JOIN platform_users u ON u.id = m.platform_user_id
     WHERE m.platform_user_id = $1 AND m.status = 'active' AND o.status = 'active' AND u.status = 'active'
     ORDER BY o.name`,
    [platformUserId],
  );
  return rows;
}

/** Emails for staff records (registry), by platform user id. */
export async function platformUserEmails(registry: SqlClient, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { rows } = await registry.query<{ id: string; email: string }>(`SELECT id, email::text AS email FROM platform_users WHERE id = ANY($1::uuid[])`, [ids]);
  return new Map(rows.map((r) => [r.id, r.email]));
}
