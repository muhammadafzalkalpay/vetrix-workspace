// Plans an import of clients, pets and vaccines from a clinic's CSV export.
// Pure: it decides what would be created, matched, skipped or rejected, and
// why, without touching the database. The importer then saves the plan.
import { ValidationError, isDomainError } from "./errors";
import {
  CLIENT_FLAGS,
  TEMPERAMENT_FLAGS,
  validateClient,
  validatePatient,
  type Channel,
  type ClientFlag,
  type Species,
  type TemperamentFlag,
  type ValidClient,
  type ValidPatient,
} from "./clients";

export type CsvRow = Record<string, string>;

// ---------- Headers ----------

/** Other names clinics' systems use for our columns. */
const ALIASES: Record<string, string> = {
  client_id: "id", clientid: "id", owner_id: "id", customer_id: "id",
  firstname: "first_name", first: "first_name", given_name: "first_name",
  lastname: "last_name", last: "last_name", surname: "last_name", family_name: "last_name",
  phone: "mobile", mobile_phone: "mobile", cell: "mobile", cell_phone: "mobile", phone_number: "mobile", primary_phone: "mobile",
  email_address: "email", e_mail: "email",
  household: "household_id",
  patient_id: "id", pet_id: "id", animal_id: "id",
  owner: "client_id", owner_client_id: "client_id",
  pet_name: "name", patient_name: "name", animal_name: "name",
  dob: "date_of_birth", birth_date: "date_of_birth", birthdate: "date_of_birth",
  weight: "weight_kg", microchip: "microchip_number", chip: "microchip_number",
  vaccine: "vaccine_id", given: "administered_at", date_given: "administered_at", due: "due_at", next_due: "due_at",
};

export function normalizeHeader(header: string): string {
  const h = header.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return ALIASES[h] ?? h;
}

