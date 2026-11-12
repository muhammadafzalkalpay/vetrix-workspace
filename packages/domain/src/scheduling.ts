// Finding bookable slots. Pure: everything the rules need is passed in, so
// the same function serves staff booking, online booking and the AI, and can
// be re-run inside the booking transaction to confirm a slot is still free.
import { ageInMonths, type Species, type TemperamentFlag } from "./clients";
import { localParts, timeToMinutes, weekdayOf, zonedInstant } from "./time";

const MINUTE = 60_000;

// ---------- Inputs ----------

export type ProviderRole = "dvm" | "technician" | "assistant" | "csr" | "manager";
export type RoomType = "exam" | "cat_exam" | "surgery" | "dental" | "radiology" | "treatment" | "comfort" | "isolation" | "kennel";

export interface ServiceRules {
  id: string;
  packServiceId: string;
  name: string;
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  providerRole: ProviderRole | null;
  /** Other roles that may also do it (pack also_bookable_by_roles). */
  alsoRoles: ProviderRole[];
  roomType: RoomType | null;
  equipment: { type: string; quantity: number }[];
  skills: string[];
  species: Species[];
  requiresDoctorOnPremises: boolean;
  dropOff: boolean;
  /** "07:00-08:30": drop-off procedures start inside this window. */
  dropOffWindow: string | null;
  prerequisites: Record<string, unknown>;
  active: boolean;
}

export interface ProviderInfo {
  id: string;
  name: string;
  role: ProviderRole;
  bookable: boolean;
  maxConcurrent: number;
  skills: string[];
  /** weekday (0 = Sunday) -> working periods in local minutes. */
  schedule: Map<number, { start: number; end: number }[]>;
  /** Blocked instants (leave, meetings). */
  blocked: { start: number; end: number }[];
}

export interface RoomInfo {
  id: string;
  name: string;
  type: RoomType;
  capacity: number;
}

export interface EquipmentUnit {
  id: string;
  type: string;
  exclusive: boolean;
}

/** A resource already held by another appointment. */
export interface Hold {
  providerId?: string | null;
  roomId?: string | null;
  equipmentId?: string | null;
  start: number;
  end: number;
}

export interface ClinicCalendar {
  timezone: string;
  /** weekday -> opening hours in local minutes; missing = closed. */
  hours: Map<number, { open: number; close: number }>;
  /** Closed dates, YYYY-MM-DD. */
  holidays: Set<string>;
  slotMinutes: number;
  temperamentBufferMin: number;
}

export interface PatientForBooking {
  species: Species;
  sex: "male" | "female" | null;
  neutered: boolean | null;
  dateOfBirth: string | null;
  approxAgeMonths: number | null;
  temperamentFlags: TemperamentFlag[];
  activePrescriptions?: boolean;
}

export interface Slot {
  start: number;
  end: number;
  /** Including buffers: what the resources are held for. */
  holdStart: number;
  holdEnd: number;
  providerId: string;
  roomId: string | null;
  equipmentIds: string[];
}

// ---------- Eligibility ----------

const EXOTIC: Species[] = ["rabbit", "bird", "reptile", "other"];

export interface Eligibility {
  /** Rules that make the booking impossible. */
  blocking: { ruleId: string; message: string }[];
  /** Things staff should check but may book anyway (e.g. doctor ordered). */
  warnings: { ruleId: string; message: string }[];
}

/**
 * Whether this pet can have this service at all, from the pack's species
 * list and prerequisites. Clinical history checks (doctor ordered, recent
 * visit) are warnings for staff; the AI treats them as blocking.
 */
