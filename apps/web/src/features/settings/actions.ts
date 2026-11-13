"use server";

// Saving clinic settings. Only people with settings.manage at the active location.
import { revalidatePath } from "next/cache";
import {
  ForbiddenError,
  validateClinicDetails,
  validateFrontDesk,
  validateHoliday,
  validateMessaging,
  validatePolicies,
  validateWeekHours,
  ValidationError,
} from "@vetrix/domain";
import {
  addHoliday,
  removeHoliday,
  saveClinicDetails,
  saveFrontDesk,
  saveMessaging,
  savePolicies,
  saveWeekHours,
  setReminderRuleEnabled,
  setServiceActive,
  withTransaction,
  type Actor,
  type SqlClient,
} from "@vetrix/db/runtime";
import { formValues, toActionError, type ActionResult } from "@/lib/action-result";
import { requireShell } from "@/lib/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RULE_ID = /^[a-z_]{2,60}$/;

type Ctx = { locationId: string; actor: Actor };

/** Checks permission, runs the save in a transaction, refreshes the page. */
async function save(form: FormData | null, message: string, run: (tx: SqlClient, ctx: Ctx, values: Record<string, unknown>) => Promise<void>): Promise<ActionResult> {
  const values = form ? formValues(form) : {};
  try {
    const shell = await requireShell();
    if (!shell.permissions.has("settings.manage")) throw new ForbiddenError();
    const ctx: Ctx = { locationId: shell.location.id, actor: { type: "staff", id: shell.access.staffUserId } };
    await withTransaction(shell.clinic, (tx) => run(tx, ctx, values));
  } catch (error) {
    const r = toActionError(error);
    return r.ok ? r : { ...r, values };
  }
  // The clinic name and time zone show across the app.
  revalidatePath("/", "layout");
  return { ok: true, message };
}

export async function saveDetailsAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return save(form, "Clinic details saved.", (tx, ctx, v) => saveClinicDetails(tx, ctx, validateClinicDetails(v)));
}

export async function saveHoursAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return save(form, "Opening hours saved. Riley and online booking use them now.", (tx, ctx, v) => saveWeekHours(tx, ctx, validateWeekHours(v)));
}

export async function addHolidayAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return save(form, "Closed day added.", (tx, ctx, v) => addHoliday(tx, ctx, validateHoliday(v)));
}

export async function removeHolidayAction(holidayId: string): Promise<ActionResult> {
  return save(null, "Closed day removed.", (tx, ctx) => {
    if (!UUID.test(holidayId)) throw new ValidationError("Choose a closed day.");
    return removeHoliday(tx, ctx, holidayId);
  });
}

export async function saveFrontDeskAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return save(form, "Front desk settings saved.", (tx, ctx, v) => saveFrontDesk(tx, ctx, validateFrontDesk(v)));
}

export async function savePoliciesAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return save(form, "Policies saved.", (tx, ctx, v) => savePolicies(tx, ctx, validatePolicies(v)));
}

export async function saveMessagingAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return save(form, "Quiet hours saved.", (tx, ctx, v) => saveMessaging(tx, ctx, validateMessaging(v)));
}

export async function setReminderRuleAction(ruleId: string, enabled: boolean): Promise<ActionResult> {
  return save(null, enabled ? "Reminder turned on." : "Reminder turned off.", (tx, ctx) => {
    if (!RULE_ID.test(ruleId)) throw new ValidationError("Choose a reminder.");
    return setReminderRuleEnabled(tx, ctx, ruleId, enabled);
  });
}

export async function setServiceActiveAction(serviceId: string, active: boolean): Promise<ActionResult> {
  return save(null, active ? "Service turned on." : "Service turned off.", (tx, ctx) => {
    if (!UUID.test(serviceId)) throw new ValidationError("Choose a service.");
    return setServiceActive(tx, ctx, serviceId, active);
  });
}