/** Renames columns to ours; the patients file's "id" vs "client_id" are resolved per file. */
export function normalizeRows(rows: CsvRow[], file: "clients" | "patients" | "vaccines"): CsvRow[] {
  return rows.map((row) => {
    const out: CsvRow = {};
    for (const [key, value] of Object.entries(row)) {
      let k = normalizeHeader(key);
      // In the patients file an "owner"/"client" id column means client_id, not the pet's id.
      if (file === "patients" && /^(client_id|clientid|owner_id|customer_id)$/.test(key.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"))) k = "client_id";
      if (file === "vaccines" && /^(patient_id|pet_id|animal_id)$/.test(key.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"))) k = "patient_id";
      out[k] = value;
    }
    return out;
  });
}

export const REQUIRED_COLUMNS = {
  clients: ["id", "first_name", "last_name", "mobile"],
  patients: ["id", "client_id", "name", "species"],
  vaccines: ["patient_id", "vaccine_id", "administered_at", "due_at"],
} as const;

/** Missing required columns, by our names, or [] when the file is usable. */
export function missingColumns(rows: CsvRow[], file: keyof typeof REQUIRED_COLUMNS): string[] {
  const have = new Set(Object.keys(rows[0] ?? {}));
  return REQUIRED_COLUMNS[file].filter((c) => !have.has(c));
}

// ---------- Values ----------

const yes = (v: string | undefined) => /^(true|yes|y|1|t)$/i.test(v?.trim() ?? "");
const blank = (v: string | undefined) => !v || !v.trim();
const list = (v: string | undefined) => (v ?? "").split(/[;|,]/).map((s) => s.trim().toLowerCase()).filter(Boolean);

const SPECIES_WORDS: Record<string, Species> = {
  dog: "dog", canine: "dog", k9: "dog", puppy: "dog",
  cat: "cat", feline: "cat", kitten: "cat",
  rabbit: "rabbit", bunny: "rabbit", lagomorph: "rabbit",
  bird: "bird", avian: "bird", parrot: "bird",
  reptile: "reptile", lizard: "reptile", snake: "reptile", turtle: "reptile", tortoise: "reptile",
  other: "other", exotic: "other", ferret: "other", guinea_pig: "other", hamster: "other",
};

export function parseSpecies(v: string): Species | null {
  return SPECIES_WORDS[v.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")] ?? null;
}

/** Accepts 2021-04-30, 04/30/2021 and 4/30/21 (US order). Returns YYYY-MM-DD or null. */
export function parseDate(v: string | undefined): string | null {
  const s = v?.trim();
  if (!s) return null;
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s))) {
    [m, d, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (y < 100) y += y > 50 ? 1900 : 2000;
  } else throw new ValidationError(`"${s}" is not a date. Use YYYY-MM-DD or MM/DD/YYYY.`);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new ValidationError(`"${s}" is not a real date.`);
  }
  return date.toISOString().slice(0, 10);
}

// ---------- Plan ----------

export type RowOutcome = "create" | "match" | "skip" | "error";

export interface RowResult {
  file: "clients" | "patients" | "vaccines";
  rowNumber: number; // 2 = first data row (row 1 is the header)
  sourceId: string;
  outcome: RowOutcome;
  message?: string;
}

export interface PlannedClient {
  sourceId: string;
  /** Set when this client already exists at the location (matched by mobile). */
  existingId: string | null;
  householdKey: string;
  client: ValidClient;
  smsConsentSource: string | null;
}

export interface PlannedPatient {
  sourceId: string;
  /** Set when this pet is already on file for a matched client (same name and species). */
  existingId: string | null;
  clientSourceId: string;
  patient: ValidPatient;
  status: "active" | "deceased" | "inactive";
  deceasedDate: string | null;
  activePrescriptions: boolean;
  lastWellnessExamAt: string | null;
  lastDentalAt: string | null;
  lastSurgeryAt: string | null;
  referringClinic: string | null;
}

export interface PlannedVaccine {
  patientSourceId: string;
  vaccineId: string;
  administeredAt: string;
  dueAt: string;
  intervalMonths: number;
  administeredBy: "this_clinic" | "external";
}

export interface ImportPlan {
  clients: PlannedClient[];
  patients: PlannedPatient[];
  vaccines: PlannedVaccine[];
  rows: RowResult[];
  summary: {
    clientsNew: number;
    clientsMatched: number;
    patients: number;
    patientsMatched: number;
    vaccines: number;
    vaccinesMatched: number;
    errors: number;
    skipped: number;
  };
}

export interface PlanInput {
  clients: CsvRow[];
  patients: CsvRow[];
  vaccines?: CsvRow[];
  /** Clinic date, YYYY-MM-DD. */
  today: string;
  /** Clients already at this location: E.164 mobile -> client id. */
  existingMobiles: Map<string, string>;
  /** Pets already on file: petKey(clientId, name, species) -> patient id. */
  existingPets?: Map<string, string>;
  /** Vaccine records already on file: vaccineKey(patientId, vaccineId, date). */
  existingVaccines?: Set<string>;
  /** Vaccine type ids the clinic has, with their default interval. */
  vaccineTypes: Map<string, { species: string; intervalMonths: number }>;
}

function why(error: unknown): string {
  return isDomainError(error) ? error.userMessage : error instanceof Error ? error.message : "Could not read this row.";
}

function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number) as [number, number];
  const [by, bm] = b.split("-").map(Number) as [number, number];
  return Math.max(1, (by - ay) * 12 + (bm - am));
}

/** How an existing pet is recognised when its owner is matched. */
export function petKey(clientId: string, name: string, species: string): string {
  return `${clientId}|${name.trim().toLowerCase()}|${species}`;
}

export function vaccineKey(patientId: string, vaccineId: string, administeredAt: string): string {
  return `${patientId}|${vaccineId}|${administeredAt}`;
}

