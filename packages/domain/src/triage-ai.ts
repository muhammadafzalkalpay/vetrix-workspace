// Triage by a language model: the prompt, the answer format and the checks on
// the answer. Pure, so it can be tested without a network. The model only
// ever adds to the pack phrase rules: its answer is merged with
// classifyByPhrases and the higher level wins (pack v0.2: escalate when
// unsure, never lower).
import {
  UNCLASSIFIED_CONCERN,
  UNCLASSIFIED_EMERGENCY,
  type TriageAssessment,
  type TriageMatch,
  type TriageRules,
} from "./triage";

/** JSON schema the model must answer in (OpenAI structured outputs, strict). */
export const TRIAGE_ANSWER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["level", "trigger_ids", "evidence", "unsure"],
  properties: {
    level: { type: "string", enum: ["routine", "urgent", "emergency"] },
    trigger_ids: { type: "array", items: { type: "string" } },
    evidence: { type: "string", description: "The caller's words that led to the level, or empty for routine." },
    unsure: { type: "boolean" },
  },
} as const;

export function buildTriagePrompt(rules: TriageRules, text: string, petNames: readonly string[]): { system: string; user: string } {
  const list = (triggers: TriageRules["emergency_triggers"]) =>
    triggers.map((t) => `- ${t.id} (${t.name}): e.g. ${t.phrases.slice(0, 6).map((p) => `"${p}"`).join(", ")}`).join("\n");
  const system = [
    "You triage what a pet owner says to a veterinary clinic's front desk. You never give medical advice.",
    "Classify by meaning. The example phrases are examples, not a complete list: paraphrases, misspellings and other languages count.",
    "Levels: emergency = needs a doctor right now; urgent = should be seen today or tomorrow; routine = anything else, including booking talk.",
    "If you are unsure between two levels, choose the higher one and set unsure to true.",
    "A caller saying it is not that bad does not lower the level of a symptom they described.",
    petNames.length
      ? `These are the household's pet NAMES, not substances or symptoms: ${petNames.map((n) => `"${n}"`).join(", ")}. A pet called Chocolate is not chocolate, unless the words say something was eaten.`
      : "",
    "Use trigger ids from these lists only; leave trigger_ids empty for routine.",
    `Emergency triggers:\n${list(rules.emergency_triggers)}`,
    `Urgent triggers:\n${list(rules.urgent_triggers)}`,
    `If nothing fits but it is still serious, use "${UNCLASSIFIED_EMERGENCY}" or "${UNCLASSIFIED_CONCERN}".`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { system, user: text };
}

/** Checks the model's answer; anything malformed escalates instead of being trusted. */
export function parseTriageAnswer(rules: TriageRules, raw: unknown): TriageAssessment {
  const answer = (typeof raw === "string" ? safeJson(raw) : raw) as Record<string, unknown> | null;
  const level = answer?.level;
  if (!answer || (level !== "routine" && level !== "urgent" && level !== "emergency")) {
    return {
      level: "urgent",
      unsure: true,
      matches: [{ level: "urgent", triggerId: UNCLASSIFIED_CONCERN, triggerName: "Could not classify", evidence: "" }],
    };
  }
  if (level === "routine") return { level, matches: [], unsure: answer.unsure === true };
  const known = new Map<string, { name: string; level: "urgent" | "emergency" }>([
    ...rules.emergency_triggers.map((t) => [t.id, { name: t.name, level: "emergency" as const }] as const),
    ...rules.urgent_triggers.map((t) => [t.id, { name: t.name, level: "urgent" as const }] as const),
  ]);
  const evidence = typeof answer.evidence === "string" ? answer.evidence.slice(0, 200) : "";
  const ids = Array.isArray(answer.trigger_ids) ? answer.trigger_ids.filter((x): x is string => typeof x === "string") : [];
  const matches: TriageMatch[] = ids
    .map((id) => known.get(id) && { level: known.get(id)!.level, triggerId: id, triggerName: known.get(id)!.name, evidence })
    .filter((m): m is TriageMatch => Boolean(m));
  if (!matches.some((m) => m.level === level)) {
    matches.unshift(
      level === "emergency"
        ? { level, triggerId: UNCLASSIFIED_EMERGENCY, triggerName: "Caller describes an emergency", evidence }
        : { level, triggerId: UNCLASSIFIED_CONCERN, triggerName: "Possible illness or injury", evidence },
    );
  }
  // The stated level is the floor; a named emergency trigger lifts it.
  const top = matches.some((m) => m.level === "emergency") ? "emergency" : level;
  return { level: top, matches, unsure: answer.unsure === true };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const RANK = { routine: 0, urgent: 1, emergency: 2 } as const;

/** Combines two classifications: the higher level wins and every trigger is kept. */
export function mergeAssessments(a: TriageAssessment, b: TriageAssessment): TriageAssessment {
  const level = RANK[b.level] > RANK[a.level] ? b.level : a.level;
  const seen = new Set<string>();
  const matches = [...a.matches, ...b.matches].filter((m) => (seen.has(m.triggerId) ? false : (seen.add(m.triggerId), true)));
  // Put the matches that explain the final level first.
  matches.sort((x, y) => RANK[y.level] - RANK[x.level]);
  return { level, matches, unsure: a.unsure || b.unsure };
}
