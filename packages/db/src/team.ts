// The clinic's team: who has access, with which role at which location.
// Emails live in the registry (platform_users); roles and status here.
import { ForbiddenError, isRoleKey, NotFoundError, RuleViolationError, ValidationError, type RoleKey } from "@vetrix/domain";
import { writeAudit, type Actor } from "./clients";
import type { SqlClient } from "./sql-client";

export interface TeamMember {
  staff_user_id: string;
  platform_user_ref: string;
  display_name: string;
  status: "active" | "invited" | "disabled";
  roles: { location_id: string; location_name: string; role: RoleKey }[];
  is_provider: boolean;
}

export async function listTeam(db: SqlClient): Promise<TeamMember[]> {
  const { rows } = await db.query<TeamMember>(
    `SELECT su.id AS staff_user_id, su.platform_user_ref, su.display_name, su.status,
            coalesce(json_agg(json_build_object('location_id', l.id, 'location_name', l.name, 'role', r.name) ORDER BY l.name)
                     FILTER (WHERE l.id IS NOT NULL), '[]') AS roles,
            EXISTS (SELECT 1 FROM providers p WHERE p.staff_user_id = su.id) AS is_provider
     FROM staff_users su
     LEFT JOIN staff_location_roles slr ON slr.staff_user_id = su.id
     LEFT JOIN locations l ON l.id = slr.location_id
     LEFT JOIN roles r ON r.id = slr.role_id
     GROUP BY su.id ORDER BY su.status = 'disabled', su.display_name`,
  );
  return rows;
}

/** Active owners at a location: never let the last one be removed. */
async function activeOwners(db: SqlClient, locationId: string): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT su.id FROM staff_users su JOIN staff_location_roles slr ON slr.staff_user_id = su.id JOIN roles r ON r.id = slr.role_id
     WHERE slr.location_id = $1 AND r.name = 'owner' AND su.status = 'active'`,
    [locationId],
  );
  return rows.map((r) => r.id);
}

/** Gives one role at one location (replacing the person's role there). */
export async function setStaffRole(
  db: SqlClient,
  input: { staffUserId: string; locationId: string; role: string; actor: Actor; selfId: string },
): Promise<void> {
  if (!isRoleKey(input.role)) throw new ValidationError("Choose a role.", { field: "role" });
  if (input.staffUserId === input.selfId) throw new RuleViolationError("team.self", "You can't change your own role. Ask another owner.");
  const staff = await db.query(`SELECT 1 FROM staff_users WHERE id = $1`, [input.staffUserId]);
  if (!staff.rows[0]) throw new NotFoundError("Staff member", input.staffUserId);
  const owners = await activeOwners(db, input.locationId);
  if (input.role !== "owner" && owners.length === 1 && owners[0] === input.staffUserId) {
    throw new RuleViolationError("team.last_owner", "Every location needs at least one owner.");
  }
  const before = await db.query<{ role: string }>(
    `SELECT r.name AS role FROM staff_location_roles slr JOIN roles r ON r.id = slr.role_id WHERE slr.staff_user_id = $1 AND slr.location_id = $2`,
    [input.staffUserId, input.locationId],
  );
  await db.query(`DELETE FROM staff_location_roles WHERE staff_user_id = $1 AND location_id = $2`, [input.staffUserId, input.locationId]);
  await db.query(
    `INSERT INTO staff_location_roles (staff_user_id, location_id, role_id) SELECT $1, $2, id FROM roles WHERE name = $3`,
    [input.staffUserId, input.locationId, input.role],
  );
  await writeAudit(db, {
    locationId: input.locationId, actor: input.actor, action: "staff.role_changed", entityType: "staff_user", entityId: input.staffUserId,
    changes: { role: [before.rows.map((r) => r.role).join(", ") || null, input.role] },
  });
}

/** Turns someone's access off or back on. Disabled people are signed out within a minute. */
export async function setStaffStatus(
  db: SqlClient,
  input: { staffUserId: string; locationId: string; status: "active" | "disabled"; actor: Actor; selfId: string },
): Promise<void> {
  if (input.staffUserId === input.selfId) throw new ForbiddenError("You can't turn off your own access.");
  if (input.status === "disabled") {
    const owners = await activeOwners(db, input.locationId);
    if (owners.length === 1 && owners[0] === input.staffUserId) throw new RuleViolationError("team.last_owner", "Every location needs at least one owner.");
  }
  const { rows } = await db.query<{ status: string }>(`UPDATE staff_users SET status = $2 WHERE id = $1 RETURNING status`, [input.staffUserId, input.status]);
  if (!rows[0]) throw new NotFoundError("Staff member", input.staffUserId);
  await writeAudit(db, {
    locationId: input.locationId, actor: input.actor, action: input.status === "disabled" ? "staff.disabled" : "staff.enabled",
    entityType: "staff_user", entityId: input.staffUserId, changes: { status: input.status },
  });
}
