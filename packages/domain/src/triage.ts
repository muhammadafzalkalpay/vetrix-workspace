// Triage: decides how urgent a caller's words are and what the front desk
// must do about it. Pure, so the sandbox AI, the Azure AI and the tests all
// share the same rules (pack v0.2 triage.json):
// - every caller utterance is checked, for the whole call;
// - phrases are examples, not a complete list, so a classifier decides by
//   meaning (Azure) or by phrases plus broad cues (sandbox);
// - known pet names are masked so a dog called Chocolate is not a poisoning;
// - when unsure, escalate; and a level never goes down within a call.

export type TriageLevel = "routine" | "urgent" | "emergency";

const RANK: Record<TriageLevel, number> = { routine: 0, urgent: 1, emergency: 2 };

export function higherLevel(a: TriageLevel, b: TriageLevel): TriageLevel {
  return RANK[b] > RANK[a] ? b : a;
}

/** The parts of the pack's triage.json these rules read. */
export interface TriageRules {
  classification: { exclude_known_pet_names: boolean };
  levels: {
    emergency: { transfer_summary_template: string };
    urgent: { service_id: string; fallback_if_no_slot: string };
  };
  emergency_triggers: TriageTrigger[];
  urgent_triggers: TriageTrigger[];
  scripts: Record<string, string>;
}

export interface TriageTrigger {
  id: string;
  name: string;
  phrases: string[];
  species_weight?: string[];
}

export interface TriageMatch {
  level: Exclude<TriageLevel, "routine">;
  triggerId: string;
  triggerName: string;
  /** What in the caller's words matched (a pack phrase or a broad cue). */
  evidence: string;
}

export interface TriageAssessment {
  level: TriageLevel;
  matches: TriageMatch[];
  /** True when the level came from a broad cue rather than a named trigger. */
  unsure: boolean;
}

/** Trigger ids used when the classifier escalates without a named trigger. */
export const UNCLASSIFIED_EMERGENCY = "unclassified_emergency";
export const UNCLASSIFIED_CONCERN = "unclassified_concern";

// ---------- Sandbox classifier ----------

