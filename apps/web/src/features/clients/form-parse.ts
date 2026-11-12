// Turns submitted form fields into validated clients and pets. Kept apart
// from the server actions so it can be tested on its own.
import {
  CLIENT_FLAGS,
  SPECIES,
  TEMPERAMENT_FLAGS,
  validateClient,
  validatePatient,
  type Channel,
  type ClientFlag,
  type Species,
  type TemperamentFlag,
} from "@vetrix/domain";

export const text = (f: FormData, key: string) => String(f.get(key) ?? "");
export const optional = (f: FormData, key: string) => text(f, key).trim() || null;
export const checked = (f: FormData, key: string) => f.get(key) === "on";
const number = (f: FormData, key: string) => {
  const v = text(f, key).trim();
  return v === "" ? null : Number(v);
};
const pick = <T extends string>(values: readonly T[], f: FormData, key: string) =>
  f.getAll(key).map(String).filter((v): v is T => (values as readonly string[]).includes(v));

export function clientFromForm(f: FormData) {
  return validateClient({
    firstName: text(f, "firstName"),
    lastName: text(f, "lastName"),
    mobile: text(f, "mobile"),
    email: optional(f, "email"),
    altPhone: optional(f, "altPhone"),
    address: optional(f, "address"),
    preferredChannel: (text(f, "preferredChannel") || "sms") as Channel,
    smsConsent: checked(f, "smsConsent"),
    marketingConsent: checked(f, "marketingConsent"),
    notes: optional(f, "notes"),
    flags: pick<ClientFlag>(CLIENT_FLAGS, f, "flags"),
  });
}

export function patientFromForm(f: FormData, today: string) {
  const age = text(f, "ageMode") === "approx";
  const species = text(f, "species");
  return validatePatient(
    {
      name: text(f, "name"),
      species: (SPECIES as readonly string[]).includes(species) ? (species as Species) : ("" as Species),
      breed: optional(f, "breed"),
      sex: (optional(f, "sex") as "male" | "female" | null) ?? null,
      neutered: text(f, "neutered") === "" ? null : text(f, "neutered") === "yes",
      dateOfBirth: age ? null : optional(f, "dateOfBirth"),
      approxAgeMonths: age ? (number(f, "approxYears") ?? 0) * 12 + (number(f, "approxMonths") ?? 0) : null,
      weightKg: number(f, "weightKg"),
      colorMarkings: optional(f, "colorMarkings"),
      microchipNumber: optional(f, "microchipNumber"),
      medicalAlerts: optional(f, "medicalAlerts"),
      temperamentFlags: pick<TemperamentFlag>(TEMPERAMENT_FLAGS, f, "temperamentFlags"),
    },
    today,
  );
}

