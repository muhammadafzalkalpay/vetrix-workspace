// How the sandbox AI reads a caller's words. It is deliberately simple: a few
// patterns for yes/no, names, species, services and choices. The Azure AI
// replaces this with real understanding; the booking and triage rules stay
// in the engine either way.
import type { Species } from "./clients";
import { normalizeUtterance } from "./triage";
import { dateRange, localParts, minutesToTime, weekdayOf, zonedInstant } from "./time";

const has = (text: string, words: readonly string[]) => {
  const n = normalizeUtterance(text);
  return words.some((w) => n.includes(normalizeUtterance(w)));
};

export function isYes(text: string): boolean {
  return has(text, ["yes", "yeah", "yep", "yup", "sure", "ok", "okay", "please", "that works", "sounds good", "perfect", "great", "correct", "right", "book it"]);
}

export function isNo(text: string): boolean {
  return has(text, ["no", "nope", "neither", "nah", "not really", "dont", "none", "other times", "something else", "doesnt work", "wont work", "cant make"]);
}

export function isGoodbye(text: string): boolean {
  return has(text, ["bye", "goodbye", "thats all", "thats it", "nothing else", "no thanks", "no thank you", "im good", "all good"]);
}

const SPECIES_WORDS: [Species, string[]][] = [
  ["dog", ["dog", "puppy", "pup", "doggy"]],
  ["cat", ["cat", "kitten", "kitty"]],
  ["rabbit", ["rabbit", "bunny"]],
  ["bird", ["bird", "parrot", "budgie", "parakeet", "cockatiel"]],
  ["reptile", ["reptile", "lizard", "snake", "gecko", "turtle", "tortoise", "iguana"]],
];

export function speciesFromWords(text: string): Species | null {
  for (const [species, words] of SPECIES_WORDS) if (has(text, words)) return species;
  return null;
}

const NAME_LEADS = [
  /\bmy name is\s+/i, /\bthis is\s+/i, /\bit'?s\s+/i, /\bi am\s+/i, /\bi'?m\s+/i, /\bname'?s\s+/i,
  /\b(?:his|her|their) name is\s+/i, /\b(?:he|she|it)'?s called\s+/i, /\bcalled\s+/i, /\bnamed\s+/i,
];
const NOT_NAMES = new Set(["a", "an", "the", "my", "our", "dog", "cat", "puppy", "kitten", "and", "he", "she", "it", "is", "yes", "no", "hi", "hello", "hey", "for", "please", "she's", "he's", "it's", "shes", "hes", "they", "they're", "who", "was", "with", "thanks", "thank"]);

const titleCase = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

