// Rules for clients (owners), households and patients (pets). Pure functions:
// no database, no framework. Entry points validate with these before saving.
import { RuleViolationError, ValidationError } from "./errors";

// ---------- Phones and email ----------

/**
 * Stores every phone the same way (E.164), so search, duplicate checks and
 * Twilio all agree. US and Canada numbers may be typed with or without +1.
 * Other countries must start with + and their country code.
 */
export function normalizePhone(input: string): string {
  const raw = input.trim();
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+")) {
    if (digits.length < 8 || digits.length > 15) throw new ValidationError("Enter a valid phone number.", { field: "phone" });
    return `+${digits}`;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  throw new ValidationError("Enter a 10-digit phone number, or start with + and the country code.", { field: "phone" });
}

/** "+15552913352" -> "(555) 291-3352"; other countries are shown as stored. */
export function formatPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

export function normalizeEmail(input: string | null | undefined): string | null {
  const email = input?.trim().toLowerCase();
  if (!email) return null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ValidationError("Enter a valid email address.", { field: "email" });
  return email;
}

function requiredName(value: string, field: string, label: string): string {
  const v = value.trim().replace(/\s+/g, " ");
  if (!v) throw new ValidationError(`Enter the ${label}.`, { field });
  if (v.length > 80) throw new ValidationError(`The ${label} is too long.`, { field });
  return v;
}

// ---------- Clients ----------

export const CLIENT_FLAGS = ["vip", "payment_issue", "difficult", "do_not_contact", "do_not_call"] as const;
export type ClientFlag = (typeof CLIENT_FLAGS)[number];
export const CHANNELS = ["sms", "email", "call"] as const;
export type Channel = (typeof CHANNELS)[number];
export type ClientSource = "phone_ai" | "web" | "import" | "staff";

export interface ClientInput {
  firstName: string;
  lastName: string;
  mobile: string;
  email?: string | null;
  altPhone?: string | null;
  address?: string | null;
  preferredChannel?: Channel;
  smsConsent?: boolean;
  marketingConsent?: boolean;
  notes?: string | null;
  flags?: ClientFlag[];
}

export interface ValidClient {
  firstName: string;
  lastName: string;
  mobile: string;
  email: string | null;
  altPhone: string | null;
  address: string | null;
  preferredChannel: Channel;
  smsConsent: boolean;
  marketingConsent: boolean;
  notes: string | null;
  flags: ClientFlag[];
}

const optionalText = (v: string | null | undefined, max = 500) => {
  const t = v?.trim();
  if (!t) return null;
  if (t.length > max) throw new ValidationError(`Keep this under ${max} characters.`);
  return t;
};

export function validateClient(input: ClientInput): ValidClient {
  const email = normalizeEmail(input.email);
  const preferredChannel = input.preferredChannel ?? "sms";
  if (!CHANNELS.includes(preferredChannel)) throw new ValidationError("Choose text, email or call.", { field: "preferredChannel" });
  if (preferredChannel === "email" && !email) {
    throw new ValidationError("Add an email address to use email as the preferred channel.", { field: "email" });
  }
  const flags = [...new Set(input.flags ?? [])];
  for (const f of flags) if (!CLIENT_FLAGS.includes(f)) throw new ValidationError(`Unknown flag "${f}".`, { field: "flags" });
  return {
    firstName: requiredName(input.firstName, "firstName", "first name"),
    lastName: requiredName(input.lastName, "lastName", "last name"),
    mobile: normalizePhone(input.mobile),
    email,
    altPhone: input.altPhone?.trim() ? normalizePhone(input.altPhone) : null,
    address: optionalText(input.address, 200),
    preferredChannel,
    smsConsent: input.smsConsent ?? false,
    marketingConsent: input.marketingConsent ?? false,
    notes: optionalText(input.notes, 2000),
    flags,
  };
}

/**
 * Whether Vetrix may contact this client on a channel at all. STOP (no SMS
 * consent) blocks texts; do_not_contact blocks everything; do_not_call blocks calls.
 */
export function canContact(
  client: { smsConsent: boolean; email: string | null; flags: readonly ClientFlag[] },
  channel: Channel,
): boolean {
  if (client.flags.includes("do_not_contact")) return false;
  if (channel === "sms") return client.smsConsent;
  if (channel === "email") return client.email !== null;
  return !client.flags.includes("do_not_call");
}

// ---------- Patients ----------

export const SPECIES = ["dog", "cat", "rabbit", "bird", "reptile", "other"] as const;
export type Species = (typeof SPECIES)[number];
export const TEMPERAMENT_FLAGS = ["anxious", "aggressive", "needs_muzzle", "cat_carrier_required", "fear_free"] as const;
export type TemperamentFlag = (typeof TEMPERAMENT_FLAGS)[number];
export type PatientStatus = "active" | "deceased" | "transferred" | "inactive";

export interface PatientInput {
  name: string;
  species: Species;
  breed?: string | null;
  sex?: "male" | "female" | null;
  neutered?: boolean | null;
  /** ISO date, e.g. "2021-04-30". Give this or approxAgeMonths, not both. */
  dateOfBirth?: string | null;
  approxAgeMonths?: number | null;
  weightKg?: number | null;
  colorMarkings?: string | null;
  microchipNumber?: string | null;
  medicalAlerts?: string | null;
  temperamentFlags?: TemperamentFlag[];
}

