import { describe, expect, it } from "vitest";
import {
  checkEligibility,
  findSlots,
  localParts,
  offerTwo,
  zonedInstant,
  type Hold,
  type PatientForBooking,
  type ProviderInfo,
  type SchedulingData,
  type ServiceRules,
} from "./index";

const TZ = "America/New_York";
const DAY = "2026-11-17"; // a Tuesday
const at = (time: string, date = DAY) => zonedInstant(date, time, TZ);
const hm = (instant: number) => {
  const p = localParts(instant, TZ);
  return `${String(Math.floor(p.minutes / 60)).padStart(2, "0")}:${String(p.minutes % 60).padStart(2, "0")}`;
};
const week = (start: string, end: string) =>
  new Map([1, 2, 3, 4, 5].map((d) => [d, [{ start: Number(start.slice(0, 2)) * 60 + Number(start.slice(3)), end: Number(end.slice(0, 2)) * 60 + Number(end.slice(3)) }]]));

const provider = (over: Partial<ProviderInfo>): ProviderInfo => ({
  id: "dr1", name: "Dr. Marsh", role: "dvm", bookable: true, maxConcurrent: 1, skills: ["surgery", "dentistry", "euthanasia"],
  schedule: week("08:00", "18:00"), blocked: [], ...over,
});

const service = (over: Partial<ServiceRules>): ServiceRules => ({
  id: "s1", packServiceId: "wellness_exam", name: "Wellness exam", durationMin: 30, bufferBeforeMin: 0, bufferAfterMin: 5,
  providerRole: "dvm", alsoRoles: [], roomType: "exam", equipment: [], skills: [], species: ["dog", "cat"],
  requiresDoctorOnPremises: true, dropOff: false, dropOffWindow: null, prerequisites: {}, active: true, ...over,
});

const dog: PatientForBooking = { species: "dog", sex: "female", neutered: false, dateOfBirth: "2020-01-01", approxAgeMonths: null, temperamentFlags: [] };

function clinic(over: Partial<SchedulingData> = {}): SchedulingData {
  return {
    calendar: {
      timezone: TZ,
      hours: new Map([1, 2, 3, 4, 5].map((d) => [d, { open: 8 * 60, close: 18 * 60 }])),
      holidays: new Set(),
      slotMinutes: 15,
      temperamentBufferMin: 15,
    },
    providers: [provider({})],
    rooms: [
      { id: "exam1", name: "Exam 1", type: "exam", capacity: 1 },
      { id: "cat1", name: "Cat room", type: "cat_exam", capacity: 1 },
      { id: "tr", name: "Treatment", type: "treatment", capacity: 2 },
      { id: "surg", name: "Surgery", type: "surgery", capacity: 1 },
    ],
    equipment: [
      { id: "an1", type: "anesthesia_machine", exclusive: true },
      { id: "an2", type: "anesthesia_machine", exclusive: true },
    ],
    holds: [],
    ...over,
  };
}

const find = (data: SchedulingData, svc: ServiceRules, patient = dog, extra: { providerId?: string } = {}) =>
  findSlots(data, { service: svc, patient, dates: [DAY], notBefore: 0, limit: 100, ...extra });

describe("clinic time", () => {
  it("handles daylight saving: 9:00 is 14:00 UTC in winter and 13:00 UTC in summer", () => {
    expect(new Date(zonedInstant("2026-03-07", "09:00", TZ)).toISOString()).toBe("2026-03-07T14:00:00.000Z");
    expect(new Date(zonedInstant("2026-03-09", "09:00", TZ)).toISOString()).toBe("2026-03-09T13:00:00.000Z");
    expect(new Date(zonedInstant("2026-11-17", "09:00", "Asia/Karachi")).toISOString()).toBe("2026-11-17T04:00:00.000Z");
  });
});