/** Up to `max` name words from a reply like "It's Sam Lee" or "her name is Lady Grey". */
export function parseName(text: string, max = 2): string[] {
  let rest = text.trim();
  for (const lead of NAME_LEADS) {
    const m = rest.match(lead);
    if (m && m.index !== undefined) {
      rest = rest.slice(m.index + m[0].length);
      break;
    }
  }
  const words = rest
    .split(/[\s,.!?;:]+/)
    .map((w) => w.replace(/[^A-Za-z'’-]/g, ""))
    .filter((w) => w.length > 0 && w.length <= 30);
  const out: string[] = [];
  for (const w of words) {
    if (NOT_NAMES.has(w.toLowerCase())) {
      if (out.length > 0) break;
      continue;
    }
    out.push(titleCase(w));
    if (out.length >= max) break;
  }
  return out;
}

export type Intent = "book" | "reschedule" | "cancel" | "refill" | "advice" | "hours" | "staff" | "unknown";

/** What the caller wants, from their words. Booking is the default for anything about a pet's visit. */
export function detectIntent(text: string): Intent {
  if (has(text, ["reschedule", "move my appointment", "move the appointment", "move my visit", "move our appointment", "change my appointment", "change the appointment", "different time", "something came up"])) return "reschedule";
  if (has(text, ["cancel"])) return "cancel";
  if (has(text, ["refill", "prescription", "more medication", "more meds", "run out of", "ran out of"])) return "refill";
  if (has(text, ["should i give", "can i give", "what should i do", "is it normal", "is it safe", "how much should", "what can i give", "is that bad", "should i be worried"])) return "advice";
  if (has(text, ["opening hours", "your hours", "what time do you", "when do you open", "when do you close", "are you open", "open today", "open tomorrow"])) return "hours";
  if (has(text, ["speak to someone", "talk to someone", "speak to a person", "real person", "human", "receptionist", "front desk", "call me back", "speak to the doctor", "talk to the doctor", "my bill", "billing", "invoice"])) return "staff";
  if (has(text, ["book", "appointment", "appt", "schedule", "come in", "bring", "see the vet", "see a vet", "checkup", "check up", "visit", "exam", "vaccine", "shots", "seen", "due"])) return "book";
  return "unknown";
}

/** The parts of the pack's intake.json reason_for_visit the matcher reads. */
export interface KeywordRule {
  service_id: string;
  keywords: string[];
  requires?: { species?: string; sex?: "male" | "female"; age_band?: string; min_age_years?: Record<string, number> };
  ai_action?: string;
  override_to?: { service_id: string; if_keywords: string[] };
  controlled_substance_keywords?: string[];
  enabled_by_setting?: string;
}

export interface IntakeRules {
  keyword_to_service: KeywordRule[];
  default_by_type: { problem_words: string[]; problem_default: string; routine_default: string; new_patient_routine_default: string };
  unclear_fallback: { prompt: string; problem: string; routine: string };
}

export interface PetFacts {
  species: Species | null;
  sex: "male" | "female" | null;
  neutered: boolean | null;
  ageMonths: number | null;
  isNew: boolean;
}

export interface ServiceMatch {
  serviceId: string;
  /** The caller asked for a spay for a male (or the reverse). */
  sexMismatch?: boolean;
  /** A controlled drug named in a refill request (never discuss quantity). */
  controlled?: string;
}

const STERILISE_REQUEST = /\b(spay|neuter|castrate)\b|\b(get|getting|have|having|book|schedule|want|need|needs|to be)\b(?:\s+\S+){0,3}\s+(spayed|neutered|fixed)\b/i;

/** Removes "he's neutered" style descriptions so they are not read as requests. */
function withoutSterilisationStatus(text: string): string {
  return STERILISE_REQUEST.test(text) ? text : text.replace(/\b(spayed|neutered|fixed|intact)\b/gi, " ");
}

const containsWords = (normalized: string, phrase: string) => {
  const p = normalizeUtterance(phrase);
  return p.trim().length > 0 && normalized.includes(p);
};

/** Owner phrasing the keyword lists cannot hold (a name in the middle, or a removal request). */
const PATTERNS: [string, RegExp][] = [
  ["euthanasia", /\bput (?:\w+ ){1,2}(?:to sleep|down)\b/],
  ["mass_removal", /\b(lump|mass|growth|tumou?r|bump)\b.*\bremov|\bremov\w*\b.*\b(lump|mass|growth|tumou?r|bump)\b/],
];

/**
 * The pack service a request points to (intake.json keyword_to_service):
 * the longest matching keyword wins, then the rule's requirements pick the
 * variant for the pet (spay or neuter, dog or cat, puppy or senior).
 */
export function matchService(text: string, pet: PetFacts | null, intake: IntakeRules): ServiceMatch | null {
  const normalized = normalizeUtterance(withoutSterilisationStatus(text));
  const pattern = PATTERNS.find(([, re]) => re.test(normalized));
  const candidates: { rule: KeywordRule; length: number }[] = [];
  for (const rule of intake.keyword_to_service) {
    if (rule.enabled_by_setting) continue; // e.g. telehealth: off unless the clinic turns it on
    const hit = rule.keywords.filter((k) => containsWords(normalized, k)).sort((a, b) => b.length - a.length)[0];
    if (hit) candidates.push({ rule, length: normalizeUtterance(hit).length });
  }
  let chosen: ServiceMatch | null = null;
  if (pattern) chosen = { serviceId: pattern[0] };
  else if (candidates.length) {
    const best = Math.max(...candidates.map((c) => c.length));
    const top = candidates.filter((c) => c.length === best).map((c) => c.rule);
    const fits = (r: KeywordRule) => {
      const q = r.requires;
      if (!q) return true;
      if (q.species && pet?.species && q.species !== pet.species) return false;
      if (q.sex && pet?.sex && q.sex !== pet.sex) return false;
      if (q.age_band === "puppy_kitten_under_6m" && pet?.ageMonths != null && pet.ageMonths >= 6) return false;
      if (q.min_age_years && pet?.ageMonths != null && pet.species && pet.ageMonths < (q.min_age_years[pet.species] ?? 0) * 12) return false;
      return true;
    };
    const sameSpecies = (r: KeywordRule) => !r.requires?.species || !pet?.species || r.requires.species === pet.species;
    const rule = top.find(fits) ?? top.find(sameSpecies) ?? top[0]!;
    chosen = { serviceId: rule.service_id };
    if (rule.requires?.sex && pet?.sex && rule.requires.sex !== pet.sex) chosen.sexMismatch = true;
    if (rule.override_to && rule.override_to.if_keywords.some((k) => containsWords(normalized, k))) chosen = { serviceId: rule.override_to.service_id };
    const controlled = rule.controlled_substance_keywords?.find((k) => containsWords(normalized, k));
    if (controlled) chosen.controlled = controlled;
  } else if (intake.default_by_type.problem_words.some((w) => containsWords(normalized, w))) {
    chosen = { serviceId: intake.default_by_type.problem_default };
  }
  if (!chosen) return null;
  return { ...chosen, serviceId: adjustServiceForPet(chosen.serviceId, pet, intake) };
}

/** Picks the right variant of a service once the pet is known. */
export function adjustServiceForPet(id: string, pet: PetFacts | null, intake?: IntakeRules): string {
  const sterilise = /^(spay|neuter)_(canine|feline)$/.exec(id);
  if (sterilise && pet?.species && (pet.species === "dog" || pet.species === "cat")) {
    return `${sterilise[1]}_${pet.species === "dog" ? "canine" : "feline"}`;
  }
  if (["wellness_exam", "wellness_exam_new", "senior_wellness", "puppy_kitten_visit"].includes(id) && pet) {
    if (pet.ageMonths !== null && pet.ageMonths < 6) return "puppy_kitten_visit";
    if (pet.isNew) return intake?.default_by_type.new_patient_routine_default ?? "wellness_exam_new";
    const senior = intake?.keyword_to_service.find((r) => r.service_id === "senior_wellness")?.requires?.min_age_years ?? { dog: 7, cat: 10 };
    if (pet.ageMonths !== null && pet.species && senior[pet.species] !== undefined && pet.ageMonths >= senior[pet.species]! * 12) return "senior_wellness";
    return id === "puppy_kitten_visit" ? "wellness_exam" : id === "senior_wellness" ? "senior_wellness" : "wellness_exam";
  }
  return id;
}

// ---------- Reading answers ----------

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, eighteen: 18, twenty: 20,
};

/** "four year old", "6 months", "8 weeks", "a puppy": age in months; undefined when not said. */
export function parseAgeMonths(text: string): number | null | undefined {
  const n = normalizeUtterance(text);
  if (/ (not sure|no idea|dont know|unsure) /.test(n)) return null;
  const m = n.match(/ (\d+|[a-z]+) (?:and a half )?(year|yr|month|week)s? ?(?:old)? /);
  if (m) {
    const count = /^\d+$/.test(m[1]!) ? Number(m[1]) : NUMBER_WORDS[m[1]!];
    if (count !== undefined) {
      const half = n.includes(" and a half ") ? 0.5 : 0;
      if (m[2] === "week") return Math.max(0, Math.round(((count + half) * 7) / 30));
      if (m[2] === "month") return Math.round(count + half);
      return Math.round((count + half) * 12);
    }
  }
  if (/ (puppy|kitten) /.test(n)) return 3;
  if (/ (senior|old dog|old cat|elderly) /.test(n)) return null;
  return undefined;
}

export function parseSex(text: string): "male" | "female" | null | undefined {
  const n = normalizeUtterance(text);
  if (/ (boy|male|he|him|his|hes|stud|tom) /.test(n)) return "male";
  if (/ (girl|female|she|her|shes|queen) /.test(n)) return "female";
  if (/ (not sure|dont know) /.test(n)) return null;
  return undefined;
}

/** Spayed or neutered? true, false, null for "not sure", undefined when not answered. */
export function parseNeutered(text: string): boolean | null | undefined {
  const n = normalizeUtterance(text);
  if (/ (not sure|dont know|no idea) /.test(n)) return null;
  if (/ (not|isnt|hasnt|never been|intact) /.test(n) || / no /.test(n)) return false;
  if (/ (spayed|neutered|fixed|yes|yeah|yep|already) /.test(n)) return true;
  return undefined;
}

export function parseYesNo(text: string): boolean | null {
  if (isNo(text)) return false;
  if (isYes(text)) return true;
  return null;
}

export function parseEmail(text: string): string | null {
  return text.match(/[^\s@<>(),;:]+@[^\s@<>(),;:]+\.[a-z]{2,}/i)?.[0]?.toLowerCase() ?? null;
}

/** A US phone number in the text, as 10 digits, or null. */
export function parsePhoneDigits(text: string): string | null {
  const m = text.match(/(?:\+?1[\s.-]?)?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/);
  return m ? `${m[1]}${m[2]}${m[3]}` : null;
}

/** "a lab mix", "mixed", "not sure": the breed as said, or null. */
export function parseBreed(text: string): string | null {
  const t = text.trim().replace(/[.!?]+$/, "");
  if (/\b(not sure|no idea|don'?t know|mixed?|mutt|unknown)\b/i.test(t) && t.split(/\s+/).length <= 3) return /mix/i.test(t) ? "Mixed" : null;
  const m = t.replace(/^(?:(?:he|she|it)(?:'s| is)|they(?:'re| are)|a|an|it'?s)\s+/i, "").replace(/^(a|an)\s+/i, "");
  return m ? m.slice(0, 40).replace(/^./, (c) => c.toUpperCase()) : null;
}

/** Details a new caller may give in one breath. */
export interface SentenceFacts {
  firstName?: string;
  lastName?: string;
  phoneDigits?: string;
  petName?: string;
  species?: Species;
  ageMonths?: number | null;
  sex?: "male" | "female";
  neutered?: boolean;
  breed?: string;
}

export function extractFacts(text: string): SentenceFacts {
  const out: SentenceFacts = {};
  // "I'm Dana Price": the lead words in any case, the name capitalised ("I'm calling" is not a name).
  for (const who of text.matchAll(/\b(?:i'?m|i am|my name is|this is)\s+([a-zA-Z][a-zA-Z'-]+)(?:\s+([a-zA-Z][a-zA-Z'-]+))?/gi)) {
    if (!/^[A-Z]/.test(who[1]!)) continue;
    out.firstName = who[1]!;
    if (who[2] && /^[A-Z]/.test(who[2])) out.lastName = who[2];
    break;
  }
  const phone = parsePhoneDigits(text);
  if (phone) out.phoneDigits = phone;
  const pet = text.match(/\b(?:his|her|its|their)\s+name\s+is\s+([A-Za-z][a-zA-Z'-]+)/i) ?? text.match(/\b(?:named|called)\s+([A-Z][a-zA-Z'-]+)/) ?? text.match(/\b(?:my|our)\s+(?:dog|cat|puppy|kitten|pup|kitty)\s+([A-Z][a-zA-Z'-]+)/);
  if (pet) out.petName = titleCase(pet[1]!);
  const species = speciesFromWords(text);
  if (species) out.species = species;
  const age = parseAgeMonths(text);
  if (typeof age === "number") out.ageMonths = age;
  if (/\b(his name|he'?s|he is|him)\b/i.test(text)) out.sex = "male";
  else if (/\b(her name|she'?s|she is)\b/i.test(text)) out.sex = "female";
  if (!STERILISE_REQUEST.test(text)) {
    if (/\b(not (?:spayed|neutered|fixed)|intact)\b/i.test(text)) out.neutered = false;
    else if (/\b(spayed|neutered|fixed)\b/i.test(text)) out.neutered = true;
  }
  const breed = text.match(/\b(?:\d+|[a-z]+)[\s-]year[\s-]old\s+([a-z][a-z\s]{1,30}?)(?:,|\.|$|\s+(?:and|who|that))/i);
  if (breed && !/^(dog|cat|puppy|kitten|boy|girl)$/i.test(breed[1]!.trim())) out.breed = breed[1]!.trim().replace(/^./, (c) => c.toUpperCase());
  return out;
}

const DEATH_WORDS = ["passed away", "died", "no longer with us", "crossed the rainbow bridge", "rainbow bridge", "we lost", "has passed", "she passed", "he passed", "is dead", "was put down", "had him put down", "had her put down", "was put to sleep", "had him put to sleep", "had her put to sleep"];

/** The caller says a pet has already died (retention.json deceased_phrases, past tense only). */
export function deathMentioned(text: string): boolean {
  return has(text, DEATH_WORDS);
}

export function wantsSeveralPets(text: string): boolean {
  return has(text, ["two of my pets", "both of them", "both pets", "all of them", "book them together", "them together", "both dogs", "both cats", "two pets", "three pets", "my pets are due"]);
}

/** Which offered option the caller chose: an index, "none" for neither, or null when unclear. */
export function pickOffered(text: string, offered: { start: number }[], timezone: string): number | "none" | null {
  const n = normalizeUtterance(text);
  const second = /\b(second|2nd|two|2|later one|last one|other one|afternoon one|latter)\b/.test(n);
  const first = /\b(first|1st|1|earlier|earliest|morning one|former|sooner)\b/.test(n);
  // A time the caller says ("10:30", "3 pm", "9 o'clock") picks the matching option.
  for (let i = 0; i < offered.length; i++) {
    const m = localParts(offered[i]!.start, timezone).minutes;
    const h24 = Math.floor(m / 60);
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    const min = m % 60;
    const spoken = min === 0
      ? [`${h12} ${h24 < 12 ? "am" : "pm"}`, `${h12} oclock`, `${h12} 00`]
      : [`${h12} ${String(min).padStart(2, "0")}`];
    if (spoken.some((s) => n.includes(` ${s} `))) return i;
  }
  if (second && offered.length > 1 && !first) return 1;
  if (first && !second) return 0;
  if (isNo(text)) return "none";
  if (offered.length === 1 && isYes(text)) return 0;
  if (offered.length > 1 && isYes(text) && !first && !second) return null;
  return null;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "today at 3:30 PM", "tomorrow at 9 AM" or "Tuesday, Nov 18 at 9 AM", in clinic time. */
export function slotLabel(start: number, timezone: string, now: number): string {
  const p = localParts(start, timezone);
  const today = localParts(now, timezone).date;
  const tomorrow = localParts(now + 86_400_000, timezone).date;
  const h24 = Math.floor(p.minutes / 60);
  const min = p.minutes % 60;
  const time = `${h24 % 12 === 0 ? 12 : h24 % 12}${min ? `:${String(min).padStart(2, "0")}` : ""} ${h24 < 12 ? "AM" : "PM"}`;
  if (p.date === today) return `today at ${time}`;
  if (p.date === tomorrow) return `tomorrow at ${time}`;
  const [, mm, dd] = p.date.split("-").map(Number);
  return `${WEEKDAYS[p.weekday]}, ${MONTHS[mm! - 1]} ${dd} at ${time}`;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function clock(hhmm: string): string {
  const h24 = Number(hhmm.slice(0, 2));
  const min = Number(hhmm.slice(3, 5));
  return `${h24 % 12 === 0 ? 12 : h24 % 12}${min ? `:${String(min).padStart(2, "0")}` : ""} ${h24 < 12 ? "AM" : "PM"}`;
}

/** "Monday to Friday, 7 AM to 6 PM; Saturday, 8 AM to 6 PM". Days with the same hours are grouped. */
export function describeHours(rows: { weekday: number; opens: string; closes: string }[]): string {
  const byDay = new Map<number, string>();
  for (const r of rows) {
    const span = `${clock(r.opens)} to ${clock(r.closes)}`;
    byDay.set(r.weekday, byDay.has(r.weekday) ? `${byDay.get(r.weekday)} and ${span}` : span);
  }
  // Week runs Monday to Sunday for reading.
  const order = [1, 2, 3, 4, 5, 6, 0];
  const groups: { from: number; to: number; span: string }[] = [];
  for (const d of order) {
    const span = byDay.get(d);
    if (!span) continue;
    const last = groups.at(-1);
    if (last && last.span === span && order.indexOf(d) === order.indexOf(last.to) + 1) last.to = d;
    else groups.push({ from: d, to: d, span });
  }
  if (groups.length === 0) return "by appointment only";
  return groups
    .map((g) => `${g.from === g.to ? DAY_NAMES[g.from] : `${DAY_NAMES[g.from]} to ${DAY_NAMES[g.to]}`}, ${g.span}`)
    .join("; ");
}

// ---------- Time requests ("tomorrow afternoon", "Friday at 3", "10:30") ----------

export interface TimeRequest {
  /** Search from this instant. */
  after: number;
  /** A specific time was asked for (clinic minutes after midnight). */
  minutes: number | null;
  /** The clinic date it applies to, YYYY-MM-DD. */
  date: string;
  part: "morning" | "afternoon" | "evening" | null;
}

const DAY_INDEX: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };

/**
 * A day and/or time the caller asks for, in clinic time. A bare number is not
 * a time ("2" may mean the second option): it needs a colon, am/pm, "at" or
 * "o'clock". Hours without am/pm are read as clinic hours (3 → 3 PM).
 */
export function parseTimeRequest(text: string, timezone: string, now: number): TimeRequest | null {
  const n = normalizeUtterance(text.replace(/(\d)\s*:\s*(\d{2})/g, "$1h$2"));
  const today = localParts(now, timezone).date;
  let date: string | null = null;
  if (/ today | this (?:morning|afternoon|evening) | tonight /.test(n)) date = today;
  else if (/ (tomorrow|tmrw|tmr) /.test(n)) date = dateRange(today, 2)[1]!;
  else if (/ next week /.test(n)) date = dateRange(today, 8)[7]!;
  else {
    const day = Object.keys(DAY_INDEX).find((d) => n.includes(` ${d} `) || n.includes(` ${d}s `));
    if (day) {
      const want = DAY_INDEX[day]!;
      date = dateRange(today, 8).find((d) => weekdayOf(d) === want) ?? null;
    }
  }
  let minutes: number | null = null;
  const t = n.match(/ (?:at |around |about |by )?(\d{1,2})(?:h(\d{2}))? ?(am|pm|oclock)? /g)?.map((x) => x.trim()).find((x) => /h\d{2}|am|pm|oclock|^(at|around|about|by) /.test(x));
  if (t) {
    const m = t.match(/(\d{1,2})(?:h(\d{2}))? ?(am|pm|oclock)?/)!;
    let h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    if (m[3] === "pm" && h < 12) h += 12;
    else if (m[3] === "am" && h === 12) h = 0;
    else if (!m[3] || m[3] === "oclock") h = h < 7 ? h + 12 : h; // clinic hours
    if (h <= 23 && min < 60) minutes = h * 60 + min;
  }
  const part = / morning /.test(n) ? "morning" : / (afternoon|after lunch) /.test(n) ? "afternoon" : / (evening|tonight|after work) /.test(n) ? "evening" : null;
  if (!date && minutes === null && !part) return null;
  const day = date ?? today;
  const from = minutes ?? (part === "afternoon" ? 12 * 60 : part === "evening" ? 16 * 60 : 0);
  return { after: zonedInstant(day, minutesToTime(from), timezone), minutes, date: day, part };
}
