"use server";

// Server actions for clients and pets. Each one: checks the person may do it
// at the active location, validates with @vetrix/domain, saves in one
// transaction, and records who did it.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ForbiddenError, type Permission, type Species } from "@vetrix/domain";
import {
  createClient,
  createPatient,
  markPatientDeceased,
  updateClient,
  updatePatient,
  withTransaction,
  type Actor,
} from "@vetrix/db/runtime";
import { formValues, toActionError, type ActionResult } from "@/lib/action-result";
import { checked, clientFromForm, optional, patientFromForm, text } from "./form-parse";
import { clinicToday } from "@/lib/clinic-date";
import { requireShell } from "@/lib/session";

async function allowed(permission: Permission) {
  const shell = await requireShell();
  if (!shell.permissions.has(permission)) throw new ForbiddenError();
  const actor: Actor = { type: "staff", id: shell.access.staffUserId };
  return { shell, actor };
}

export async function createClientAction(_: ActionResult | null, f: FormData): Promise<ActionResult> {
  let id: string;
  try {
    const { shell, actor } = await allowed("clients.manage");
    const client = clientFromForm(f);
    id = await withTransaction(shell.clinic, (tx) =>
      createClient(tx, { locationId: shell.location.id, client, source: "staff", actor, householdId: optional(f, "householdId") }),
    );
  } catch (error) {
    return { ...toActionError(error), values: formValues(f) } as ActionResult;
  }
  revalidatePath("/clients");
  redirect(`/clients/${id}?saved=1`);
}

export async function updateClientAction(clientId: string, _: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const { shell, actor } = await allowed("clients.manage");
    const client = clientFromForm(f);
    await withTransaction(shell.clinic, (tx) => updateClient(tx, { locationId: shell.location.id, clientId, client, actor }));
  } catch (error) {
    return { ...toActionError(error), values: formValues(f) } as ActionResult;
  }
  revalidatePath(`/clients/${clientId}`);
  redirect(`/clients/${clientId}?saved=1`);
}

export async function createPatientAction(clientId: string, _: ActionResult | null, f: FormData): Promise<ActionResult> {
  let id: string;
  try {
    const { shell, actor } = await allowed("patients.manage");
    const patient = patientFromForm(f, clinicToday(shell.location.timezone));
    id = await withTransaction(shell.clinic, (tx) => createPatient(tx, { locationId: shell.location.id, clientId, patient, actor }));
  } catch (error) {
    return { ...toActionError(error), values: formValues(f) } as ActionResult;
  }
  revalidatePath(`/clients/${clientId}`);
  redirect(`/patients/${id}?saved=1`);
}

export async function updatePatientAction(patientId: string, _: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const { shell, actor } = await allowed("patients.manage");
    const patient = patientFromForm(f, clinicToday(shell.location.timezone));
    await withTransaction(shell.clinic, (tx) => updatePatient(tx, { locationId: shell.location.id, patientId, patient, actor }));
  } catch (error) {
    return { ...toActionError(error), values: formValues(f) } as ActionResult;
  }
  revalidatePath(`/patients/${patientId}`);
  redirect(`/patients/${patientId}?saved=1`);
}

export async function markDeceasedAction(patientId: string, _: ActionResult | null, f: FormData): Promise<ActionResult> {
  let stopped: number;
  let upcoming: number;
  try {
    const { shell, actor } = await allowed("patients.manage");
    const species = text(f, "confirmedSpecies");
    const result = await withTransaction(shell.clinic, (tx) =>
      markPatientDeceased(tx, {
        locationId: shell.location.id,
        patientId,
        today: clinicToday(shell.location.timezone),
        actor,
        confirmation: {
          confirmedName: text(f, "confirmedName"),
          confirmedSpecies: species as Species,
          deathConfirmed: checked(f, "deathConfirmed"),
          deceasedDate: text(f, "deceasedDate"),
        },
      }),
    );
    stopped = result.remindersStopped;
    upcoming = result.upcomingAppointments.length;
  } catch (error) {
    return { ...toActionError(error), values: formValues(f) } as ActionResult;
  }
  revalidatePath(`/patients/${patientId}`);
  redirect(`/patients/${patientId}?deceased=1&stopped=${stopped}&upcoming=${upcoming}`);
}
