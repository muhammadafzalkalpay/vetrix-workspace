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
    for (let i = 0; i < 2; i++) {
      // Twice: split/join misses back-to-back repeats ("name name").
      out = out.split(` ${name} `).join(" pet ");
      out = out.split(` ${name}s `).join(" pets "); // possessive: "Lily's"
    }
    out = out.replace(/ ?\u0000(\d+)\u0000 ?/g, (_, i: string) => kept[Number(i)]!);
  }
  return out;
}

// Broad cues: the sandbox cannot read meaning, so anything that sounds
// serious but matches no named trigger is escalated (pack: when unsure,
// escalate). The Azure classifier replaces this with real understanding.
const EMERGENCY_CUES = ["emergency", "dying", "not breathing", "stopped breathing", "isnt breathing", "barely breathing", "having a fit"];
const CONCERN_CUES = [
  "bleeding", "blood", "bloody", "vomit", "vomiting", "vomited", "diarrhea", "diarrhoea",
  "pain", "hurt", "hurts", "hurting", "injured", "injury", "limping", "swollen", "swelling", "not eating", "wont eat",
  "lethargic", "weak", "collapsed", "shaking", "trembling", "acting weird", "acting strange", "not acting right",
];
// Possible ingestion of something unknown: pack regression "say something
// unclear about a possible poisoning, the AI must escalate".
const INGESTION_CUES = [
  "gotten into", "got into something", "got into the", "get into something", "ate something", "eaten something",
  "might have eaten", "may have eaten", "swallowed", "chewed something", "chewed up", "licked something", "into the trash",
  "into the garbage", "into the medicine", "into my pills", "into the pills",
];

// Same meaning, different words: both the caller's text and the pack phrases
// are rewritten this way before comparing.
const SYNONYMS: [RegExp, string][] = [
  [/ throwing up /g, " vomiting "],
  [/ throw up /g, " vomit "],
  [/ threw up /g, " vomited "],
  [/ thrown up /g, " vomited "],
  [/ puking /g, " vomiting "],
  [/ puke /g, " vomit "],
  [/ tummy /g, " belly "],
  [/ stomach /g, " belly "],
  [/ abdomen /g, " belly "],
  [/ cannot /g, " cant "],
  [/ can not /g, " cant "],
  [/ will not /g, " wont "],
];
// Small words that change nothing about urgency ("nothing IS coming out").
const FILLER = new Set(["is", "are", "was", "were", "be", "the", "a", "an", "just", "really", "so", "very", "all", "my", "his", "her", "our", "their", "its", "of", "keeps", "keep", "kept"]);

/** Normalized, synonyms applied, filler words removed: " nothing coming out ". */
export function canonicalUtterance(text: string): string {
  let n = text.startsWith(" ") && text.endsWith(" ") ? text : normalizeUtterance(text);
  for (const [re, to] of SYNONYMS) n = n.replace(re, to);
  return ` ${n.trim().split(" ").filter((w) => w && !FILLER.has(w)).join(" ")} `;
}

// Everyday phrases that contain a trigger word but are not symptoms.
const BENIGN: RegExp[] = [
  / fit(?:ting|s)? (?:\w+ ){0,2}in /g, // "thanks for fitting us in"
  / chocolate lab(?:rador)?s? /g, // a dog's colour, not food
  / seizure (?:meds|medicine|medication|medications|pills|tablets) /g,
  / kennel cough (?:vaccine|vaccination|shot|booster) /g,
  / lily (?:pad|of the valley pad) /g,
];

function stripBenign(normalized: string): string {
  let out = normalized;
  for (const re of BENIGN) out = out.replace(re, " ");
  return out.replace(/ {2,}/g, " ");
}

function containsPhrase(canonicalText: string, phrase: string): boolean {
  const p = canonicalUtterance(phrase);
  return p.trim().length > 0 && canonicalText.includes(p);
}

/**
 * Pet names the caller introduces in the same breath ("my dog Lily", "his
 * name is Max", "named Chocolate"), so they are masked like known names.
 */
