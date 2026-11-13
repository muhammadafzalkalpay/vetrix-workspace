import { describe, expect, it } from "vitest";
import { validateClinicDetails, validateFrontDesk, validateMessaging, validatePolicies, validateWeekHours } from "./settings";

describe("settings validation", () => {
  it("clinic details: phone to E.164, real time zone, https website", () => {
    expect(validateClinicDetails({ name: " Main Vet ", mainPhone: "(555) 010-1000", timezone: "America/New_York", website: "https://vet.example" })).toMatchObject({
      name: "Main Vet", mainPhone: "+15550101000", timezone: "America/New_York",
    });
    expect(() => validateClinicDetails({ name: "x", timezone: "Mars/Base" })).toThrow(/time zone/);
    expect(() => validateClinicDetails({ name: "x", timezone: "UTC", website: "vet.example" })).toThrow(/https/);
  });

  it("weekly hours: closed days, closing after opening, at least one open day", () => {
    const f: Record<string, string> = {};
    for (let d = 0; d < 7; d++) Object.assign(f, d === 0 ? { [`closed_${d}`]: "on" } : { [`opens_${d}`]: "08:00", [`closes_${d}`]: "18:00" });
    expect(validateWeekHours(f).days[0]).toBeNull();
    expect(() => validateWeekHours({ ...f, closes_1: "07:00" })).toThrow(/after opening/);
    const allClosed = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [`closed_${d}`, "on"]));
    expect(() => validateWeekHours(allClosed)).toThrow(/at least one day/);
  });

  it("front desk: complete ER details or none, letters-only assistant name", () => {
    expect(validateFrontDesk({ aiName: "Riley", afterHoursBehaviour: "er_only" })).toMatchObject({ aiName: "Riley", afterHoursBehaviour: "er_only", erName: null });
    expect(() => validateFrontDesk({ aiName: "Riley", erName: "Metro ER" })).toThrow(/name, phone and address/);
    expect(() => validateFrontDesk({ aiName: "R2-D2!" })).toThrow(/letters only/);
  });

  it("policies and quiet hours", () => {
    expect(validatePolicies({ cancellationWindowHours: "24", cancellationFee: "$25", recordingRetentionMonths: "12", telehealthEnabled: "on" })).toMatchObject({ cancellationFee: 25, telehealthEnabled: true });
    expect(() => validatePolicies({ cancellationWindowHours: "-1", recordingRetentionMonths: "12" })).toThrow(/Cancellation notice/);
    expect(() => validateMessaging({ quietStart: "20:00", quietEnd: "20:00" })).toThrow(/different times/);
  });
});
