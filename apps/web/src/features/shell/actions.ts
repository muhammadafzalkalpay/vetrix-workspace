"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACTIVE_LOCATION_COOKIE, requireStaff } from "@/lib/session";

/** Switches the location the person is working in. Refuses locations they cannot open. */
export async function chooseLocation(formData: FormData): Promise<void> {
  const locationId = String(formData.get("locationId") ?? "");
  const ctx = await requireStaff();
  if (!ctx.access.locations.has(locationId)) redirect("/overview");
  (await cookies()).set(ACTIVE_LOCATION_COOKIE, locationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/overview");
}