export function introducedPetNames(text: string): string[] {
  const out = new Set<string>();
  // "my dog Lily": the name must be capitalised, so "my dog barks" is not a name.
  for (const m of text.matchAll(/\b(?:my|our|the)\s+(?:dog|cat|puppy|kitten|pup|kitty|bunny|rabbit|bird|boy|girl|pet)\s+([a-zA-Z][a-zA-Z'-]+)/gi)) {
    if (m[1] && /^[A-Z]/.test(m[1])) out.add(m[1]);
  }
  for (const m of text.matchAll(/\b(?:named|called)\s+([A-Za-z][a-zA-Z'-]+)/gi)) if (m[1]) out.add(m[1]);
  for (const m of text.matchAll(/\b(?:his|her|its|their)\s+name\s+is\s+([A-Za-z][a-zA-Z'-]+)/gi)) if (m[1]) out.add(m[1]);
  return [...out];
}

/**
 * The sandbox AI's classifier: pack phrases (by whole words, ignoring
 * apostrophes, case, filler words and common synonyms) first, then broad
 * cues that escalate when unsure.
 */
export function classifyByPhrases(rules: TriageRules, text: string, context: { petNames?: readonly string[] } = {}): TriageAssessment {
  let normalized = normalizeUtterance(text);
  const names = [...(context.petNames ?? []), ...introducedPetNames(text)];
  if (rules.classification.exclude_known_pet_names && names.length) {
    normalized = maskPetNames(normalized, names);
  }
  const canonical = canonicalUtterance(stripBenign(normalized));
  const matches: TriageMatch[] = [];
  const scan = (triggers: TriageTrigger[], level: TriageMatch["level"]) => {
    for (const t of triggers) {
      const phrase = t.phrases.find((p) => containsPhrase(canonical, p));
      if (phrase) matches.push({ level, triggerId: t.id, triggerName: t.name, evidence: phrase });
    }
  };
  scan(rules.emergency_triggers, "emergency");
  scan(rules.urgent_triggers, "urgent");
  const ingestion = INGESTION_CUES.find((c) => containsPhrase(canonical, c));
  if (ingestion && !matches.some((m) => m.triggerId === "toxin_ingestion")) {
    const toxin = rules.emergency_triggers.find((t) => t.id === "toxin_ingestion");
    matches.unshift({ level: "emergency", triggerId: toxin?.id ?? UNCLASSIFIED_EMERGENCY, triggerName: toxin?.name ?? "Possible poisoning", evidence: ingestion });
  }
  if (matches.length > 0) {
    const level = matches.some((m) => m.level === "emergency") ? "emergency" : "urgent";
    matches.sort((a, b) => (a.level === b.level ? 0 : a.level === "emergency" ? -1 : 1));
    return { level, matches, unsure: Boolean(ingestion) };
  }
  const emergencyCue = EMERGENCY_CUES.find((c) => containsPhrase(canonical, c));
  if (emergencyCue) {
    return { level: "emergency", unsure: true, matches: [{ level: "emergency", triggerId: UNCLASSIFIED_EMERGENCY, triggerName: "Caller describes an emergency", evidence: emergencyCue }] };
  }
  const concernCue = CONCERN_CUES.find((c) => containsPhrase(canonical, c));
  if (concernCue) {
    return { level: "urgent", unsure: true, matches: [{ level: "urgent", triggerId: UNCLASSIFIED_CONCERN, triggerName: "Possible illness or injury", evidence: concernCue }] };
  }
  return { level: "routine", matches: [], unsure: false };
}

const DOWNPLAY = [
  "think hes fine", "think shes fine", "think its fine", "hes fine", "shes fine", "seems fine", "probably fine", "not that bad",
  "not so bad", "still wagging", "still eating", "can wait", "ill wait", "wait till", "wait until", "just book", "no big deal",
];

/** The caller plays down what they described (pack script caller_downplays). */
export function callerDownplays(text: string): boolean {
  const n = normalizeUtterance(text);
  return DOWNPLAY.some((d) => n.includes(` ${d} `) || n.includes(` ${d}`));
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