export function checkEligibility(service: ServiceRules, patient: PatientForBooking, today: string): Eligibility {
  const blocking: Eligibility["blocking"] = [];
  const warnings: Eligibility["warnings"] = [];
  if (!service.active) blocking.push({ ruleId: "service.inactive", message: `${service.name} is not offered at this location.` });
  if (!service.species.includes(patient.species)) {
    blocking.push({ ruleId: "service.species", message: `${service.name} is not offered for a ${patient.species}.` });
  }
  const p = service.prerequisites;
  if (typeof p.sex === "string" && patient.sex && patient.sex !== p.sex) {
    blocking.push({ ruleId: "prereq.sex", message: `${service.name} is for ${p.sex} pets.` });
  }
  if (p.neutered === false && patient.neutered === true) {
    blocking.push({ ruleId: "prereq.neutered", message: "This pet is already spayed or neutered." });
  }
  const age = ageInMonths({ dateOfBirth: patient.dateOfBirth, approxAgeMonths: patient.approxAgeMonths }, today);
  if (typeof p.max_age_months === "number" && age != null && age > p.max_age_months) {
    blocking.push({ ruleId: "prereq.max_age", message: `${service.name} is for pets up to ${p.max_age_months} months old.` });
  }
  const minAge = p.min_age_years as Partial<Record<Species, number>> | undefined;
  const minYears = minAge?.[patient.species];
  if (typeof minYears === "number" && age != null && age < minYears * 12) {
    blocking.push({ ruleId: "prereq.min_age", message: `${service.name} is for ${patient.species}s aged ${minYears} or older.` });
  }
  if (p.active_prescriptions === true && patient.activePrescriptions === false) {
    warnings.push({ ruleId: "prereq.prescription", message: "No active prescription is on file for this injection." });
  }
  if (p.doctor_ordered === true) warnings.push({ ruleId: "prereq.doctor_ordered", message: "A doctor must have ordered this." });
  for (const key of ["completed_visit_within_days", "wellness_exam_within_months", "surgery_within_days"]) {
    if (p[key] !== undefined) warnings.push({ ruleId: `prereq.${key}`, message: prerequisiteMessage(key, p[key]) });
  }
  return { blocking, warnings };
}

function prerequisiteMessage(key: string, value: unknown): string {
  switch (key) {
    case "completed_visit_within_days":
      return `Needs a completed visit in the last ${value} days.`;
    case "wellness_exam_within_months":
      return `Needs a wellness exam in the last ${value} months.`;
    case "surgery_within_days":
      return `Is for pets who had surgery in the last ${value} days.`;
    default:
      return "Check the prerequisites.";
  }
}

// ---------- Slot finding ----------

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;

/** Room types that may stand in for the one a service asks for, best first. */
export function roomCandidates(roomType: RoomType | null, species: Species, flags: TemperamentFlag[]): RoomType[] {
  if (!roomType) return [];
  if (roomType === "exam" && (species === "cat" || flags.includes("fear_free"))) return species === "cat" ? ["cat_exam", "exam"] : ["exam"];
  if (roomType === "dental") return ["dental", "surgery"];
  if (roomType === "comfort") return ["comfort", "exam"];
  return [roomType];
}

function providerFree(p: ProviderInfo, window: { start: number; end: number }, holds: Hold[]): boolean {
  if (p.blocked.some((b) => overlaps(b, window))) return false;
  const busy = holds.filter((h) => h.providerId === p.id && overlaps(h, window)).length;
  return busy < Math.max(1, p.maxConcurrent);
}

function worksDuring(p: ProviderInfo, cal: ClinicCalendar, window: { start: number; end: number }): boolean {
  const a = localParts(window.start, cal.timezone);
  const b = localParts(window.end - MINUTE, cal.timezone);
  if (a.date !== b.date) return false;
  return (p.schedule.get(a.weekday) ?? []).some((s) => s.start <= a.minutes && b.minutes + 1 <= s.end);
}

export interface SlotRequest {
  service: ServiceRules;
  patient: PatientForBooking;
  /** Dates to search, YYYY-MM-DD in clinic time. */
  dates: string[];
  /** Earliest start allowed (e.g. now plus a short lead time). */
  notBefore: number;
  /** Only this provider, when the owner asked for someone. */
  providerId?: string;
  /** Stop after this many slots. */
  limit?: number;
}

export interface SchedulingData {
  calendar: ClinicCalendar;
  providers: ProviderInfo[];
  rooms: RoomInfo[];
  equipment: EquipmentUnit[];
  holds: Hold[];
}

