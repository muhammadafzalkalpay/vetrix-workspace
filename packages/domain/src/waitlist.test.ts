import { describe, expect, it } from "vitest";
import { firstWave, matchingEntries, secondWave, worthOffering, type WaitlistEntryInput } from "./waitlist";

const H = 3_600_000;
const entry = (id: string, over: Partial<WaitlistEntryInput> = {}): WaitlistEntryInput => ({
  id, patientId: `p-${id}`, clientId: `c-${id}`, serviceId: "s1", preferredProviderId: null, createdAt: Number(id.replace(/\D/g, "")),
  smsConsent: true, doNotContact: false, doNotCall: false, ...over,
});
const slot = { serviceId: "s1", providerId: "dr1", start: 10 * H, end: 11 * H };

describe("waitlist fill (W7)", () => {
  it("offers only cancellations inside the next 72 hours", () => {
    expect(worthOffering(slot, 0)).toBe(true);
    expect(worthOffering({ ...slot, start: 73 * H }, 0)).toBe(false);
    expect(worthOffering(slot, 11 * H)).toBe(false);
  });

  it("matches the service and provider preference, oldest first, never do-not-contact", () => {
    const list = [entry("e3"), entry("e1"), entry("e2", { serviceId: "s2" }), entry("e4", { preferredProviderId: "dr2" }), entry("e5", { preferredProviderId: "dr1" }), entry("e6", { doNotContact: true })];
    expect(matchingEntries(list, slot).map((e) => e.id)).toEqual(["e1", "e3", "e5"]);
  });

  it("texts the first three who allow texts, then calls the next two", () => {
    const list = ["e1", "e2", "e3", "e4", "e5", "e6", "e7"].map((id) => entry(id, { smsConsent: id !== "e2" }));
    const texts = firstWave(list);
    expect(texts.map((e) => e.id)).toEqual(["e1", "e3", "e4"]);
    expect(secondWave(list, new Set(texts.map((e) => e.id))).map((e) => e.id)).toEqual(["e2", "e5"]);
  });
});
