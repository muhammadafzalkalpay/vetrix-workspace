import { describe, expect, it } from "vitest";
import {
  ageInMonths,
  canContact,
  confirmDeceased,
  formatAge,
  formatPhone,
  normalizePhone,
  RuleViolationError,
  validateClient,
  validatePatient,
  ValidationError,
} from "./index";

const TODAY = "2026-11-12";

describe("phones", () => {
  it("stores US numbers the same way however they are typed", () => {
    for (const typed of ["555-291-3352", "(555) 291-3352", "5552913352", "1 555 291 3352", "+1 555 291 3352"]) {
      expect(normalizePhone(typed)).toBe("+15552913352");
    }
    expect(formatPhone("+15552913352")).toBe("(555) 291-3352");
  });

  it("keeps other countries when they start with +", () => {
    expect(normalizePhone("+92 300 1234567")).toBe("+923001234567");
    expect(formatPhone("+923001234567")).toBe("+923001234567");
  });

  it("rejects numbers that are too short or ambiguous", () => {
    for (const bad of ["555-1234", "", "+12", "25552913352"]) expect(() => normalizePhone(bad)).toThrow(ValidationError);
  });
});

describe("clients", () => {
  const base = { firstName: " maria ", lastName: "Lopez", mobile: "555-291-3352" };

  it("cleans names, phone and email", () => {
    const c = validateClient({ ...base, email: " Maria.Lopez@Example.com " });
    expect(c).toMatchObject({ firstName: "maria", mobile: "+15552913352", email: "maria.lopez@example.com", preferredChannel: "sms" });
  });

  it("needs a name, a phone, and an email when email is preferred", () => {
    expect(() => validateClient({ ...base, firstName: " " })).toThrow(/first name/);
    expect(() => validateClient({ ...base, mobile: "" })).toThrow(ValidationError);
    expect(() => validateClient({ ...base, preferredChannel: "email" })).toThrow(/email address/);
  });

  it("respects STOP, do-not-contact and do-not-call", () => {
    const client = { smsConsent: false, email: "a@b.co", flags: [] as const };
    expect(canContact(client, "sms")).toBe(false);
    expect(canContact(client, "email")).toBe(true);
    expect(canContact({ ...client, smsConsent: true }, "sms")).toBe(true);
    expect(canContact({ ...client, flags: ["do_not_call"] }, "call")).toBe(false);
    expect(canContact({ smsConsent: true, email: "a@b.co", flags: ["do_not_contact"] }, "email")).toBe(false);
  });
});

describe("patients", () => {
  const base = { name: "Luna", species: "dog" as const };

  it("accepts a date of birth or an approximate age, not both", () => {
    expect(validatePatient({ ...base, dateOfBirth: "2020-04-30" }, TODAY).dateOfBirth).toBe("2020-04-30");
    expect(validatePatient({ ...base, approxAgeMonths: 18 }, TODAY).approxAgeMonths).toBe(18);
    expect(() => validatePatient({ ...base, dateOfBirth: "2020-04-30", approxAgeMonths: 18 }, TODAY)).toThrow(/not both/);
  });

  it("rejects impossible dates, weights and microchips", () => {
    expect(() => validatePatient({ ...base, dateOfBirth: "2027-01-01" }, TODAY)).toThrow(/future/);
    expect(() => validatePatient({ ...base, dateOfBirth: "2021-02-30" }, TODAY)).toThrow(/valid date/);
    expect(() => validatePatient({ ...base, weightKg: 0 }, TODAY)).toThrow(/weight/);
    expect(() => validatePatient({ ...base, microchipNumber: "12AB" }, TODAY)).toThrow(/microchip/);
    expect(validatePatient({ ...base, microchipNumber: "985 100 000 000 001" }, TODAY).microchipNumber).toBe("985100000000001");
  });

  it("works out age from the clinic's date", () => {
    expect(ageInMonths({ dateOfBirth: "2025-11-13", approxAgeMonths: null }, TODAY)).toBe(11);
    expect(ageInMonths({ dateOfBirth: "2025-11-12", approxAgeMonths: null }, TODAY)).toBe(12);
    expect(formatAge(11)).toBe("11 months");
    expect(formatAge(30)).toBe("2 years");
    expect(formatAge(null)).toBe("Age unknown");
  });
});

describe("marking a pet deceased (pack v0.2)", () => {
  const luna = { name: "Luna", species: "dog" as const, status: "active" as const };
  const ok = { confirmedName: "luna", confirmedSpecies: "dog" as const, deathConfirmed: true, deceasedDate: "2026-11-10" };

  it("needs the death, the name and the species confirmed", () => {
    expect(confirmDeceased(luna, ok, TODAY)).toEqual({ deceasedDate: "2026-11-10" });
    expect(() => confirmDeceased(luna, { ...ok, deathConfirmed: false }, TODAY)).toThrow(RuleViolationError);
    expect(() => confirmDeceased(luna, { ...ok, confirmedName: "Lena" }, TODAY)).toThrow(/does not match Luna/);
    expect(() => confirmDeceased(luna, { ...ok, confirmedSpecies: "cat" }, TODAY)).toThrow(/recorded as a dog/);
  });

  it("refuses future dates and pets already marked", () => {
    expect(() => confirmDeceased(luna, { ...ok, deceasedDate: "2026-12-01" }, TODAY)).toThrow(/future/);
    expect(() => confirmDeceased({ ...luna, status: "deceased" }, ok, TODAY)).toThrow(/already/);
  });
});
