import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyAssessment,
  callerDownplays,
  introducedPetNames,
  classifyByPhrases,
  decideTriageAction,
  initialTriage,
  maskPetNames,
  normalizeUtterance,
  transferSummary,
  UNCLASSIFIED_CONCERN,
  UNCLASSIFIED_EMERGENCY,
  type TriageRules,
  type TriageSituation,
} from "./triage";

// The real pack file, so the tests break if the pack changes shape.
const rules = JSON.parse(readFileSync(new URL("../../pack/veterinary/triage.json", import.meta.url), "utf8")) as TriageRules;

const open: TriageSituation = {
  open: true,
  transferNumber: "+15555550100",
  afterHoursBehaviour: "er_and_book_next",
  er: { name: "Valley Pet ER", phone: "(555) 555-0199", address: "12 Main St" },
};

describe("classifyByPhrases", () => {
  it("finds emergencies from pack phrases, ignoring case and apostrophes", () => {
    const a = classifyByPhrases(rules, "He CAN’T breathe properly!!");
    expect(a.level).toBe("emergency");
    expect(a.matches[0]!.triggerId).toBe("breathing_difficulty");
    expect(a.unsure).toBe(false);
  });

  it("classifies urgent triggers", () => {
    const a = classifyByPhrases(rules, "she keeps throwing up since this morning");
    expect(a.level).toBe("urgent");
    expect(a.matches.map((m) => m.triggerId)).toContain("repeated_vomiting");
  });

  it("matches whole words only", () => {
    expect(classifyByPhrases(rules, "I'd like to book a haircut and nails").level).toBe("routine");
  });

  it("reports routine for ordinary booking talk", () => {
    expect(classifyByPhrases(rules, "Can I book Max in for his annual vaccines next week?").level).toBe("routine");
  });

  it("escalates broad concerns it has no trigger for (when unsure, escalate)", () => {
    const a = classifyByPhrases(rules, "there is some blood on his paw");
    expect(a.level).toBe("urgent");
    expect(a.unsure).toBe(true);
    expect(a.matches[0]!.triggerId).toBe(UNCLASSIFIED_CONCERN);
    const b = classifyByPhrases(rules, "I think this is an emergency");
    expect(b.level).toBe("emergency");
    expect(b.matches[0]!.triggerId).toBe(UNCLASSIFIED_EMERGENCY);
  });

  it("does not treat a pet called Chocolate as poisoning", () => {
    expect(classifyByPhrases(rules, "Chocolate needs her yearly checkup", { petNames: ["Chocolate"] }).level).toBe("routine");
    expect(classifyByPhrases(rules, "I want to book Lily for a nail trim", { petNames: ["Lily"] }).level).toBe("routine");
  });

  it("still catches poisoning when the pet's name is the thing eaten", () => {
    const a = classifyByPhrases(rules, "Max ate some chocolate off the table", { petNames: ["Max", "Chocolate"] });
    expect(a.level).toBe("emergency");
    expect(a.matches[0]!.triggerId).toBe("toxin_ingestion");
    const b = classifyByPhrases(rules, "Chocolate ate chocolate", { petNames: ["Chocolate"] });
    expect(b.level).toBe("emergency");
  });
});

describe("pack regression checks (test-calls.md)", () => {
  const level = (text: string, petNames: string[] = []) => classifyByPhrases(rules, text, { petNames });

  it("keeps a pet called Lily routine, even when the caller introduces her in the same sentence", () => {
    expect(level("My dog Lily needs her annual exam.").level).toBe("routine");
    expect(introducedPetNames("my cat Lily and her name is Pepper, named Max")).toEqual(["Lily", "Max", "Pepper"]);
    expect(level("Lily's annual exam please", ["Lily"]).level).toBe("routine");
  });

  it("does not hear a seizure in 'thanks for fitting us in'", () => {
    expect(level("Thanks for fitting us in.").level).toBe("routine");
    expect(level("can you fit Max in tomorrow").level).toBe("routine");
    expect(level("he is fitting right now").level).toBe("emergency");
  });

  it("escalates an unclear possible poisoning", () => {
    const a = level("I think he might have gotten into something in the garage, he's acting weird");
    expect(a.level).toBe("emergency");
    expect(a.matches[0]!.triggerId).toBe("toxin_ingestion");
    expect(a.unsure).toBe(true);
  });

  it("matches by meaning across small wording changes (call 5 and call 6)", () => {
    expect(level("My cat is in the litter box straining and crying and nothing is coming out.").matches[0]!.triggerId).toBe("urinary_blockage");
    expect(level("his stomach looks swollen and he keeps trying to throw up but nothing comes out").matches[0]!.triggerId).toBe("bloat_gdv");
    expect(level("Luna has been throwing up all day").matches[0]!.triggerId).toBe("repeated_vomiting");
  });

  it("does not make a lump urgent on its own (call 13), or a chocolate lab a poisoning", () => {
    expect(level("My dog has a lump on his side, I want it removed.").level).toBe("routine");
    expect(level("I have a chocolate lab who needs a checkup").level).toBe("routine");
    expect(level("my dog ate chocolate").level).toBe("emergency");
  });

  it("recognises a caller playing it down (call 6)", () => {
    expect(callerDownplays("But he's still wagging his tail so I think he's fine, can I just book for Friday?")).toBe(true);
    expect(callerDownplays("he collapsed")).toBe(false);
  });
});