/** Lower case, straight apostrophes removed ("can't" → "cant"), punctuation to spaces. */
export function normalizeUtterance(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

const EATING = ["ate", "eaten", "eat", "eating", "swallowed", "got into", "chewed", "licked", "had"];
const DETERMINERS = ["", "some ", "a ", "an ", "the ", "my ", "our ", "a lot of ", "a bag of ", "a box of ", "a bar of "];

/**
 * Replaces known pet names with "pet" so they cannot trigger, except where
 * the words say the name is being eaten ("ate some chocolate"): there the
 * word is the substance, not the pet, and must still count.
 */
export function maskPetNames(normalized: string, petNames: readonly string[]): string {
  let out = normalized;
  for (const raw of petNames) {
    const name = normalizeUtterance(raw).trim();
    if (!name) continue;
    const eatenForms = EATING.flatMap((v) => DETERMINERS.map((d) => ` ${v} ${d}${name} `));
    // Protect the eaten forms, mask the rest, then restore.
    const kept: string[] = [];
    for (const form of eatenForms) {
      while (out.includes(form)) {
        kept.push(form);
        out = out.replace(form, ` \u0000${kept.length - 1}\u0000 `);
      }
    }
    out = out.split(` ${name} `).join(" pet ");
    // split/join misses back-to-back repeats ("name name"); run once more.
    out = out.split(` ${name} `).join(" pet ");
    out = out.replace(/ ?\u0000(\d+)\u0000 ?/g, (_, i: string) => kept[Number(i)]!);
  }
  return out;
}

// Broad cues: the sandbox cannot read meaning, so anything that sounds
// serious but matches no named trigger is escalated (pack: when unsure,
// escalate). The Azure classifier replaces this with real understanding.
const EMERGENCY_CUES = ["emergency", "dying", "not breathing", "stopped breathing", "isnt breathing", "barely breathing", "having a fit"];
const CONCERN_CUES = [
  "bleeding", "blood", "bloody", "vomit", "vomiting", "vomited", "throwing up", "threw up", "diarrhea", "diarrhoea",
  "pain", "hurt", "hurts", "hurting", "injured", "injury", "limping", "swollen", "swelling", "not eating", "wont eat",
  "lethargic", "weak", "collapsed", "shaking", "trembling", "lump",
];

function containsPhrase(normalizedText: string, phrase: string): boolean {
  const p = normalizeUtterance(phrase);
  return p.trim().length > 0 && normalizedText.includes(p);
}

/**
 * The sandbox AI's classifier: pack phrases (by whole words, ignoring
 * apostrophes and case) first, then broad cues that escalate when unsure.
 */
export function classifyByPhrases(rules: TriageRules, text: string, context: { petNames?: readonly string[] } = {}): TriageAssessment {
  let normalized = normalizeUtterance(text);
  if (rules.classification.exclude_known_pet_names && context.petNames?.length) {
    normalized = maskPetNames(normalized, context.petNames);
  }
  const matches: TriageMatch[] = [];
  const scan = (triggers: TriageTrigger[], level: TriageMatch["level"]) => {
    for (const t of triggers) {
      const phrase = t.phrases.find((p) => containsPhrase(normalized, p));
      if (phrase) matches.push({ level, triggerId: t.id, triggerName: t.name, evidence: phrase });
    }
  };
  scan(rules.emergency_triggers, "emergency");
  scan(rules.urgent_triggers, "urgent");
  if (matches.length > 0) {
    const level = matches.some((m) => m.level === "emergency") ? "emergency" : "urgent";
    return { level, matches, unsure: false };
  }
  const emergencyCue = EMERGENCY_CUES.find((c) => containsPhrase(normalized, c));
  if (emergencyCue) {
    return { level: "emergency", unsure: true, matches: [{ level: "emergency", triggerId: UNCLASSIFIED_EMERGENCY, triggerName: "Caller describes an emergency", evidence: emergencyCue }] };
  }
  const concernCue = CONCERN_CUES.find((c) => containsPhrase(normalized, c));
  if (concernCue) {
    return { level: "urgent", unsure: true, matches: [{ level: "urgent", triggerId: UNCLASSIFIED_CONCERN, triggerName: "Possible illness or injury", evidence: concernCue }] };
  }
  return { level: "routine", matches: [], unsure: false };
}

// ---------- Call state ----------

export interface TriageState {
  level: TriageLevel;
  /** Every trigger seen in this call, first time each. */
  matches: TriageMatch[];
}

export const initialTriage: TriageState = { level: "routine", matches: [] };

/**
 * Folds one utterance's assessment into the call. The level only ever goes
 * up (pack: never lower a level within a call), so a caller saying "it's not
 * that bad" after an emergency changes nothing.
 */
export function applyAssessment(state: TriageState, assessment: TriageAssessment): { state: TriageState; escalated: boolean; newMatches: TriageMatch[] } {
  const seen = new Set(state.matches.map((m) => m.triggerId));
  const newMatches = assessment.matches.filter((m) => !seen.has(m.triggerId));
  const level = higherLevel(state.level, assessment.level);
  return { state: { level, matches: [...state.matches, ...newMatches] }, escalated: RANK[level] > RANK[state.level], newMatches };
}

/** The trigger to report for the call's level: the first one at that level. */
export function leadingMatch(state: TriageState): TriageMatch | null {
  return state.matches.find((m) => m.level === state.level) ?? null;
}

// ---------- What to do ----------

export interface TriageSituation {
  /** The clinic is open now. */
  open: boolean;
  /** The number to warm-transfer emergencies to; null when not configured. */
  transferNumber: string | null;
  afterHoursBehaviour: "er_only" | "er_and_book_next";
  er: { name: string | null; phone: string | null; address: string | null };
  /** True when an earlier transfer attempt in this call failed. */
  transferFailed?: boolean;
}

export type TriageAction =
  | { kind: "continue" }
  | {
      kind: "book_urgent";
      serviceId: string;
      fallbackServiceId: string;
    }
  | { kind: "transfer"; to: string; say: string }
  | {
      kind: "er_referral";
      say: string;
      /** Text the ER details to the caller. */
      sendErDetails: boolean;
      /** Raise an urgent staff alert (after hours, or a failed transfer). */
      staffAlert: boolean;
      /** Also offer the next available slot (after-hours setting). */
      offerNextSlot: boolean;
      reason: "after_hours" | "no_transfer_line" | "transfer_failed";
    };

const ER_FALLBACK = {
  name: "the nearest emergency veterinary hospital",
  address: "the closest location you can reach",
  phone: "the number on their website",
};

export function erValues(er: TriageSituation["er"]) {
  const configured = Boolean(er.name && er.phone && er.address);
  return {
    configured,
    values: configured ? { er_name: er.name!, er_phone: er.phone!, er_address: er.address! } : { er_name: ER_FALLBACK.name, er_phone: ER_FALLBACK.phone, er_address: ER_FALLBACK.address },
  };
}

/** Fills {{placeholders}}; a missing value leaves no braces behind. */
export function fillScript(template: string, values: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, key: string) => {
    const v = values[key];
    return v === null || v === undefined || v === "" ? "" : String(v);
  }).replace(/\s{2,}/g, " ").trim();
}

