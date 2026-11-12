// Turns a signed-in person into "who they are, which organization they are
// working in, and what they may do at each location". Every staff screen and
// staff API starts here.
import type { Membership, SqlClient } from "@vetrix/db/runtime";
import type { StaffAccess } from "@vetrix/domain";

export interface StaffContext {
  platformUserId: string;
  organization: Membership;
  /** Other organizations this person can switch to. */
  memberships: Membership[];
  access: StaffAccess;
  /** Pool for this organization's clinic database. */
  clinic: SqlClient;
}

export type StaffContextResult =
  | { status: "ok"; context: StaffContext }
  /** Signed in, but not active staff in any organization. */
  | { status: "no_access" }
  /** Belongs to several organizations and has not chosen one. */
  | { status: "choose_organization"; memberships: Membership[] };

export interface StaffContextDeps {
  memberships(platformUserId: string): Promise<Membership[]>;
  clinicFor(organizationId: string): Promise<SqlClient>;
  loadAccess(clinic: SqlClient, platformUserId: string): Promise<StaffAccess | undefined>;
}

export async function resolveStaffContext(
  deps: StaffContextDeps,
  session: { userId: string; activeOrganizationId?: string | null },
): Promise<StaffContextResult> {
  const memberships = await deps.memberships(session.userId);
  if (memberships.length === 0) return { status: "no_access" };

  const chosen =
    memberships.find((m) => m.organization_id === session.activeOrganizationId) ??
    (memberships.length === 1 ? memberships[0] : undefined);
  if (!chosen) return { status: "choose_organization", memberships };

  const clinic = await deps.clinicFor(chosen.organization_id);
  const access = await deps.loadAccess(clinic, session.userId);
  // A registry membership without an active staff record grants nothing.
  if (!access || access.locations.size === 0) return { status: "no_access" };

  return {
    status: "ok",
    context: { platformUserId: session.userId, organization: chosen, memberships, access, clinic },
  };
}