export function planImport(input: PlanInput): ImportPlan {
  const rows: RowResult[] = [];
  const clients: PlannedClient[] = [];
  const clientBySource = new Map<string, PlannedClient>();
  const seenMobiles = new Map<string, string>(); // mobile -> source id, within this file

  input.clients.forEach((r, i) => {
    const rowNumber = i + 2;
    const sourceId = r.id?.trim() || `row-${rowNumber}`;
    try {
      if (clientBySource.has(sourceId)) throw new ValidationError(`Client id "${sourceId}" appears twice in the file.`);
      const flags = list(r.flags).filter((f): f is ClientFlag => (CLIENT_FLAGS as readonly string[]).includes(f));
      const channel = (r.preferred_channel?.trim().toLowerCase() || "sms") as Channel;
      const client = validateClient({
        firstName: r.first_name ?? "",
        lastName: r.last_name ?? "",
        mobile: r.mobile ?? "",
        email: r.email,
        altPhone: r.alt_phone,
        address: r.address,
        preferredChannel: ["sms", "email", "call"].includes(channel) ? channel : "sms",
        smsConsent: yes(r.sms_consent),
        marketingConsent: yes(r.marketing_consent),
        notes: r.notes,
        flags,
      });
      const dupe = seenMobiles.get(client.mobile);
      if (dupe) throw new ValidationError(`Same mobile number as client "${dupe}" in this file. Merge them in your system or give each their own number.`);
      seenMobiles.set(client.mobile, sourceId);
      const existingId = input.existingMobiles.get(client.mobile) ?? null;
      const planned: PlannedClient = {
        sourceId,
        existingId,
        householdKey: r.household_id?.trim() || `own:${sourceId}`,
        client,
        smsConsentSource: client.smsConsent ? r.sms_consent_source?.trim() || "import" : null,
      };
      clients.push(planned);
      clientBySource.set(sourceId, planned);
      rows.push({
        file: "clients",
        rowNumber,
        sourceId,
        outcome: existingId ? "match" : "create",
        message: existingId ? "Already a client here (same mobile). Pets will be added to the existing record." : undefined,
      });
    } catch (error) {
      rows.push({ file: "clients", rowNumber, sourceId, outcome: "error", message: why(error) });
    }
  });

  const patients: PlannedPatient[] = [];
  const patientBySource = new Map<string, PlannedPatient>();
  input.patients.forEach((r, i) => {
    const rowNumber = i + 2;
    const sourceId = r.id?.trim() || `row-${rowNumber}`;
    const clientSourceId = r.client_id?.trim() ?? "";
    try {
      if (patientBySource.has(sourceId)) throw new ValidationError(`Pet id "${sourceId}" appears twice in the file.`);
      if (!clientBySource.has(clientSourceId)) {
        rows.push({
          file: "patients",
          rowNumber,
          sourceId,
          outcome: "skip",
          message: clientSourceId ? `Owner "${clientSourceId}" is missing or has an error in the clients file.` : "No owner given.",
        });
        return;
      }
      const species = parseSpecies(r.species ?? "");
      if (!species) throw new ValidationError(`"${r.species ?? ""}" is not a species we know. Use dog, cat, rabbit, bird, reptile or other.`);
      const temperamentFlags = list(r.temperament_flags).filter((f): f is TemperamentFlag => (TEMPERAMENT_FLAGS as readonly string[]).includes(f));
      const sex = r.sex?.trim().toLowerCase();
      const patient = validatePatient(
        {
          name: r.name ?? "",
          species,
          breed: r.breed,
          sex: sex?.startsWith("m") ? "male" : sex?.startsWith("f") ? "female" : null,
          neutered: blank(r.neutered) ? null : yes(r.neutered),
          dateOfBirth: parseDate(r.date_of_birth),
          weightKg: blank(r.weight_kg) ? null : Number(r.weight_kg),
          colorMarkings: r.color_markings,
          microchipNumber: r.microchip_number,
          medicalAlerts: r.medical_alerts,
          temperamentFlags,
        },
        input.today,
      );
      const rawStatus = r.status?.trim().toLowerCase() || "active";
      const status = rawStatus === "deceased" ? "deceased" : rawStatus === "inactive" || rawStatus === "transferred" ? "inactive" : "active";
      const deceasedDate = parseDate(r.deceased_date);
      if (status === "deceased" && deceasedDate && deceasedDate > input.today) throw new ValidationError("The date of death is in the future.");
      const lastExam = parseDate(r.last_wellness_exam_at);
      if (lastExam && patient.dateOfBirth && lastExam < patient.dateOfBirth) {
        throw new ValidationError("The last wellness exam is before the date of birth.");
      }
      const owner = clientBySource.get(clientSourceId)!;
      const existingId = owner.existingId ? (input.existingPets?.get(petKey(owner.existingId, patient.name, patient.species)) ?? null) : null;
      const planned: PlannedPatient = {
        sourceId,
        existingId,
        clientSourceId,
        patient,
        status,
        deceasedDate: status === "deceased" ? deceasedDate : null,
        activePrescriptions: yes(r.active_prescriptions),
        lastWellnessExamAt: lastExam,
        lastDentalAt: parseDate(r.last_dental_at),
        lastSurgeryAt: parseDate(r.last_surgery_at),
        referringClinic: r.referring_clinic?.trim() || null,
      };
      patients.push(planned);
      patientBySource.set(sourceId, planned);
      rows.push(
        existingId
          ? { file: "patients", rowNumber, sourceId, outcome: "match", message: "Already on file for this owner. Kept as is; new vaccines are added." }
          : { file: "patients", rowNumber, sourceId, outcome: "create" },
      );
    } catch (error) {
      rows.push({ file: "patients", rowNumber, sourceId, outcome: "error", message: why(error) });
    }
  });

  const vaccines: PlannedVaccine[] = [];
  const seenVaccines = new Set<string>();
  (input.vaccines ?? []).forEach((r, i) => {
    const rowNumber = i + 2;
    const patientSourceId = r.patient_id?.trim() ?? "";
    const sourceId = `${patientSourceId}:${r.vaccine_id ?? ""}:${r.administered_at ?? ""}`;
    try {
      const pet = patientBySource.get(patientSourceId);
      if (!pet) {
        rows.push({ file: "vaccines", rowNumber, sourceId, outcome: "skip", message: `Pet "${patientSourceId}" is missing or has an error.` });
        return;
      }
      const vaccineId = r.vaccine_id?.trim() ?? "";
      const type = input.vaccineTypes.get(vaccineId);
      if (!type) throw new ValidationError(`"${vaccineId}" is not a vaccine this clinic has set up.`);
      if (type.species !== pet.patient.species) throw new ValidationError(`${vaccineId} is a ${type.species} vaccine but ${pet.patient.name} is a ${pet.patient.species}.`);
      const administeredAt = parseDate(r.administered_at);
      const dueAt = parseDate(r.due_at);
      if (!administeredAt || !dueAt) throw new ValidationError("Both the date given and the due date are needed.");
      if (administeredAt > input.today) throw new ValidationError("The vaccine date is in the future.");
      if (dueAt <= administeredAt) throw new ValidationError("The due date must be after the date given.");
      if (seenVaccines.has(sourceId)) {
        rows.push({ file: "vaccines", rowNumber, sourceId, outcome: "skip", message: "Same vaccine on the same day appears twice." });
        return;
      }
      seenVaccines.add(sourceId);
      if (pet.existingId && input.existingVaccines?.has(vaccineKey(pet.existingId, vaccineId, administeredAt))) {
        rows.push({ file: "vaccines", rowNumber, sourceId, outcome: "match", message: "Already on file." });
        return;
      }
      const interval = Number(r.interval_months);
      vaccines.push({
        patientSourceId,
        vaccineId,
        administeredAt,
        dueAt,
        intervalMonths: Number.isInteger(interval) && interval > 0 ? interval : monthsBetween(administeredAt, dueAt),
        administeredBy: r.administered_by?.trim() === "external" ? "external" : "this_clinic",
      });
      rows.push({ file: "vaccines", rowNumber, sourceId, outcome: "create" });
    } catch (error) {
      rows.push({ file: "vaccines", rowNumber, sourceId, outcome: "error", message: why(error) });
    }
  });

  const count = (outcome: RowOutcome) => rows.filter((r) => r.outcome === outcome).length;
  return {
    clients,
    patients,
    vaccines,
    rows,
    summary: {
      clientsNew: clients.filter((c) => !c.existingId).length,
      clientsMatched: clients.filter((c) => c.existingId).length,
      patients: patients.filter((p) => !p.existingId).length,
      patientsMatched: patients.filter((p) => p.existingId).length,
      vaccines: vaccines.length,
      vaccinesMatched: rows.filter((r) => r.file === "vaccines" && r.outcome === "match").length,
      errors: count("error"),
      skipped: count("skip"),
    },
  };
}