describe("finding slots", () => {
  it("offers 15-minute starts inside opening hours, ending by closing time", () => {
    const slots = find(clinic(), service({}));
    expect(hm(slots[0]!.start)).toBe("08:00");
    expect(hm(slots[1]!.start)).toBe("08:15");
    expect(hm(slots.at(-1)!.start)).toBe("17:30");
    expect(slots[0]).toMatchObject({ providerId: "dr1", roomId: "exam1" });
  });

  it("skips times the doctor is busy, and uses another doctor when there is one", () => {
    const busy: Hold[] = [{ providerId: "dr1", start: at("08:00"), end: at("09:00") }];
    expect(hm(find(clinic({ holds: busy }), service({}))[0]!.start)).toBe("09:00");
    const two = clinic({ holds: busy, providers: [provider({}), provider({ id: "dr2", name: "Dr. Okafor" })] });
    expect(find(two, service({}))[0]).toMatchObject({ providerId: "dr2" });
  });

  it("keeps the buffer after a visit free", () => {
    const busy: Hold[] = [{ roomId: "exam1", start: at("08:00"), end: at("08:35") }];
    expect(hm(find(clinic({ holds: busy }), service({}))[0]!.start)).toBe("08:45");
  });

  it("respects shared room capacity", () => {
    const tech = provider({ id: "t1", role: "technician", maxConcurrent: 3 });
    const svc = service({ packServiceId: "nail_trim", providerRole: "technician", roomType: "treatment", requiresDoctorOnPremises: false, durationMin: 15 });
    const full: Hold[] = [
      { roomId: "tr", start: at("08:00"), end: at("08:15") },
      { roomId: "tr", start: at("08:00"), end: at("08:15") },
    ];
    expect(hm(find(clinic({ providers: [tech], holds: full }), svc)[0]!.start)).toBe("08:15");
    expect(hm(find(clinic({ providers: [tech], holds: full.slice(1) }), svc)[0]!.start)).toBe("08:00");
  });

  it("lets an assistant do a nail trim when the service allows it", () => {
    const assistant = provider({ id: "a1", role: "assistant", skills: [] });
    const svc = service({ providerRole: "technician", alsoRoles: ["assistant"], roomType: "treatment", requiresDoctorOnPremises: false });
    expect(find(clinic({ providers: [assistant] }), svc)[0]).toMatchObject({ providerId: "a1" });
  });

  it("needs a doctor on site for technician work that requires one", () => {
    const tech = provider({ id: "t1", role: "technician", skills: [] });
    const svc = service({ providerRole: "technician", roomType: "treatment", requiresDoctorOnPremises: true, durationMin: 15 });
    expect(find(clinic({ providers: [tech] }), svc)).toHaveLength(0);
    const lateDoctor = provider({ id: "dr1", schedule: week("12:00", "18:00") });
    expect(hm(find(clinic({ providers: [tech, lateDoctor] }), svc)[0]!.start)).toBe("12:00");
  });

  it("caps surgeries by anesthesia machines and starts drop-offs in the drop-off window", () => {
    const surgeons = [provider({}), provider({ id: "dr2" }), provider({ id: "dr3" })];
    const spay = service({
      packServiceId: "spay_canine", durationMin: 90, bufferAfterMin: 30, roomType: null, skills: ["surgery"],
      equipment: [{ type: "anesthesia_machine", quantity: 1 }], dropOff: true, dropOffWindow: "07:00-08:30",
    });
    const slots = find(clinic({ providers: surgeons }), spay);
    expect(slots.map((s) => hm(s.start))).toEqual(["08:00", "08:15", "08:30"]);
    const machinesInUse: Hold[] = [
      { equipmentId: "an1", start: at("07:30"), end: at("10:30") },
      { equipmentId: "an2", start: at("07:30"), end: at("10:30") },
    ];
    expect(find(clinic({ providers: surgeons, holds: machinesInUse }), spay)).toHaveLength(0);
  });

  it("puts cats in the cat room first, then a normal exam room", () => {
    const cat: PatientForBooking = { ...dog, species: "cat" };
    expect(find(clinic(), service({}), cat)[0]).toMatchObject({ roomId: "cat1" });
    const catRoomBusy: Hold[] = [{ roomId: "cat1", start: at("08:00"), end: at("09:00") }];
    expect(find(clinic({ holds: catRoomBusy }), service({}), cat)[0]).toMatchObject({ roomId: "exam1" });
  });

  it("needs the exotics skill for rabbits, birds and reptiles", () => {
    const rabbit: PatientForBooking = { ...dog, species: "rabbit" };
    const svc = service({ species: ["dog", "cat", "rabbit"] });
    expect(find(clinic(), svc, rabbit)).toHaveLength(0);
    expect(find(clinic({ providers: [provider({ skills: ["exotics"] })] }), svc, rabbit)).not.toHaveLength(0);
  });

  it("adds a calmer gap around anxious or aggressive pets", () => {
    const anxious: PatientForBooking = { ...dog, temperamentFlags: ["anxious"] };
    const slot = find(clinic(), service({}), anxious)[0]!;
    expect((slot.holdEnd - slot.end) / 60_000).toBe(5 + 15);
  });

  it("offers nothing on holidays, weekends or past times, or for an unavailable doctor", () => {
    expect(find(clinic({ calendar: { ...clinic().calendar, holidays: new Set([DAY]) } }), service({}))).toHaveLength(0);
    expect(findSlots(clinic(), { service: service({}), patient: dog, dates: ["2026-11-15"], notBefore: 0 })).toHaveLength(0);
    expect(hm(findSlots(clinic(), { service: service({}), patient: dog, dates: [DAY], notBefore: at("15:05") })[0]!.start)).toBe("15:15");
    const away = provider({ blocked: [{ start: at("00:00"), end: at("23:59") }] });
    expect(find(clinic({ providers: [away] }), service({}))).toHaveLength(0);
  });

  it("offers a morning and an afternoon choice", () => {
    const two = offerTwo(find(clinic(), service({})), TZ);
    expect(two.map((s) => hm(s.start))).toEqual(["08:00", "12:00"]);
  });
});

