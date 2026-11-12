import { describe, expect, it } from "vitest";
import { ValidationError } from "@vetrix/domain";
import { clientFromForm, patientFromForm } from "./form-parse";

const form = (entries: [string, string][]) => {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
};

describe("client form", () => {
  it("reads checkboxes, flag lists and blank optional fields", () => {
    const c = clientFromForm(
      form([
        ["firstName", "Maria"], ["lastName", "Lopez"], ["mobile", "(555) 291-3352"], ["email", ""],
        ["preferredChannel", "sms"], ["smsConsent", "on"], ["flags", "vip"], ["flags", "do_not_call"], ["flags", "made_up"],
      ]),
    );
    expect(c).toMatchObject({ mobile: "+15552913352", email: null, smsConsent: true, marketingConsent: false, flags: ["vip", "do_not_call"] });
  });
});

describe("pet form", () => {
  const base: [string, string][] = [["name", "Luna"], ["species", "dog"]];

  it("uses the date of birth or the approximate years and months", () => {
    expect(patientFromForm(form([...base, ["ageMode", "dob"], ["dateOfBirth", "2021-04-30"]]), "2026-11-12").dateOfBirth).toBe("2021-04-30");
    const approx = patientFromForm(form([...base, ["ageMode", "approx"], ["approxYears", "2"], ["approxMonths", "3"]]), "2026-11-12");
    expect(approx).toMatchObject({ dateOfBirth: null, approxAgeMonths: 27 });
  });

  it("reads neutered, weight and temperament", () => {
    const p = patientFromForm(
      form([...base, ["neutered", "yes"], ["weightKg", "12.5"], ["temperamentFlags", "anxious"], ["temperamentFlags", "fear_free"]]),
      "2026-11-12",
    );
    expect(p).toMatchObject({ neutered: true, weightKg: 12.5, temperamentFlags: ["anxious", "fear_free"] });
  });

  it("refuses an unknown species instead of guessing", () => {
    expect(() => patientFromForm(form([["name", "Rex"], ["species", "dragon"]]), "2026-11-12")).toThrow(ValidationError);
  });
});
