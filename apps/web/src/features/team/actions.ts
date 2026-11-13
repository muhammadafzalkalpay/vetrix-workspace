"use server";

// Team management: add a staff member, change a role, turn access off or on.
// Only people with staff.manage at the active location.
import { revalidatePath } from "next/cache";
import { ForbiddenError, isRoleKey, RuleViolationError, ValidationError } from "@vetrix/domain";
import { addOrganizationMember, ensurePlatformUser, setStaffRole, setStaffStatus, upsertStaffMember, withTransaction, type Actor } from "@vetrix/db/runtime";
import { formValues, toActionError, type ActionResult } from "@/lib/action-result";
import { auth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { requireShell } from "@/lib/session";
import { tenancy } from "@/lib/tenancy";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function manager() {
  const shell = await requireShell();
  if (!shell.permissions.has("staff.manage")) throw new ForbiddenError();
  const actor: Actor = { type: "staff", id: shell.access.staffUserId };
  return { shell, actor };
}

export async function addStaffAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const values = formValues(form);
  try {
    const { shell, actor } = await manager();
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const role = String(form.get("role") ?? "");
    if (name.length < 2) throw new ValidationError("Enter their name.", { field: "name" });
    if (!EMAIL.test(email)) throw new ValidationError("Enter a valid email address.", { field: "email" });
    if (!isRoleKey(role)) throw new ValidationError("Choose a role.", { field: "role" });
    if (role === "owner" && !shell.permissions.has("billing.manage")) throw new RuleViolationError("team.owner", "Only an owner can add another owner.");

    const registry = tenancy().registry;
    const user = await ensurePlatformUser(registry, email, name);
    const existing = await shell.clinic.query(
      `SELECT 1 FROM staff_users su JOIN staff_location_roles slr ON slr.staff_user_id = su.id WHERE su.platform_user_ref = $1 AND slr.location_id = $2`,
      [user.id, shell.location.id],
    );
    if (existing.rows[0]) throw new RuleViolationError("team.exists", `${email} is already on the team here. Change their role in the list instead.`);
    await withTransaction(shell.clinic, async (tx) => {
      const id = await upsertStaffMember(tx, { platformUserId: user.id, displayName: name, role, locationIds: [shell.location.id] });
      await tx.query(
        `INSERT INTO audit_logs (location_id, actor_type, actor_id, action, entity_type, entity_id, changes) VALUES ($1, $2, $3, 'staff.added', 'staff_user', $4, $5)`,
        [shell.location.id, actor.type, actor.id, id, JSON.stringify({ role })],
      );
    });
    // Membership last: they can only open the organization once their staff record exists.
    await addOrganizationMember(registry, shell.organization.organization_id, user.id);

    // A "set your password" link (the same email as Forgot password).
    let emailed = true;
    try {
      await auth().api.requestPasswordReset({ body: { email, redirectTo: `${getEnv().APP_URL}/reset-password` } });
    } catch (error) {
      emailed = false;
      logger.warn("set-password email failed", { error: (error as Error).name });
    }
    revalidatePath("/team");
    return {
      ok: true,
      message: emailed
        ? `${name} was added. They'll get an email to set their password.`
        : `${name} was added. Ask them to use "Forgot password" on the sign-in page to set a password.`,
    };
  } catch (error) {
    const r = toActionError(error);
    return r.ok ? r : { ...r, values };
  }
}

export async function changeRoleAction(staffUserId: string, _: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const { shell, actor } = await manager();
    if (!UUID.test(staffUserId)) throw new ValidationError("Choose a person.");
    const role = String(form.get("role") ?? "");
    if (role === "owner" && !shell.permissions.has("billing.manage")) throw new RuleViolationError("team.owner", "Only an owner can make someone an owner.");
    await withTransaction(shell.clinic, (tx) =>
      setStaffRole(tx, { staffUserId, locationId: shell.location.id, role, actor, selfId: shell.access.staffUserId }),
    );
  } catch (error) {
    return toActionError(error);
  }
  revalidatePath("/team");
  return { ok: true, message: "Role updated." };
}

export async function setStatusAction(staffUserId: string, status: "active" | "disabled"): Promise<ActionResult> {
  try {
    const { shell, actor } = await manager();
    if (!UUID.test(staffUserId)) throw new ValidationError("Choose a person.");
    await withTransaction(shell.clinic, (tx) =>
      setStaffStatus(tx, { staffUserId, locationId: shell.location.id, status: status === "disabled" ? "disabled" : "active", actor, selfId: shell.access.staffUserId }),
    );
  } catch (error) {
    return toActionError(error);
  }
  revalidatePath("/team");
  return { ok: true, message: status === "disabled" ? "Access turned off." : "Access turned back on." };
}
