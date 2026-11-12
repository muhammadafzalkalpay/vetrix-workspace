// Server helpers for pages and route handlers:
//   const ctx = await requireStaff();                       // signed in + staff
//   requirePermission(ctx.access, "schedule.manage", locationId);
import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { listLocations, loadStaffAccess, membershipsFor, type LocationSummary } from "@vetrix/db/runtime";
import type { Permission } from "@vetrix/domain";
import { auth } from "./auth";
import { resolveStaffContext, type StaffContext, type StaffContextResult } from "./staff-context";
import { tenancy } from "./tenancy";

/**
 * Organization chosen by people who belong to several. Only a hint: it is
 * checked against their memberships on every request.
 */
export const ACTIVE_ORG_COOKIE = "vetrix.org";
/** Location chosen by people who work at several; checked like the organization. */
export const ACTIVE_LOCATION_COOKIE = "vetrix.location";

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
    { userId: session.user.id, activeOrganizationId: (await cookies()).get(ACTIVE_ORG_COOKIE)?.value },
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

export interface ShellContext extends StaffContext {
  locations: LocationSummary[];
  location: LocationSummary;
  /** What the person may do at the active location. */
  permissions: ReadonlySet<Permission>;
}

/** requireStaff plus the active location and its permissions. Cached per request. */
export const requireShell = cache(async (): Promise<ShellContext> => {
  const ctx = await requireStaff();
  const locations = await listLocations(ctx.clinic, [...ctx.access.locations.keys()]);
  const chosen = (await cookies()).get(ACTIVE_LOCATION_COOKIE)?.value;
  const location = locations.find((l) => l.id === chosen) ?? locations[0];
  if (!location) redirect("/no-access");
  return { ...ctx, locations, location, permissions: ctx.access.locations.get(location.id) ?? new Set() };
});