describe("pet name masking", () => {
  it("replaces names with a neutral word", () => {
    expect(maskPetNames(normalizeUtterance("Lily and lily"), ["Lily"])).toBe(" pet and pet ");
  });
});

describe("call state", () => {
  it("never lowers a level within a call", () => {
    let s = applyAssessment(initialTriage, classifyByPhrases(rules, "he collapsed in the yard"));
    expect(s.escalated).toBe(true);
    expect(s.state.level).toBe("emergency");
    s = applyAssessment(s.state, classifyByPhrases(rules, "actually he seems fine now, it's not that bad"));
    expect(s.escalated).toBe(false);
    expect(s.state.level).toBe("emergency");
  });

  it("records each trigger once and escalates from urgent to emergency", () => {
    let s = applyAssessment(initialTriage, classifyByPhrases(rules, "she is limping badly"));
    expect(s.state.level).toBe("urgent");
    s = applyAssessment(s.state, classifyByPhrases(rules, "still limping badly"));
    expect(s.newMatches).toHaveLength(0);
    s = applyAssessment(s.state, classifyByPhrases(rules, "and now she has a seizure"));
    expect(s.escalated).toBe(true);
    expect(s.state.matches.map((m) => m.triggerId)).toEqual(["lameness", "seizure"]);
  });
});

describe("decideTriageAction", () => {
  const emergency = "emergency" as const;

  it("transfers an emergency when the clinic is open", () => {
    const a = decideTriageAction(rules, emergency, open);
    expect(a.kind).toBe("transfer");
  });

  it("never transfers to a closed line: ER details, text and staff alert", () => {
    const a = decideTriageAction(rules, emergency, { ...open, open: false });
    expect(a).toMatchObject({ kind: "er_referral", sendErDetails: true, staffAlert: true, offerNextSlot: true, reason: "after_hours" });
    if (a.kind === "er_referral") expect(a.say).toContain("Valley Pet ER");
  });

  it("respects the er_only after-hours setting", () => {
    const a = decideTriageAction(rules, emergency, { ...open, open: false, afterHoursBehaviour: "er_only" });
    expect(a).toMatchObject({ kind: "er_referral", offerNextSlot: false });
  });

  it("falls back to ER details when the transfer fails", () => {
    const a = decideTriageAction(rules, emergency, { ...open, transferFailed: true });
    expect(a).toMatchObject({ kind: "er_referral", reason: "transfer_failed", staffAlert: true });
  });

  it("refers to the ER when no transfer line is set, even in hours", () => {
    expect(decideTriageAction(rules, emergency, { ...open, transferNumber: null })).toMatchObject({ kind: "er_referral", reason: "no_transfer_line" });
  });

  it("gives safe wording when the ER partner is not configured", () => {
    const a = decideTriageAction(rules, emergency, { ...open, open: false, er: { name: null, phone: null, address: null } });
    if (a.kind !== "er_referral") throw new Error("expected ER referral");
    expect(a.say).toContain("nearest emergency veterinary hospital");
    expect(a.say).not.toMatch(/\{\{/);
  });

  it("books urgent cases as a same or next day sick visit", () => {
    expect(decideTriageAction(rules, "urgent", open)).toEqual({ kind: "book_urgent", serviceId: "sick_visit", fallbackServiceId: "drop_off_visit" });
  });

  it("continues for routine", () => {
    expect(decideTriageAction(rules, "routine", open)).toEqual({ kind: "continue" });
  });
});

describe("transferSummary", () => {
  it("fills the pack's one-line summary", () => {
    const s = applyAssessment(initialTriage, classifyByPhrases(rules, "he ate rat poison")).state;
    const line = transferSummary(rules, s, { patientName: "Max", species: "dog", ageBand: "adult", clientFirstName: "Sam", mobile: "(555) 555-0123" });
    expect(line).toBe("Emergency: Possible poisoning. Max, dog, adult. Caller Sam (555) 555-0123.");
  });
});