/** Every bookable start for the request, earliest first, each with the resources it would use. */
export function findSlots(data: SchedulingData, req: SlotRequest): Slot[] {
  const cal = data.calendar;
  const { service: svc, patient } = req;
  const limit = req.limit ?? 50;
  const roles = new Set<ProviderRole>([...(svc.providerRole ? [svc.providerRole] : []), ...svc.alsoRoles]);
  const needSkills = [...svc.skills, ...(EXOTIC.includes(patient.species) ? ["exotics"] : [])];
  const providers = data.providers.filter(
    (p) =>
      p.bookable &&
      roles.has(p.role) &&
      needSkills.every((s) => p.skills.includes(s)) &&
      (!req.providerId || p.id === req.providerId),
  );
  if (providers.length === 0) return [];
  const doctors = data.providers.filter((p) => p.role === "dvm");
  const extra = patient.temperamentFlags.some((f) => f === "aggressive" || f === "anxious" || f === "needs_muzzle") ? cal.temperamentBufferMin : 0;
  const roomTypes = roomCandidates(svc.roomType, patient.species, patient.temperamentFlags);
  const windowLimits = svc.dropOff && svc.dropOffWindow ? svc.dropOffWindow.split("-").map(timeToMinutes) : null;
  const slots: Slot[] = [];

  for (const date of req.dates) {
    if (cal.holidays.has(date)) continue;
    const hours = cal.hours.get(weekdayOf(date));
    if (!hours) continue;
    const firstStart = windowLimits ? Math.max(hours.open, windowLimits[0]!) : hours.open;
    const lastStart = windowLimits ? Math.min(windowLimits[1]!, hours.close) : hours.close;
    for (let m = Math.ceil(firstStart / cal.slotMinutes) * cal.slotMinutes; m <= lastStart; m += cal.slotMinutes) {
      const start = zonedInstant(date, `${Math.floor(m / 60)}:${m % 60}`, cal.timezone);
      if (start < req.notBefore) continue;
      const end = start + svc.durationMin * MINUTE;
      const hold = { start: start - (svc.bufferBeforeMin + extra) * MINUTE, end: end + (svc.bufferAfterMin + extra) * MINUTE };
      // The visit itself must fit inside opening hours (buffers may run into closing time).
      const startLocal = localParts(start, cal.timezone).minutes;
      const endLocal = startLocal + svc.durationMin;
      if (startLocal < hours.open || endLocal > hours.close) continue;

      const slot = pickResources(data, svc, roomTypes, providers, doctors, hold, { start, end });
      if (slot) slots.push({ start, end, holdStart: hold.start, holdEnd: hold.end, ...slot });
      if (slots.length >= limit) return slots;
    }
  }
  return slots;
}

function pickResources(
  data: SchedulingData,
  svc: ServiceRules,
  roomTypes: RoomType[],
  providers: ProviderInfo[],
  doctors: ProviderInfo[],
  /** Visit plus buffers: checked against other bookings. */
  window: { start: number; end: number },
  /** The visit itself: must fall inside the provider's working hours. */
  visit: { start: number; end: number },
): Omit<Slot, "start" | "end" | "holdStart" | "holdEnd"> | null {
  const cal = data.calendar;
  const provider = providers.find((p) => worksDuring(p, cal, visit) && providerFree(p, window, data.holds));
  if (!provider) return null;

  if (svc.requiresDoctorOnPremises && provider.role !== "dvm") {
    const onSite = doctors.some((d) => worksDuring(d, cal, visit) && !d.blocked.some((b) => overlaps(b, visit)));
    if (!onSite) return null;
  }

  let roomId: string | null = null;
  if (roomTypes.length > 0) {
    const room = roomTypes
      .flatMap((t) => data.rooms.filter((r) => r.type === t))
      .find((r) => data.holds.filter((h) => h.roomId === r.id && overlaps(h, window)).length < r.capacity);
    if (!room) return null;
    roomId = room.id;
  }

  const equipmentIds: string[] = [];
  for (const need of svc.equipment) {
    const free = data.equipment.filter(
      (u) => u.type === need.type && (!u.exclusive || !data.holds.some((h) => h.equipmentId === u.id && overlaps(h, window))),
    );
    if (free.length < need.quantity) return null;
    equipmentIds.push(...free.slice(0, need.quantity).map((u) => u.id));
  }
  return { providerId: provider.id, roomId, equipmentIds };
}

/**
 * Two good options to offer a caller: the earliest slot, and the earliest one
 * on the other half of the day (morning vs afternoon), so the owner has a real choice.
 */
export function offerTwo(slots: Slot[], timezone: string): Slot[] {
  const first = slots[0];
  if (!first) return [];
  const firstPart = localParts(first.start, timezone);
  const morning = firstPart.minutes < 12 * 60;
  const other = slots.find((s) => {
    const p = localParts(s.start, timezone);
    return p.date === firstPart.date ? p.minutes < 12 * 60 !== morning : true;
  });
  return other ? [first, other] : [first];
}
