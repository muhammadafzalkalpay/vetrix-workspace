// How the sandbox AI reads a caller's words. It is deliberately simple: a few
// patterns for yes/no, names, species, services and choices. The Azure AI
// replaces this with real understanding; the booking and triage rules stay
// in the engine either way.
import type { Species } from "./clients";
import { normalizeUtterance } from "./triage";
import { localParts } from "./time";

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
  if (has(text, ["reschedule", "move my appointment", "move the appointment", "change my appointment", "change the appointment", "different time"])) return "reschedule";
  if (has(text, ["cancel"])) return "cancel";
  if (has(text, ["refill", "prescription", "more medication", "more meds", "run out of", "ran out of"])) return "refill";
  if (has(text, ["should i give", "can i give", "what should i do", "is it normal", "is it safe", "how much should", "what can i give", "is that bad", "should i be worried"])) return "advice";
  if (has(text, ["opening hours", "your hours", "what time do you", "when do you open", "when do you close", "are you open", "open today", "open tomorrow"])) return "hours";
  if (has(text, ["speak to someone", "talk to someone", "speak to a person", "real person", "human", "receptionist", "front desk", "call me back", "speak to the doctor", "talk to the doctor"])) return "staff";
  if (has(text, ["book", "appointment", "appt", "schedule", "come in", "bring", "see the vet", "see a vet", "checkup", "check up", "visit", "exam", "vaccine", "shots", "seen"])) return "book";
  return "unknown";
}

/** Pack service ids by the words owners use. Order matters: the first match wins. */
const SERVICE_WORDS: [string, string[]][] = [
  ["euthanasia", ["put down", "put to sleep", "put him to sleep", "put her to sleep", "euthanasia", "euthanize", "euthanise", "end of life", "say goodbye", "pts"]],
  ["rx_refill_request", ["refill", "prescription"]],
  ["radiographs", ["x ray", "xray", "x rays", "radiograph"]],
  ["ultrasound", ["ultrasound"]],
  ["sedated_procedure", ["sedation", "sedated", "sedate"]],
  ["mass_removal", ["lump", "mass", "growth", "bump"]],
  ["dental_cleaning", ["dental", "teeth cleaning", "teeth clean", "clean her teeth", "clean his teeth"]],
  ["spay", ["spay", "spayed", "fixed"]],
  ["neuter", ["neuter", "neutered", "castrat"]],
  ["health_certificate", ["health certificate", "travel certificate", "travel papers", "flying", "travel"]],
  ["nail_trim", ["nail", "nails", "claws"]],
  ["anal_gland_expression", ["anal gland", "glands", "scooting"]],
  ["ear_cleaning", ["ear cleaning", "clean his ears", "clean her ears", "clean ears"]],
  ["microchip", ["microchip", "chip"]],
  ["heartworm_test", ["heartworm"]],
  ["suture_removal", ["stitches", "sutures", "suture"]],
  ["recheck_exam", ["recheck", "follow up", "follow-up", "check how", "re-check"]],
  ["behavior_consult", ["behavior", "behaviour", "aggressive", "anxiety", "anxious"]],
  ["nutrition_consult", ["nutrition", "diet", "weight loss", "food plan"]],
  ["weight_check", ["weigh", "weight check"]],
  ["blood_draw", ["blood test", "bloodwork", "blood work", "blood draw"]],
  ["vaccine_booster_tech", ["vaccine", "vaccines", "vaccination", "shots", "booster", "jab", "rabies"]],
  ["puppy_kitten_visit", ["puppy visit", "kitten visit", "new puppy", "new kitten", "puppy shots", "kitten shots"]],
  ["wellness_exam", ["wellness", "checkup", "check up", "check-up", "annual", "yearly", "physical", "exam"]],
  ["sick_visit", ["sick", "unwell", "not well", "not right", "problem", "issue", "worried"]],
];

/** Owner phrasing with the pet's name in the middle ("put Max to sleep"). */
const PATTERNS: [string, RegExp][] = [
  ["euthanasia", /\bput (?:\w+ ){1,2}(?:to sleep|down)\b/],
];

/**
 * The pack service a request points to, adjusted for the pet: spay and neuter
 * by species, senior wellness from 7 years, a first exam for new patients and
 * puppy or kitten visits under 6 months.
 */
export function matchService(text: string, pet: { species: Species; ageMonths: number | null; isNew: boolean } | null): string | null {
  const normalized = normalizeUtterance(text);
  // Puppy/kitten wording must beat the plain vaccine words.
  const ordered = [...SERVICE_WORDS].sort((a, b) => (a[0] === "puppy_kitten_visit" ? -1 : b[0] === "puppy_kitten_visit" ? 1 : 0));
  const id = PATTERNS.find(([, re]) => re.test(normalized))?.[0] ?? ordered.find(([, words]) => words.some((w) => normalized.includes(normalizeUtterance(w))))?.[0];
  return id ? adjustServiceForPet(id, pet) : null;
}

/** Picks the right variant of a service once the pet is known. */
export function adjustServiceForPet(id: string, pet: { species: Species; ageMonths: number | null; isNew: boolean } | null): string {
  if (id === "spay" || id === "neuter" || /^(spay|neuter)_/.test(id)) {
    const base = id.split("_")[0]!;
    return `${base}_${pet?.species === "cat" ? "feline" : "canine"}`;
  }
  if ((id === "wellness_exam" || id === "wellness_exam_new" || id === "senior_wellness") && pet) {
    if (pet.isNew) return "wellness_exam_new";
    if (pet.ageMonths !== null && pet.ageMonths < 6) return "puppy_kitten_visit";
    if (pet.ageMonths !== null && pet.ageMonths >= 84) return "senior_wellness";
    return "wellness_exam";
  }
  return id;
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
