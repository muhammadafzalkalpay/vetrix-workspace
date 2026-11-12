// Server helpers for pages and route handlers:
//   const ctx = await requireStaff();                       // signed in + staff
//   requirePermission(ctx.access, "schedule.manage", locationId);
import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { loadStaffAccess, membershipsFor } from "@vetrix/db/runtime";
import { auth } from "./auth";
import { resolveStaffContext, type StaffContext, type StaffContextResult } from "./staff-context";
import { tenancy } from "./tenancy";

/** The Better Auth session for this request, or null. Cached per request. */
export const getSession = cache(async () => auth().api.getSession({ headers: await headers() }));

export const getStaffContext = cache(async (): Promise<StaffContextResult | null> => {
  const session = await getSession();
  if (!session) return null;
  const t = tenancy();
  return resolveStaffContext(
    {
      memberships: (userId) => membershipsFor(t.registry, userId),
      clinicFor: async (organizationId) => (await t.clinicPool(organizationId)).pool,
      loadAccess: loadStaffAccess,
    },
    { userId: session.user.id, activeOrganizationId: session.session.activeOrganizationId },
  );
});

/** For staff pages: sends people who are not signed in or not staff elsewhere. */
export async function requireStaff(): Promise<StaffContext> {
  const result = await getStaffContext();
  if (!result) redirect("/sign-in");
  if (result.status === "no_access") redirect("/no-access");
  if (result.status === "choose_organization") redirect("/choose-organization");
  return result.context;
}