export interface ValidPatient {
  name: string;
  species: Species;
  breed: string | null;
  sex: "male" | "female" | null;
  neutered: boolean | null;
  dateOfBirth: string | null;
  approxAgeMonths: number | null;
  weightKg: number | null;
  colorMarkings: string | null;
  microchipNumber: string | null;
  medicalAlerts: string | null;
  temperamentFlags: TemperamentFlag[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value: string, field: string): Date {
  const d = new Date(`${value}T00:00:00Z`);
  if (!ISO_DATE.test(value) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new ValidationError("Enter a valid date.", { field });
  }
  return d;
}

/** `today` is the clinic's date (YYYY-MM-DD), so the rule does not depend on the server clock. */
export function validatePatient(input: PatientInput, today: string): ValidPatient {
  if (!SPECIES.includes(input.species)) throw new ValidationError("Choose a species.", { field: "species" });
  let dateOfBirth: string | null = null;
  if (input.dateOfBirth) {
    if (input.approxAgeMonths != null) {
      throw new ValidationError("Give a date of birth or an approximate age, not both.", { field: "dateOfBirth" });
    }
    const dob = parseDate(input.dateOfBirth, "dateOfBirth");
    if (dob > parseDate(today, "today")) throw new ValidationError("The date of birth cannot be in the future.", { field: "dateOfBirth" });
    if (dob.getUTCFullYear() < 1980) throw new ValidationError("Check the date of birth.", { field: "dateOfBirth" });
    dateOfBirth = input.dateOfBirth;
  }
  const approx = input.approxAgeMonths;
  if (approx != null && (!Number.isInteger(approx) || approx < 0 || approx > 480)) {
    throw new ValidationError("Enter the approximate age in whole months.", { field: "approxAgeMonths" });
  }
  const weight = input.weightKg;
  if (weight != null && (!(weight > 0) || weight > 150)) throw new ValidationError("Enter a weight between 0 and 150 kg.", { field: "weightKg" });
  const chip = input.microchipNumber?.replace(/\s/g, "") || null;
  if (chip && !/^\d{9,15}$/.test(chip)) throw new ValidationError("A microchip number has 9 to 15 digits.", { field: "microchipNumber" });
  const temperamentFlags = [...new Set(input.temperamentFlags ?? [])];
  for (const f of temperamentFlags) if (!TEMPERAMENT_FLAGS.includes(f)) throw new ValidationError(`Unknown flag "${f}".`);
  return {
    name: requiredName(input.name, "name", "pet's name"),
    species: input.species,
    breed: optionalText(input.breed, 80),
    sex: input.sex ?? null,
    neutered: input.neutered ?? null,
    dateOfBirth,
    approxAgeMonths: approx ?? null,
    weightKg: weight ?? null,
    colorMarkings: optionalText(input.colorMarkings, 120),
    microchipNumber: chip,
    medicalAlerts: optionalText(input.medicalAlerts, 1000),
    temperamentFlags,
  };
}

/** Age in whole months on `today`, from the date of birth or the approximate age. */
export function ageInMonths(p: { dateOfBirth: string | null; approxAgeMonths: number | null }, today: string): number | null {
  if (p.dateOfBirth) {
    const [by, bm, bd] = p.dateOfBirth.split("-").map(Number) as [number, number, number];
    const [ty, tm, td] = today.split("-").map(Number) as [number, number, number];
    return Math.max(0, (ty - by) * 12 + (tm - bm) - (td < bd ? 1 : 0));
  }
  return p.approxAgeMonths;
}

/** "3 months", "1 year", "6 years". */
export function formatAge(months: number | null): string {
  if (months == null) return "Age unknown";
  if (months < 12) return `${months} month${months === 1 ? "" : "s"}`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? "" : "s"}`;
}

// ---------- Deceased (pack v0.2) ----------

export interface DeceasedConfirmation {
  /** The pet's name as the person confirmed it. */
  confirmedName: string;
  confirmedSpecies: Species;
  /** The death itself was confirmed (not "very sick", "might not make it"). */
  deathConfirmed: boolean;
  deceasedDate: string;
}

/**
 * A pet is marked deceased only after the death, the pet's name and the
 * species are all confirmed (pack v0.2). Throws if any of them does not match.
 */
export function confirmDeceased(
  patient: { name: string; species: Species; status: PatientStatus },
  c: DeceasedConfirmation,
  today: string,
): { deceasedDate: string } {
  if (patient.status === "deceased") throw new RuleViolationError("deceased.already", "This pet is already marked as deceased.");
  if (!c.deathConfirmed) throw new RuleViolationError("deceased.not_confirmed", "Confirm the pet has died before marking it deceased.");
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  if (!same(c.confirmedName, patient.name)) {
    throw new RuleViolationError("deceased.name_mismatch", `The name given does not match ${patient.name}. Check you have the right pet.`);
  }
  if (c.confirmedSpecies !== patient.species) {
    throw new RuleViolationError("deceased.species_mismatch", `${patient.name} is recorded as a ${patient.species}. Check you have the right pet.`);
  }
  const date = parseDate(c.deceasedDate, "deceasedDate");
  if (date > parseDate(today, "today")) throw new ValidationError("The date cannot be in the future.", { field: "deceasedDate" });
  return { deceasedDate: c.deceasedDate };
}
