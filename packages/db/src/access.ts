// Staff access inside a clinic database: the default roles and permissions,
// and what one signed-in person may do at each location.
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  ROLE_KEYS,
  ROLES,
  type Permission,
  type RoleKey,
  type StaffAccess,
} from "@vetrix/domain";
import type { SqlClient } from "./sql-client";

/**
 * Makes roles, permissions and role_permissions match the catalogue in
 * @vetrix/domain. Safe to run any number of times. Run inside a transaction.
 */
export async function syncRoleCatalogue(client: SqlClient): Promise<void> {
  for (const id of ALL_PERMISSIONS) {
    await client.query(
      `INSERT INTO permissions (id, description) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET description = EXCLUDED.description`,
      [id, PERMISSIONS[id]],
    );
  }
  for (const key of ROLE_KEYS) {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO roles (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [key],
    );
    const roleId = rows[0]!.id;
    const granted = [...ROLES[key].permissions];
    await client.query(`DELETE FROM role_permissions WHERE role_id = $1 AND NOT (permission_id = ANY($2::text[]))`, [
      roleId,
      granted,
    ]);
    await client.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`,
      [roleId, granted],
    );
  }
}

interface AccessRow {
  staff_user_id: string;
  display_name: string;
  location_id: string | null;
  permission_id: string | null;
}

/**
 * Loads what a person may do in this clinic database. Returns undefined when
 * they are not staff here or their staff record is disabled.
 */
export async function loadStaffAccess(client: SqlClient, platformUserId: string): Promise<StaffAccess | undefined> {
  const { rows } = await client.query<AccessRow>(
    `SELECT su.id AS staff_user_id, su.display_name, slr.location_id, rp.permission_id
     FROM staff_users su
     LEFT JOIN staff_location_roles slr ON slr.staff_user_id = su.id
     LEFT JOIN locations l ON l.id = slr.location_id
     LEFT JOIN role_permissions rp ON rp.role_id = slr.role_id
     WHERE su.platform_user_ref = $1 AND su.status = 'active'`,
    [platformUserId],
  );
  const first = rows[0];
  if (!first) return undefined;
  const locations = new Map<string, Set<Permission>>();
  for (const row of rows) {
    if (!row.location_id || !row.permission_id) continue;
    if (!(row.permission_id in PERMISSIONS)) continue; // retired permission still in the database
    let perms = locations.get(row.location_id);
    if (!perms) locations.set(row.location_id, (perms = new Set()));
    perms.add(row.permission_id as Permission);
  }
  return {
    platformUserId,
    staffUserId: first.staff_user_id,
    displayName: first.display_name,
    locations,
  };
}

export interface StaffMemberInput {
  platformUserId: string;
  displayName: string;
  role: RoleKey;
  /** Location ids. Empty means every location in this clinic database. */
  locationIds?: string[];
}

/** Creates or updates the staff record and gives the role at the locations. */
export async function upsertStaffMember(client: SqlClient, input: StaffMemberInput): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO staff_users (platform_user_ref, display_name, status) VALUES ($1, $2, 'active')
     ON CONFLICT (platform_user_ref) DO UPDATE SET display_name = EXCLUDED.display_name, status = 'active'
     RETURNING id`,
    [input.platformUserId, input.displayName],
  );
  const staffUserId = rows[0]!.id;
  const role = await client.query<{ id: string }>(`SELECT id FROM roles WHERE name = $1`, [input.role]);
  if (!role.rows[0]) throw new Error(`role "${input.role}" is missing; run syncRoleCatalogue first`);
  const locations = input.locationIds?.length
    ? input.locationIds
    : (await client.query<{ id: string }>(`SELECT id FROM locations`)).rows.map((r) => r.id);
  if (locations.length === 0) throw new Error("this clinic database has no locations yet");
  await client.query(
    `INSERT INTO staff_location_roles (staff_user_id, location_id, role_id)
     SELECT $1, unnest($2::uuid[]), $3 ON CONFLICT DO NOTHING`,
    [staffUserId, locations, role.rows[0].id],
  );
  return staffUserId;
}