describe("eligibility", () => {
  const spay = service({ name: "Dog spay", species: ["dog"], prerequisites: { sex: "female", neutered: false } });

  it("blocks the wrong species, sex or an already neutered pet", () => {
    expect(checkEligibility(spay, dog, DAY).blocking).toEqual([]);
    expect(checkEligibility(spay, { ...dog, species: "cat" }, DAY).blocking[0]!.ruleId).toBe("service.species");
    expect(checkEligibility(spay, { ...dog, sex: "male" }, DAY).blocking[0]!.ruleId).toBe("prereq.sex");
    expect(checkEligibility(spay, { ...dog, neutered: true }, DAY).blocking[0]!.ruleId).toBe("prereq.neutered");
  });

  it("checks age limits for senior and puppy visits", () => {
    const senior = service({ name: "Senior wellness", prerequisites: { min_age_years: { dog: 7, cat: 10 } } });
    expect(checkEligibility(senior, { ...dog, dateOfBirth: "2022-01-01" }, DAY).blocking).toHaveLength(1);
    expect(checkEligibility(senior, { ...dog, dateOfBirth: "2018-01-01" }, DAY).blocking).toHaveLength(0);
    const puppy = service({ name: "Puppy visit", prerequisites: { max_age_months: 6 } });
    expect(checkEligibility(puppy, { ...dog, dateOfBirth: "2026-08-01" }, DAY).blocking).toHaveLength(0);
    expect(checkEligibility(puppy, dog, DAY).blocking).toHaveLength(1);
  });

  it("checks visit-history prerequisites against the record (test calls 8, 9 and 12)", () => {
    const booster = service({ name: "Vaccine booster", prerequisites: { wellness_exam_within_months: 12 } });
    const dental = service({ name: "Dental cleaning", prerequisites: { completed_visit_within_days: 90 } });
    const today = "2026-11-13";
    expect(checkEligibility(booster, { ...dog, lastWellnessExamAt: "2025-11-29" }, today)).toEqual({ blocking: [], warnings: [] });
    // Not met: a warning, so staff can still book; the AI treats it as blocking and falls back.
    expect(checkEligibility(booster, { ...dog, lastWellnessExamAt: "2025-08-23" }, today)).toEqual({ blocking: [], warnings: [expect.objectContaining({ ruleId: "prereq.wellness_exam_within_months" })] });
    expect(checkEligibility(booster, { ...dog, lastWellnessExamAt: null }, today).warnings).toHaveLength(1);
    expect(checkEligibility(dental, { ...dog, lastCompletedVisitAt: "2026-06-01" }, today).warnings).toHaveLength(1);
    // Unknown history (not loaded) stays a warning for staff.
    expect(checkEligibility(booster, dog, today).warnings[0]!.ruleId).toBe("prereq.wellness_exam_within_months");
  });

  it("turns clinical history needs into warnings for staff", () => {
    const xray = service({ name: "Radiographs", prerequisites: { doctor_ordered: true } });
    expect(checkEligibility(xray, dog, DAY)).toEqual({ blocking: [], warnings: [expect.objectContaining({ ruleId: "prereq.doctor_ordered" })] });
  });
});