/**
 * The action for the call's current level. Emergencies transfer only to an
 * open clinic with a configured line (never to a closed line); otherwise the
 * caller gets the ER partner's details by voice and text.
 */
export function decideTriageAction(rules: TriageRules, level: TriageLevel, situation: TriageSituation): TriageAction {
  if (level === "routine") return { kind: "continue" };
  if (level === "urgent") {
    return { kind: "book_urgent", serviceId: rules.levels.urgent.service_id, fallbackServiceId: rules.levels.urgent.fallback_if_no_slot };
  }
  const { values } = erValues(situation.er);
  if (situation.open && situation.transferNumber && !situation.transferFailed) {
    return { kind: "transfer", to: situation.transferNumber, say: fillScript(rules.scripts.emergency_in_hours ?? "", values) };
  }
  if (situation.transferFailed) {
    return {
      kind: "er_referral",
      say: fillScript(rules.scripts.emergency_transfer_failed ?? rules.scripts.emergency_after_hours ?? "", values),
      sendErDetails: true,
      staffAlert: true,
      offerNextSlot: false,
      reason: "transfer_failed",
    };
  }
  const afterHours = !situation.open;
  return {
    kind: "er_referral",
    say: fillScript(rules.scripts.emergency_after_hours ?? "", values),
    sendErDetails: true,
    staffAlert: true,
    offerNextSlot: afterHours && situation.afterHoursBehaviour === "er_and_book_next",
    reason: afterHours ? "after_hours" : "no_transfer_line",
  };
}

/** One line for the staff member who picks up a warm transfer. */
export function transferSummary(
  rules: TriageRules,
  state: TriageState,
  who: { patientName?: string | null; species?: string | null; ageBand?: string | null; clientFirstName?: string | null; mobile?: string | null },
): string {
  const lead = leadingMatch(state);
  return fillScript(rules.levels.emergency.transfer_summary_template, {
    trigger_name: lead?.triggerName ?? "Caller describes an emergency",
    patient_name: who.patientName ?? "Pet not identified",
    species: who.species ?? "species unknown",
    age_band: who.ageBand ?? "age unknown",
    client_first_name: who.clientFirstName ?? "Caller",
    mobile: who.mobile ?? "number withheld",
  })
    .replace(/\s+,/g, ",")
    .replace(/,\s*\./g, ".");
}
