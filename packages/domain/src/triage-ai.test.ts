import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifyByPhrases, UNCLASSIFIED_CONCERN, UNCLASSIFIED_EMERGENCY, type TriageRules } from "./triage";
import { buildTriagePrompt, mergeAssessments, parseTriageAnswer } from "./triage-ai";

const rules = JSON.parse(readFileSync(new URL("../../pack/veterinary/triage.json", import.meta.url), "utf8")) as TriageRules;

describe("triage prompt", () => {
  it("lists the pack triggers and the household's pet names", () => {
    const p = buildTriagePrompt(rules, "she ate my gum", ["Chocolate"]);
    expect(p.system).toContain("toxin_ingestion (Possible poisoning)");
    expect(p.system).toContain('"Chocolate"');
    expect(p.user).toBe("she ate my gum");
  });
});

describe("parseTriageAnswer", () => {
  it("accepts a well-formed answer with known triggers", () => {
    const a = parseTriageAnswer(rules, JSON.stringify({ level: "emergency", trigger_ids: ["toxin_ingestion"], evidence: "ate sugar free gum", unsure: false }));
    expect(a).toMatchObject({ level: "emergency", matches: [{ triggerId: "toxin_ingestion", triggerName: "Possible poisoning" }] });
  });

  it("escalates when the answer is malformed", () => {
    const a = parseTriageAnswer(rules, "not json");
    expect(a.level).toBe("urgent");
    expect(a.unsure).toBe(true);
  });

  it("drops invented trigger ids but keeps the level", () => {
    const a = parseTriageAnswer(rules, { level: "emergency", trigger_ids: ["made_up"], evidence: "x", unsure: true });
    expect(a.level).toBe("emergency");
    expect(a.matches[0]!.triggerId).toBe(UNCLASSIFIED_EMERGENCY);
  });

  it("never reports below a named emergency trigger", () => {
    const a = parseTriageAnswer(rules, { level: "urgent", trigger_ids: ["seizure"], evidence: "fitting", unsure: false });
    expect(a.level).toBe("emergency");
  });
});

describe("mergeAssessments", () => {
  it("keeps the higher level, so the model can raise but never lower the phrase rules", () => {
    const phrases = classifyByPhrases(rules, "he ate rat poison");
    const model = parseTriageAnswer(rules, { level: "routine", trigger_ids: [], evidence: "", unsure: false });
    expect(mergeAssessments(phrases, model).level).toBe("emergency");
    const raised = mergeAssessments(classifyByPhrases(rules, "he's acting a bit odd"), parseTriageAnswer(rules, { level: "urgent", trigger_ids: [], evidence: "acting odd", unsure: true }));
    expect(raised).toMatchObject({ level: "urgent", unsure: true });
    expect(raised.matches[0]!.triggerId).toBe(UNCLASSIFIED_CONCERN);
  });
});
