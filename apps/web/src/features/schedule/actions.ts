"use server";

// Server actions for the schedule: find a pet, list free times, book, cancel
// and reschedule. Each checks the person's permission at the active location.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  checkEligibility,
  dateRange,
  findSlots,
  ForbiddenError,
  localParts,
  offerTwo,
  ValidationError,
  type Permission,
} from "@vetrix/domain";
import {
  bookAppointment,
  cancelAppointment,
  loadPatientForBooking,
  loadSchedulingData,
  loadService,
  rescheduleAppointment,
  searchPatients,
  withTransaction,
  type Actor,
} from "@vetrix/db/runtime";
import { toActionError, type ActionResult } from "@/lib/action-result";
import { clinicToday } from "@/lib/clinic-date";
import { requireShell } from "@/lib/session";

async function allowed(permission: Permission) {
  const shell = await requireShell();
  if (!shell.permissions.has(permission)) throw new ForbiddenError();
  const actor: Actor = { type: "staff", id: shell.access.staffUserId };
  return { shell, actor };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function uuid(v: unknown, what: string): string {
  if (typeof v !== "string" || !UUID.test(v)) throw new ValidationError(`Choose a ${what}.`);
  return v;
}

export interface PetOption {
  id: string;
  name: string;
  species: string;
  breed: string | null;
  owner: string;
}

export async function findPetsAction(q: string): Promise<PetOption[]> {
  const { shell } = await allowed("schedule.manage");
  if (q.trim().length < 2) return [];
  const { rows } = await searchPatients(shell.clinic, shell.location.id, { q, limit: 8 });
  return rows.map((p) => ({ id: p.id, name: p.name, species: p.species, breed: p.breed, owner: p.owner_name }));
}

export interface SlotOption {
  start: number;
  end: number;
  providerId: string;
  providerName: string;
  roomName: string | null;
}

export type SlotsResult =
  | { ok: true; slots: SlotOption[]; suggested: number[]; warnings: string[]; blocked: string | null }
  | { ok: false; error: string };

/** Free times for a pet and service on one clinic date (optionally with one provider). */
export async function slotsAction(input: {
  patientId: string;
  serviceId: string;
  date: string;
  providerId?: string;
  /** When moving a visit, its own current time counts as free. */
  rescheduleId?: string;
}): Promise<SlotsResult> {
  try {
    const { shell } = await allowed("schedule.manage");
    if (!ISO_DATE.test(input.date)) throw new ValidationError("Choose a day.");
    const loc = shell.location.id;
    const [service, patient, data] = await Promise.all([
      loadService(shell.clinic, loc, uuid(input.serviceId, "service")),
      loadPatientForBooking(shell.clinic, loc, uuid(input.patientId, "pet")),
      loadSchedulingData(shell.clinic, loc, input.date, 1, {
        excludeAppointmentId: input.rescheduleId && UUID.test(input.rescheduleId) ? input.rescheduleId : undefined,
      }),
    ]);
    const today = clinicToday(shell.location.timezone);
    const eligibility = checkEligibility(service, patient, today);
    const warnings = eligibility.warnings.map((w) => w.message);
    if (eligibility.blocking.length > 0) return { ok: true, slots: [], suggested: [], warnings, blocked: eligibility.blocking[0]!.message };
    const slots = findSlots(data, {
      service,
      patient,
      dates: [input.date],
      notBefore: Date.now() + 5 * 60_000,
      providerId: input.providerId && UUID.test(input.providerId) ? input.providerId : undefined,
      limit: 200,
    });
    const names = new Map(data.providers.map((p) => [p.id, p.name]));
    const rooms = new Map(data.rooms.map((r) => [r.id, r.name]));
    return {
      ok: true,
      slots: slots.map((s) => ({ start: s.start, end: s.end, providerId: s.providerId, providerName: names.get(s.providerId) ?? "", roomName: s.roomId ? (rooms.get(s.roomId) ?? null) : null })),
      suggested: offerTwo(slots, shell.location.timezone).map((s) => s.start),
      warnings,
      blocked: null,
    };
  } catch (error) {
    const r = toActionError(error);
    return { ok: false, error: r.ok ? "Something went wrong." : r.error };
  }
}

/** The next days with at least one free time, for quick picking. */
export async function nextOpenDaysAction(input: { patientId: string; serviceId: string; from: string }): Promise<string[]> {
  const { shell } = await allowed("schedule.manage");
  if (!ISO_DATE.test(input.from)) return [];
  const loc = shell.location.id;
  const [service, patient, data] = await Promise.all([
    loadService(shell.clinic, loc, uuid(input.serviceId, "service")),
    loadPatientForBooking(shell.clinic, loc, uuid(input.patientId, "pet")),
    loadSchedulingData(shell.clinic, loc, input.from, 21),
  ]);
  if (checkEligibility(service, patient, clinicToday(shell.location.timezone)).blocking.length > 0) return [];
  const days = new Set<string>();
  for (const date of dateRange(input.from, 21)) {
    if (findSlots(data, { service, patient, dates: [date], notBefore: Date.now() + 5 * 60_000, limit: 1 }).length > 0) days.add(date);
    if (days.size >= 6) break;
  }
  return [...days];
}

export async function bookAction(_: ActionResult | null, f: FormData): Promise<ActionResult> {
  let date: string;
  let id: string;
  let moved = false;
  try {
    const { shell, actor } = await allowed("schedule.manage");
    const start = Number(f.get("start"));
    if (!Number.isFinite(start)) throw new ValidationError("Choose a time.");
    const reschedule = f.get("rescheduleId");
    moved = Boolean(reschedule);
    const today = clinicToday(shell.location.timezone);
    const providerId = typeof f.get("providerId") === "string" && UUID.test(String(f.get("providerId"))) ? String(f.get("providerId")) : null;
    const result = await withTransaction(shell.clinic, (tx) =>
      reschedule
        ? rescheduleAppointment(tx, { locationId: shell.location.id, appointmentId: uuid(reschedule, "visit"), start, providerId, actor, today })
        : bookAppointment(tx, {
            locationId: shell.location.id,
            patientId: uuid(f.get("patientId"), "pet"),
            serviceId: uuid(f.get("serviceId"), "service"),
            start,
            providerId,
            bookedBy: "staff",
            actor,
            reasonText: String(f.get("reason") ?? "").trim() || null,
            notesForStaff: String(f.get("notes") ?? "").trim() || null,
            today,
          }),
    );
    date = localParts(result.slot.start, shell.location.timezone).date;
    id = result.appointmentId;
  } catch (error) {
    return toActionError(error);
  }
  revalidatePath("/schedule");
  revalidatePath("/overview");
  redirect(`/schedule?date=${date}&visit=${id}&${moved ? "moved" : "booked"}=1`);
}

export async function cancelAction(appointmentId: string, date: string, _: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const { shell, actor } = await allowed("schedule.manage");
    const reason = String(f.get("reason") ?? "").trim();
    if (!reason) throw new ValidationError("Choose a reason.", { field: "reason" });
    await withTransaction(shell.clinic, (tx) =>
      cancelAppointment(tx, { locationId: shell.location.id, appointmentId: uuid(appointmentId, "visit"), reason, actor, lateCancel: f.get("late") === "on" }),
    );
  } catch (error) {
    return toActionError(error);
  }
  revalidatePath("/schedule");
  revalidatePath("/overview");
  redirect(`/schedule?date=${ISO_DATE.test(date) ? date : ""}&cancelled=1`);
}
