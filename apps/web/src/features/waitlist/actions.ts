"use server";

import { revalidatePath } from "next/cache";
import { ForbiddenError, ValidationError } from "@vetrix/domain";
import { addToWaitlist, removeFromWaitlist, withTransaction, type Actor } from "@vetrix/db/runtime";
import { toActionError, type ActionResult } from "@/lib/action-result";
import { requireShell } from "@/lib/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function manager() {
  const shell = await requireShell();
  if (!shell.permissions.has("schedule.manage")) throw new ForbiddenError();
  const actor: Actor = { type: "staff", id: shell.access.staffUserId };
  return { shell, actor };
}

export async function addWaitlistAction(input: { patientId: string; serviceId: string; providerId: string }): Promise<ActionResult> {
  try {
    const { shell, actor } = await manager();
    if (!UUID.test(input.patientId)) throw new ValidationError("Choose a pet.", { field: "patientId" });
    if (!UUID.test(input.serviceId)) throw new ValidationError("Choose a service.", { field: "serviceId" });
    const providerId = UUID.test(input.providerId) ? input.providerId : null;
    await withTransaction(shell.clinic, (tx) => addToWaitlist(tx, { locationId: shell.location.id, patientId: input.patientId, serviceId: input.serviceId, preferredProviderId: providerId, actor }));
  } catch (error) {
    return toActionError(error);
  }
  revalidatePath("/waitlist");
  return { ok: true, message: "Added to the waitlist. They'll be offered the next matching time that opens up." };
}

export async function removeWaitlistAction(entryId: string): Promise<ActionResult> {
  try {
    const { shell, actor } = await manager();
    if (!UUID.test(entryId)) throw new ValidationError("Choose an entry.");
    await withTransaction(shell.clinic, (tx) => removeFromWaitlist(tx, { locationId: shell.location.id, entryId, actor }));
  } catch (error) {
    return toActionError(error);
  }
  revalidatePath("/waitlist");
  return { ok: true, message: "Removed." };
}
