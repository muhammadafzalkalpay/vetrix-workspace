"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getStaffContext, ACTIVE_ORG_COOKIE } from "@/lib/session";

/** Opens one of the person's organizations. Refuses any they do not belong to. */
export async function chooseOrganization(formData: FormData): Promise<void> {
  const organizationId = String(formData.get("organizationId") ?? "");
  const result = await getStaffContext();
  if (!result) redirect("/sign-in");
  const memberships =
    result.status === "choose_organization" ? result.memberships : result.status === "ok" ? result.context.memberships : [];
  if (!memberships.some((m) => m.organization_id === organizationId)) redirect("/choose-organization");
  (await cookies()).set(ACTIVE_ORG_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/overview");
}
