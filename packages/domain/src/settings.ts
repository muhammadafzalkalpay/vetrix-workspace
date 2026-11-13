// Clinic settings: what staff may change and the rules for each value.
// Pure validation; the database layer saves what these return.
import { normalizePhone } from "./clients";
import { ValidationError } from "./errors";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const text = (v: unknown, field: string, label: string, opts: { required?: boolean; max?: number } = {}): string | null => {
  const t = typeof v === "string" ? v.trim() : "";
  if (!t) {
    if (opts.required) throw new ValidationError(`Enter ${label}.`, { field });
    return null;
  }
  if (t.length > (opts.max ?? 200)) throw new ValidationError(`Keep ${label} under ${opts.max ?? 200} characters.`, { field });
  return t;
};

const phone = (v: unknown, field: string, label: string, required = false): string | null => {
  const t = typeof v === "string" ? v.trim() : "";
  if (!t) {
    if (required) throw new ValidationError(`Enter ${label}.`, { field });
    return null;
  }
  try {
    return normalizePhone(t);
  } catch {
    throw new ValidationError(`Enter a valid US phone number for ${label}.`, { field });
  }
};

const money = (v: unknown, field: string, label: string): number | null => {
  const t = typeof v === "string" ? v.trim().replace(/^\$/, "") : "";
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > 100_000) throw new ValidationError(`Enter ${label} as an amount, like 25 or 25.50.`, { field });
  return Math.round(n * 100) / 100;
};

const int = (v: unknown, field: string, label: string, min: number, max: number): number => {
  const n = Number(typeof v === "string" ? v.trim() : v);
  if (!Number.isInteger(n) || n < min || n > max) throw new ValidationError(`${label} must be a whole number from ${min} to ${max}.`, { field });
  return n;
};

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface ClinicDetails {
  name: string;
  address: string | null;
  mainPhone: string | null;
  website: string | null;
  timezone: string;
}

export function validateClinicDetails(f: Record<string, unknown>): ClinicDetails {
  const timezone = text(f.timezone, "timezone", "a time zone", { required: true })!;
  if (!isTimeZone(timezone)) throw new ValidationError("Choose a time zone.", { field: "timezone" });
  const website = text(f.website, "website", "the website", { max: 200 });
  if (website && !/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(website)) throw new ValidationError("Enter the website starting with https://", { field: "website" });
  return {
    name: text(f.name, "name", "the clinic name", { required: true, max: 120 })!,
    address: text(f.address, "address", "the address", { max: 200 }),
    mainPhone: phone(f.mainPhone, "mainPhone", "the main phone"),
    website,
    timezone,
  };
}

export interface WeekHours {
  /** weekday 0 (Sunday) to 6: null when closed. */
  days: ({ opens: string; closes: string } | null)[];
}

export function validateWeekHours(f: Record<string, unknown>): WeekHours {
  const days: WeekHours["days"] = [];
  for (let d = 0; d < 7; d++) {
    if (f[`closed_${d}`] === "on") {
      days.push(null);
      continue;
    }
    const opens = String(f[`opens_${d}`] ?? "");
    const closes = String(f[`closes_${d}`] ?? "");
    if (!TIME.test(opens) || !TIME.test(closes)) throw new ValidationError("Enter opening and closing times, or mark the day closed.", { field: `opens_${d}` });
    if (closes <= opens) throw new ValidationError("Closing time must be after opening time.", { field: `closes_${d}` });
    days.push({ opens, closes });
  }
  if (days.every((d) => d === null)) throw new ValidationError("The clinic must be open at least one day.");
  return { days };
}

export interface FrontDeskSettings {
  aiName: string;
  emergencyTransferNumber: string | null;
  afterHoursBehaviour: "er_only" | "er_and_book_next";
  erName: string | null;
  erPhone: string | null;
  erAddress: string | null;
}

export function validateFrontDesk(f: Record<string, unknown>): FrontDeskSettings {
  const aiName = text(f.aiName, "aiName", "the assistant's name", { required: true, max: 30 })!;
  if (!/^[A-Za-z][A-Za-z' -]{1,29}$/.test(aiName)) throw new ValidationError("Use letters only for the assistant's name.", { field: "aiName" });
  const behaviour = f.afterHoursBehaviour === "er_only" ? "er_only" : "er_and_book_next";
  const er = {
    erName: text(f.erName, "erName", "the emergency hospital's name", { max: 120 }),
    erPhone: phone(f.erPhone, "erPhone", "the emergency hospital's phone"),
    erAddress: text(f.erAddress, "erAddress", "the emergency hospital's address", { max: 200 }),
  };
  const some = er.erName || er.erPhone || er.erAddress;
  if (some && !(er.erName && er.erPhone && er.erAddress)) {
    throw new ValidationError("Give the emergency hospital's name, phone and address, so callers get complete details.", { field: !er.erName ? "erName" : !er.erPhone ? "erPhone" : "erAddress" });
  }
  return {
    aiName,
    emergencyTransferNumber: phone(f.emergencyTransferNumber, "emergencyTransferNumber", "the emergency transfer number"),
    afterHoursBehaviour: behaviour,
    ...er,
  };
}

export interface PolicySettings {
  cancellationWindowHours: number;
  cancellationFee: number | null;
  surgeryDeposit: number | null;
  refillTurnaround: string | null;
  newClientPolicy: string | null;
  recordsReleasePolicy: string | null;
  recordingRetentionMonths: number;
  telehealthEnabled: boolean;
}

export function validatePolicies(f: Record<string, unknown>): PolicySettings {
  return {
    cancellationWindowHours: int(f.cancellationWindowHours, "cancellationWindowHours", "Cancellation notice", 0, 168),
    cancellationFee: money(f.cancellationFee, "cancellationFee", "the cancellation fee"),
    surgeryDeposit: money(f.surgeryDeposit, "surgeryDeposit", "the surgery deposit"),
    refillTurnaround: text(f.refillTurnaround, "refillTurnaround", "the refill turnaround", { max: 60 }),
    newClientPolicy: text(f.newClientPolicy, "newClientPolicy", "the new client policy", { max: 500 }),
    recordsReleasePolicy: text(f.recordsReleasePolicy, "recordsReleasePolicy", "the records policy", { max: 500 }),
    recordingRetentionMonths: int(f.recordingRetentionMonths, "recordingRetentionMonths", "Recording retention", 1, 120),
    telehealthEnabled: f.telehealthEnabled === "on",
  };
}

export interface MessagingSettingsInput {
  quietStart: string;
  quietEnd: string;
}

export function validateMessaging(f: Record<string, unknown>): MessagingSettingsInput {
  const quietStart = String(f.quietStart ?? "");
  const quietEnd = String(f.quietEnd ?? "");
  if (!TIME.test(quietStart)) throw new ValidationError("Enter when quiet hours start.", { field: "quietStart" });
  if (!TIME.test(quietEnd)) throw new ValidationError("Enter when quiet hours end.", { field: "quietEnd" });
  if (quietStart === quietEnd) throw new ValidationError("Quiet hours must start and end at different times.", { field: "quietEnd" });
  return { quietStart, quietEnd };
}

export function validateHoliday(f: Record<string, unknown>): { date: string; name: string | null } {
  const date = String(f.date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new ValidationError("Choose a date.", { field: "date" });
  return { date, name: text(f.name, "name", "the holiday name", { max: 60 }) };
}
