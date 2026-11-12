import { describe, expect, it } from "vitest";
import {
  ConflictError,
  fixedClock,
  isDomainError,
  RuleViolationError,
} from "./index";

describe("domain errors", () => {
  it("maps codes to HTTP status and keeps a safe message", () => {
    const err = new ConflictError("That slot was just taken.");
    expect(isDomainError(err)).toBe(true);
    expect(err.httpStatus).toBe(409);
    expect(err.userMessage).toBe("That slot was just taken.");
  });

  it("records which rule was violated", () => {
    const err = new RuleViolationError("requires_preop_bloodwork", "Bloodwork is needed first.");
    expect(err.ruleId).toBe("requires_preop_bloodwork");
    expect(err.httpStatus).toBe(422);
  });

  it("does not treat plain errors as domain errors", () => {
    expect(isDomainError(new Error("boom"))).toBe(false);
  });
});

describe("fixedClock", () => {
  it("freezes and advances time", () => {
    const clock = fixedClock("2026-11-03T06:00:00Z");
    expect(clock.now().toISOString()).toBe("2026-11-03T06:00:00.000Z");
    clock.advanceMinutes(20);
    expect(clock.now().toISOString()).toBe("2026-11-03T06:20:00.000Z");
  });

  it("returns a copy so callers cannot change the clock", () => {
    const clock = fixedClock("2026-11-03T06:00:00Z");
    clock.now().setUTCFullYear(2000);
    expect(clock.now().getUTCFullYear()).toBe(2026);
  });
});
