// The AI front desk conversation (workflows W1, W2 and W6; pack v0.2,
// intake.json, 05-compliance.md). One engine serves texts and calls. It
// decides what to say and what to do; the database layer supplies a "port"
// (look up, book, move, cancel, create tasks, send texts, transfer), so the
// rules can be tested without a database and the OpenAI model can drive the
// same port later.
//
// Every caller turn is triaged first. An emergency stops whatever was
// happening; an urgent symptom switches the booking to a same or next day
// sick visit. Levels never go down within a conversation.
//
// Compliance: calls open with the recording disclosure; a known caller is
// verified with their mobile plus a pet's name before any pet or visit
// detail is discussed, and the pet list is never read out before that.
import { formatPhone, type Species, type TemperamentFlag } from "./clients";
import { ConflictError } from "./errors";
import {
  adjustServiceForPet,
  deathMentioned,
  detectIntent,
  extractFacts,
  isGoodbye,
  isNo,
  isYes,
  matchService,
  parseAgeMonths,
  parseBreed,
  parseEmail,
  parseName,
  parseNeutered,
  parsePhoneDigits,
  parseSex,
  parseTimeRequest,
  parseYesNo,
  pickOffered,
  slotLabel,
  speciesFromWords,
  wantsSeveralPets,
  type IntakeRules,
  type Intent,
  type PetFacts,
  type TimeRequest,
} from "./front-desk-language";
import { localParts } from "./time";
import {
  applyAssessment,
  callerDownplays,
  decideTriageAction,
  erValues,
  fillScript,
  initialTriage,
  leadingMatch,
  normalizeUtterance,
  transferSummary,
  type TriageAction,
  type TriageAssessment,
  type TriageLevel,
  type TriageMatch,
  type TriageRules,
  type TriageSituation,
  type TriageState,
} from "./triage";

// ---------- Scripts ----------

/** Verbatim scripts from 05-compliance.md. */
export const SCRIPTS = {
  recordingDisclosure: "This call may be recorded for quality and training.",
  greeting: "Thanks for calling {{clinic_name}}, this is {{ai_name}}. How can I help you and your pet today?",
  textGreeting: "Thanks for texting {{clinic_name}}, this is {{ai_name}}. How can I help you and your pet today?",
  fasting:
    "Because this is a procedure under anaesthesia, {{pet_name}} should have no food after midnight the night before. Water is fine. Drop-off is between {{drop_off_window}}.",
  deceased: "I am so sorry for your loss. I will make sure you do not receive any more reminders for {{pet_name}}.",
  refill: "I will pass the refill request for {{pet_name}} to the team. They usually have it ready in {{refill_turnaround}}, and they will text you when it is.",
  /** intake.json identify_caller.confirm_identity */
  confirmIdentity: "Is this {{client_first_name}}? And which of your pets is this about?",
  /** intake.json slot_offer.read_back */
  readBack: "So that's {{patient_name}} for {{service_phrase}} on {{date_spoken}} at {{time_spoken}} with {{provider_spoken}}. Please bring {{what_to_bring_spoken}}.",
  /** intake.json call_close */
  anythingElse: "Is there anything else I can help with for {{patient_name}} or any of your other pets?",
  goodbyeBooked: "Thanks for calling {{clinic_name}}. We'll see {{patient_name}} on {{date_spoken}}.",
  goodbyeBookedText: "Thanks for texting {{clinic_name}}. We'll see {{patient_name}} on {{date_spoken}}.",
  /**
   * PROVISIONAL: the pack has no booking confirmation template (product gap,
   * flagged to the product owner). Kept short and transactional.
   */
  confirmationSms: "{{clinic_name}}: {{visits}}. Reply C to confirm or R to reschedule.",
} as const;

// ---------- Inputs ----------

export interface PetRef {
  id: string;
  name: string;
  species: Species;
  ageMonths: number | null;
  sex?: "male" | "female" | null;
  neutered?: boolean | null;
  /** "active" when omitted. Deceased pets are kept so a caller can tell us. */
  status?: "active" | "deceased";
  flags?: string[];
  /** Created during this conversation. */
  isNew?: boolean;
}

export interface CallerRecord {
  clientId: string;
  firstName: string;
  /** Express consent to texts on file (STOP turns it off). */
  smsConsent?: boolean;
  pets: PetRef[];
}

export interface SlotOffer {
  start: number;
  end: number;
  providerId: string;
}

/** What the front desk needs to know about each pack service. */
export interface ServiceInfo {
  id: string;
  aiPhrase: string | null;
  bookableByAi: boolean;
  aiAction: string | null;
  aiScript: string | null;
  aiHandling: string | null;
  fallbackServiceId: string | null;
  fallbackScript: string | null;
  controlledScript?: string | null;
  fastingRequired?: boolean;
  requiresPreop?: boolean;
  /** "07:00-08:30" */
  dropOffWindow?: string | null;
  /** what_to_bring ids, e.g. ["carrier_or_leash", "previous_records"]. */
  whatToBring?: string[];
}

export interface FrontDeskContext {
  clinicName: string;
  /** The clinic's main number, for texts that must say "call us now". */
  clinicPhone: string | null;
  aiName: string;
  timezone: string;
  now: number;
  /** The caller's number in E.164, when known. */
  callerNumber: string | null;
  channel: "voice" | "sms";
  rules: TriageRules & { after_hours_er?: { sms_template: string } };
  /** Keyed by pack service id. */
  services: Record<string, ServiceInfo>;
  situation: TriageSituation;
  /** e.g. "Monday to Friday 7 AM to 6 PM, Saturday 8 AM to 6 PM". */
  hoursText: string;
  refillTurnaround: string;
  /** intake.json reason_for_visit. */
  intake: IntakeRules;
  /** intake.json what_to_bring_phrases. */
  whatToBringPhrases: Record<string, string>;
  policy: { cancellationWindowHours: number; cancellationFee: number | null };
}

export interface TaskRequest {
  type: string;
  title: string;
  details: string;
  priority: "normal" | "urgent";
  clientId: string | null;
  patientId: string | null;
  controlled?: boolean;
}

export interface NewPetInput {
  name: string;
  species: Species;
  breed: string | null;
  ageMonths: number | null;
  sex: "male" | "female" | null;
  neutered: boolean | null;
  flags: TemperamentFlag[];
}

export interface UpcomingVisit {
  appointmentId: string;
  patientId: string;
  packServiceId: string;
  start: number;
}

export interface FrontDeskPort {
  classify(text: string, petNames: string[]): Promise<TriageAssessment>;
  /** Up to two good options (or the next ones after `after`), searching `withinDays` from today. */
  findSlots(req: { patientId: string; packServiceId: string; withinDays: number; after?: number; excludeAppointmentId?: string }): Promise<{ slots: SlotOffer[]; blocked: string | null }>;
  /** Back-to-back times for several pets, same provider where possible: up to two options. */
  findGroupSlots(req: { items: { patientId: string; packServiceId: string }[]; withinDays: number; after?: number }): Promise<{ groups: SlotOffer[][]; blocked: string | null }>;
  /**
   * Books one visit. With `preop`, the pre-op bloodwork rule applies: either
   * the patient's bloodwork is still valid, or a preop_bloodwork visit is
   * booked before the procedure in the same step (both or neither).
   */
  book(req: { patientId: string; packServiceId: string; slot: SlotOffer; reason: string | null; triageLevel: TriageLevel; preop?: boolean }): Promise<{
    appointmentId: string;
    providerName: string;
    preopStart: number | null;
    preopValid: boolean;
  }>;
  /** Books several visits in one step (both or none). */
  bookGroup(req: { items: { patientId: string; packServiceId: string; slot: SlotOffer }[]; reason: string | null; triageLevel: TriageLevel }): Promise<{ appointmentIds: string[]; providerNames: string[] }>;
  upcoming(req: { clientId: string }): Promise<UpcomingVisit[]>;
  reschedule(req: { appointmentId: string; slot: SlotOffer }): Promise<{ appointmentId: string; providerName: string }>;
  cancel(req: { appointmentId: string; reason: string; lateCancel: boolean }): Promise<void>;
  /** Pack v0.2: only after the death, the pet's name and species are confirmed. */
  markDeceased(req: { patientId: string; confirmedName: string; confirmedSpecies: Species }): Promise<void>;
  createCaller(req: { firstName: string; lastName: string; mobile: string; email: string | null; smsConsent: boolean; pet: NewPetInput }): Promise<CallerRecord>;
  addPet(req: { clientId: string; pet: NewPetInput }): Promise<PetRef>;
  createTask(req: TaskRequest): Promise<void>;
  sendText(req: { to: string; body: string; templateKey: string; clientId: string | null; patientId?: string | null; appointmentId?: string | null }): Promise<void>;
  transfer(req: { to: string; summary: string }): Promise<{ ok: boolean }>;
  logTriage(req: { match: TriageMatch; actionTaken: string }): Promise<void>;
}

// ---------- State ----------

export type Phase =
  | "open"
  | "verify"
  | "confirm_new_pet"
  | "question"
  | "ask_pet"
  | "ask_service"
  | "unclear_service"
  | "offering"
  | "confirm_deceased"
  | "rebook"
  | "anything_else"
  | "ended";

export type Question =
  | "first_name"
  | "last_name"
  | "mobile_confirm"
  | "mobile"
  | "email"
  | "sms_consent"
  | "pet_name"
  | "species"
  | "breed"
  | "age"
  | "sex"
  | "neutered"
  | "referring_clinic"
  | "which_pets";

export type TransferOutcome = "none" | "transferred" | "failed" | "er_referred";
type Mode = "book" | "refill" | "reschedule" | "cancel" | "deceased";

export interface ClientDraft {
  firstName: string | null;
  lastName: string | null;
  mobile: string | null;
  /** The caller said the number they are calling from is not the one to use. */
  mobileDeclined?: boolean;
  email?: string | null;
  smsConsent?: boolean;
}

export interface PetDraft {
  name: string | null;
  species: Species | null;
  breed?: string | null;
  ageMonths?: number | null;
  sex?: "male" | "female" | null;
  neutered?: boolean | null;
}

export interface Booked {
  appointmentId: string;
  petName: string;
  phrase: string;
  start: number;
}

export interface ConversationState {
  phase: Phase;
  question: Question | null;
  triage: TriageState;
  caller: { clientId: string | null; firstName: string | null; lastName: string | null; smsConsent: boolean; verified: boolean; verifyTries: number };
  pets: PetRef[];
  petId: string | null;
  /** Several pets in one booking (back to back). */
  petIds: string[];
  multi: boolean;
  client: ClientDraft | null;
  newPet: PetDraft | null;
  askedReferring: boolean;
  mode: Mode | null;
  /** Pack service id being booked. */
  serviceId: string | null;
  sexMismatch: boolean;
  controlled: string | null;
  explained: string[];
  /** Book today or tomorrow (urgent). */
  urgentWindow: boolean;
  triedDropOff: boolean;
  adviceAsked: boolean;
  careNoted: boolean;
  reason: string[];
  offered: SlotOffer[];
  offeredGroups: SlotOffer[][];
  offerRounds: number;
  /** A day or time the caller asked for ("tomorrow afternoon", "10:30"). */
  prefer: TimeRequest | null;
  /** The current question was already asked again once. */
  retried: boolean;
  target: UpcomingVisit | null;
  appointmentIds: string[];
  booked: Booked[];
  outcomes: string[];
  transferOutcome: TransferOutcome;
}

export interface TurnResult {
  state: ConversationState;
  replies: string[];
}

export function startConversation(ctx: FrontDeskContext, caller: CallerRecord | null): TurnResult {
  const state: ConversationState = {
    phase: "open",
    question: null,
    triage: initialTriage,
    caller: { clientId: caller?.clientId ?? null, firstName: caller?.firstName ?? null, lastName: null, smsConsent: caller?.smsConsent ?? false, verified: false, verifyTries: 0 },
    pets: caller?.pets ?? [],
    petId: null,
    petIds: [],
    multi: false,
    client: null,
    newPet: null,
    askedReferring: false,
    mode: null,
    serviceId: null,
    sexMismatch: false,
    controlled: null,
    explained: [],
    urgentWindow: false,
    triedDropOff: false,
    adviceAsked: false,
    careNoted: false,
    reason: [],
    offered: [],
    offeredGroups: [],
    offerRounds: 0,
    prefer: null,
    retried: false,
    target: null,
    appointmentIds: [],
    booked: [],
    outcomes: [],
    transferOutcome: "none",
  };
  // No name in the greeting: the caller is not verified yet (05-compliance.md).
  const values = { clinic_name: ctx.clinicName, ai_name: ctx.aiName };
  const replies =
    ctx.channel === "voice"
      ? [SCRIPTS.recordingDisclosure, fillScript(SCRIPTS.greeting, values)]
      : [fillScript(SCRIPTS.textGreeting, values)];
  return { state, replies };
}

// ---------- Helpers ----------

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function spokenDate(start: number, timezone: string): string {
  const p = localParts(start, timezone);
  const [, m, d] = p.date.split("-").map(Number);
  return `${WEEKDAYS[p.weekday]}, ${MONTHS[m! - 1]} ${d}`;
}

function spokenTime(start: number, timezone: string): string {
  const minutes = localParts(start, timezone).minutes;
  const h = Math.floor(minutes / 60);
  const min = minutes % 60;
  return `${h % 12 === 0 ? 12 : h % 12}${min ? `:${String(min).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
}

/** "07:00-08:30" → "7 and 8:30 AM". */
function spokenWindow(window: string): string {
  const [a, b] = window.split("-");
  const t = (hhmm: string) => {
    const h = Number(hhmm.slice(0, 2));
    const min = Number(hhmm.slice(3, 5));
    return { h12: `${h % 12 === 0 ? 12 : h % 12}${min ? `:${String(min).padStart(2, "0")}` : ""}`, ampm: h < 12 ? "AM" : "PM" };
  };
  const x = t(a!);
  const y = t(b!);
  return x.ampm === y.ampm ? `${x.h12} and ${y.h12} ${y.ampm}` : `${x.h12} ${x.ampm} and ${y.h12} ${y.ampm}`;
}

function joinAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

const QUESTION_PROMPTS: Record<Question, string> = {
  first_name: "Can I get your first name?",
  last_name: "And your last name?",
  mobile_confirm: "Is {{mobile}} the best mobile number for you?",
  mobile: "What's the best mobile number for you?",
  email: "And an email for the confirmation?",
  sms_consent: "Is it okay if we text you appointment confirmations and reminders? You can reply STOP anytime.",
  pet_name: "What's your pet's name?",
  species: "Is {{patient_name}} a dog or a cat, or something else?",
  breed: "What breed?",
  age: "How old is {{patient_name}}, roughly?",
  sex: "Boy or girl?",
  neutered: "Spayed or neutered?",
  referring_clinic: "Has {{patient_name}} been seen at another clinic? We can request the records so the doctor has the history.",
  which_pets: "Which pets would you like to bring in?",
};

// ---------- One caller turn ----------

class Turn {
  readonly replies: string[] = [];
  constructor(
    readonly s: ConversationState,
    readonly ctx: FrontDeskContext,
    readonly port: FrontDeskPort,
  ) {}

  say(text: string) {
    if (text.trim()) this.replies.push(text.trim());
  }

  get activePets(): PetRef[] {
    return this.s.pets.filter((p) => (p.status ?? "active") === "active");
  }

  get pet(): PetRef | null {
    return this.s.pets.find((p) => p.id === this.s.petId) ?? null;
  }

  get petName(): string {
    return this.pet?.name ?? this.s.newPet?.name ?? "your pet";
  }

  petFacts(p: PetRef | null): PetFacts | null {
    return p ? { species: p.species, sex: p.sex ?? null, neutered: p.neutered ?? null, ageMonths: p.ageMonths, isNew: Boolean(p.isNew) } : null;
  }

  get er() {
    return erValues(this.ctx.situation.er).values;
  }

  phrase(serviceId: string | null): string {
    return (serviceId && this.ctx.services[serviceId]?.aiPhrase) || "an appointment";
  }

  task(type: string, title: string, details: string, priority: "normal" | "urgent" = "normal", controlled = false) {
    return this.port.createTask({ type, title, details, priority, clientId: this.s.caller.clientId, patientId: this.s.petId, controlled });
  }

  callerLabel(): string {
    const name = [this.s.caller.firstName ?? this.s.client?.firstName, this.s.caller.lastName ?? this.s.client?.lastName].filter(Boolean).join(" ");
    return name || (this.ctx.callerNumber ? formatPhone(this.ctx.callerNumber) : "Unknown caller");
  }

  /** Pets on file named in the caller's words ("Bella's", "Bella and Jack"). */
  petsIn(text: string, includeDeceased = false): PetRef[] {
    const n = normalizeUtterance(text);
    const pool = includeDeceased ? this.s.pets : this.activePets;
    return pool.filter((p) => {
      const name = normalizeUtterance(p.name).trim();
      return n.includes(` ${name} `) || n.includes(` ${name}s `);
    });
  }

  ask(phase: Phase, question: string) {
    this.s.phase = phase;
    this.say(question);
  }

  askQuestion(q: Question) {
    this.s.phase = "question";
    if (this.s.question !== q) this.s.retried = false;
    this.s.question = q;
    const mobile = this.s.client?.mobile ?? this.ctx.callerNumber;
    this.say(fillScript(QUESTION_PROMPTS[q], { patient_name: this.s.newPet?.name ?? this.petName, mobile: mobile ? formatPhone(mobile) : "" }));
  }

  wrapUp() {
    this.say(fillScript(SCRIPTS.anythingElse, { patient_name: this.s.booked.at(-1)?.petName ?? (this.pet ? this.pet.name : "your pet") }));
    this.s.phase = "anything_else";
  }

  resetBooking() {
    this.s.serviceId = null;
    this.s.sexMismatch = false;
    this.s.urgentWindow = false;
    this.s.triedDropOff = false;
    this.s.adviceAsked = false;
    this.s.careNoted = false;
    this.s.offered = [];
    this.s.offeredGroups = [];
    this.s.offerRounds = 0;
    this.s.prefer = null;
    this.s.multi = false;
    this.s.petIds = [];
    this.s.mode = null;
    this.s.target = null;
    this.s.controlled = null;
    if (this.activePets.length > 1) this.s.petId = null;
  }

  // ----- Triage -----

  async emergency(newMatches: TriageMatch[], text: string) {
    let action: TriageAction = decideTriageAction(this.ctx.rules, "emergency", this.ctx.situation);
    const lead = leadingMatch(this.s.triage);
    if (action.kind === "transfer" && this.ctx.channel === "sms") {
      // A text thread cannot be transferred: ask them to call, and have staff call them now.
      this.say(`That sounds like it needs a doctor right away.${this.ctx.clinicPhone ? ` Please call us now on ${this.ctx.clinicPhone}.` : ""} I've also asked the team to call you straight away.`);
      for (const m of newMatches) await this.port.logTriage({ match: m, actionTaken: "staff_call_now" });
      await this.task("emergency_alert", `Emergency: call now: ${lead?.triggerName ?? "caller describes an emergency"}`, `${this.callerLabel()}${this.ctx.callerNumber ? ` (${formatPhone(this.ctx.callerNumber)})` : ""} texted about ${this.petName}: "${this.s.reason.at(-1) ?? ""}"`, "urgent");
      this.s.outcomes.push("emergency_staff_alerted");
      this.s.phase = "ended";
      return;
    }
    if (action.kind === "transfer") {
      // Pack script for a caller who plays it down: transfer anyway (never downgrade).
      const downplay = callerDownplays(text) && this.ctx.rules.scripts.caller_downplays;
      this.say(downplay ? this.ctx.rules.scripts.caller_downplays! : action.say);
      const summary = transferSummary(this.ctx.rules, this.s.triage, {
        patientName: this.pet?.name ?? this.s.newPet?.name ?? null,
        species: this.pet?.species ?? this.s.newPet?.species ?? null,
        clientFirstName: this.s.caller.firstName ?? this.s.client?.firstName ?? null,
        mobile: this.ctx.callerNumber ? formatPhone(this.ctx.callerNumber) : null,
      });
      const result = await this.port.transfer({ to: action.to, summary });
      for (const m of newMatches) await this.port.logTriage({ match: m, actionTaken: result.ok ? "transferred" : "transfer_failed" });
      if (result.ok) {
        this.s.transferOutcome = "transferred";
        this.s.outcomes.push("emergency_transferred");
        this.s.phase = "ended";
        return;
      }
      this.s.transferOutcome = "failed";
      action = decideTriageAction(this.ctx.rules, "emergency", { ...this.ctx.situation, transferFailed: true });
      newMatches = [];
    }
    if (action.kind !== "er_referral") return;
    await this.erReferral(action, newMatches);
  }

  /** ER details by voice and text, a staff alert, and (after hours) the next opening. */
  async erReferral(action: Extract<TriageAction, { kind: "er_referral" }>, newMatches: TriageMatch[]) {
    const lead = leadingMatch(this.s.triage);
    this.say(action.say);
    for (const m of newMatches) await this.port.logTriage({ match: m, actionTaken: "er_referral" });
    if (this.s.transferOutcome !== "failed") this.s.transferOutcome = "er_referred";
    this.s.outcomes.push("emergency_er_referred");
    const template = this.ctx.rules.after_hours_er?.sms_template;
    if (action.sendErDetails && this.ctx.callerNumber && template) {
      await this.port.sendText({
        to: this.ctx.callerNumber,
        body: fillScript(template, { clinic_name: this.ctx.clinicName, ...this.er }),
        templateKey: "after_hours_er",
        clientId: this.s.caller.clientId,
      });
    }
    if (action.staffAlert) {
      const why = action.reason === "transfer_failed" ? "transfer failed" : action.reason === "after_hours" ? "after hours" : "no transfer line";
      await this.task(
        "emergency_alert",
        `Emergency (${why}): ${lead?.triggerName ?? "caller describes an emergency"}`,
        `${this.callerLabel()}${this.ctx.callerNumber ? ` (${formatPhone(this.ctx.callerNumber)})` : ""} about ${this.petName}. Caller was given the ER partner's details. Said: "${this.s.reason.at(-1) ?? ""}"`,
        "urgent",
      );
    }
    if (action.offerNextSlot) {
      this.say(`I can also book ${this.petName} in to see the doctor when we open.`);
      this.s.mode = "book";
      this.s.serviceId = this.ctx.rules.levels.urgent.service_id;
      this.s.urgentWindow = false;
      this.s.offered = [];
      await this.advance();
      return;
    }
    this.s.phase = "ended";
  }

  // ----- Identity -----

  /** New callers: the intake.json new_client and new_patient questions, skipping anything already given. */
  nextNewClientQuestion(): Question | null {
    const c = this.s.client!;
    if (!c.firstName) return "first_name";
    if (!c.lastName) return "last_name";
    if (!c.mobile) return this.ctx.callerNumber && !c.mobileDeclined ? "mobile_confirm" : "mobile";
    if (c.email === undefined) return "email";
    if (c.smsConsent === undefined) return "sms_consent";
    return this.nextPetQuestion();
  }

  nextPetQuestion(): Question | null {
    const p = this.s.newPet!;
    if (!p.name) return "pet_name";
    if (!p.species) return "species";
    if (p.breed === undefined) return "breed";
    if (p.ageMonths === undefined) return "age";
    if (p.sex === undefined) return "sex";
    if (p.neutered === undefined) return "neutered";
    return null;
  }

  petInput(): NewPetInput {
    const p = this.s.newPet!;
    // intake.json temperament auto_set: cats always come in a carrier.
    const flags: TemperamentFlag[] = p.species === "cat" ? ["cat_carrier_required"] : [];
    return { name: p.name!, species: p.species!, breed: p.breed ?? null, ageMonths: p.ageMonths ?? null, sex: p.sex ?? null, neutered: p.neutered ?? null, flags };
  }

  /** Fills drafts from a first message like "I'm Dana Price ... his name is Rufus, a four year old lab mix, neutered." */
  absorbFacts(text: string) {
    if (this.s.caller.clientId) return;
    const f = extractFacts(text);
    this.s.client ??= { firstName: null, lastName: null, mobile: null };
    if (f.firstName && !this.s.client.firstName) this.s.client.firstName = f.firstName;
    if (f.lastName && !this.s.client.lastName) this.s.client.lastName = f.lastName;
    if (f.phoneDigits && !this.s.client.mobile) this.s.client.mobile = `+1${f.phoneDigits}`;
    const hasPet = f.petName || f.species || f.ageMonths !== undefined;
    if (!hasPet) return;
    this.s.newPet ??= { name: null, species: null };
    const p = this.s.newPet;
    if (f.petName && !p.name) p.name = f.petName;
    if (f.species && !p.species) p.species = f.species;
    if (f.ageMonths !== undefined && p.ageMonths === undefined) p.ageMonths = f.ageMonths;
    if (f.sex && p.sex === undefined) p.sex = f.sex;
    if (f.neutered !== undefined && p.neutered === undefined) p.neutered = f.neutered;
    if (f.breed && p.breed === undefined) p.breed = f.breed;
  }

  // ----- Moving forward -----

  /** Asks for whatever is missing, then does the work for the current mode. */
  async advance(): Promise<void> {
    const s = this.s;
    const mode = s.mode ?? "book";

    // Requests the AI may not book are explained straight away (call 14).
    if (s.serviceId && mode === "book" && !s.explained.includes(s.serviceId)) {
      const info = this.ctx.services[s.serviceId];
      if (info && !info.bookableByAi && info.aiScript && (info.aiAction === "staff_task" || (info.aiAction === "book_exam_first" && !s.caller.clientId))) {
        s.explained.push(s.serviceId);
        const script = fillScript(info.aiScript, { pet_name: this.petName });
        this.say(script);
      }
    }

    // 1. Who is calling.
    if (!s.caller.clientId) {
      if (mode === "reschedule" || mode === "cancel" || mode === "deceased") {
        await this.task("callback", `Call back ${this.callerLabel()}`, `Caller not found by number. Said: "${s.reason.join(" ")}"`);
        this.say("I couldn't find your details from this number, so I've asked the team to call you back to help with that.");
        s.outcomes.push("callback_requested");
        this.wrapUp();
        return this.resetBooking();
      }
      s.client ??= { firstName: null, lastName: null, mobile: null };
      s.newPet ??= { name: null, species: null };
      const q = this.nextNewClientQuestion();
      if (q) return this.askQuestion(q);
      const created = await this.port.createCaller({
        firstName: s.client.firstName!,
        lastName: s.client.lastName!,
        mobile: s.client.mobile!,
        email: s.client.email ?? null,
        smsConsent: s.client.smsConsent ?? false,
        pet: this.petInput(),
      });
      s.caller = { ...s.caller, clientId: created.clientId, firstName: created.firstName, lastName: s.client.lastName, smsConsent: s.client.smsConsent ?? false, verified: true };
      s.pets = created.pets.map((p) => ({ ...p, isNew: true }));
      s.petId = s.pets[0]?.id ?? null;
      s.newPet = null;
      s.outcomes.push("new_client");
    }

    // 2. Known callers are verified with a pet's name first (never read the list before that).
    if (!s.caller.verified) {
      return this.ask("verify", fillScript(SCRIPTS.confirmIdentity, { client_first_name: s.caller.firstName ?? "" }));
    }

    // 3. Records request for new clients (asked after the new patient, intake.json).
    if (s.outcomes.includes("new_client") && !s.askedReferring) {
      s.askedReferring = true;
      return this.askQuestion("referring_clinic");
    }

    // 4. Which pet (now verified, the names may be used).
    if (s.newPet) {
      const q = this.nextPetQuestion();
      if (q) return this.askQuestion(q);
      const pet = await this.port.addPet({ clientId: s.caller.clientId!, pet: this.petInput() });
      s.pets.push({ ...pet, isNew: true });
      s.petId = pet.id;
      s.newPet = null;
    }
    if (s.multi && s.petIds.length < 2) {
      if (this.activePets.length < 2) s.multi = false;
      else return this.askQuestion("which_pets");
    }
    if (!s.multi && !s.petId && mode !== "deceased") {
      const active = this.activePets;
      if (active.length === 1) s.petId = active[0]!.id;
      else if (active.length === 0) {
        s.newPet = { name: null, species: null };
        return this.askQuestion("pet_name");
      } else {
        const names = active.map((p) => p.name);
        return this.ask("ask_pet", `Is this for ${names.slice(0, -1).join(", ")} or ${names.at(-1)}?`);
      }
    }

    // 5. The work.
    if (mode === "deceased") return this.deceased();
    if (mode === "refill") return this.refill();
    if (mode === "reschedule" || mode === "cancel") return this.changeVisit(mode);
    return this.book();
  }

  async refill() {
    const s = this.s;
    if (s.controlled) {
      // 05-compliance.md: never approve, never discuss quantities.
      const script = this.ctx.services.rx_refill_request?.controlledScript ?? "For that medication the doctor needs to approve the refill personally. The team will call you back today.";
      this.say(script);
      await this.task("refill_request", `Controlled refill request: ${this.petName} (${s.controlled})`, `${this.callerLabel()} asked for a refill of ${s.controlled}. Doctor approval required; quantities not discussed.`, "normal", true);
      s.outcomes.push("refill_requested");
    } else {
      await this.task("refill_request", `Refill request: ${this.petName}`, `${this.callerLabel()} asked: "${s.reason.join(" ")}"`);
      this.say(fillScript(SCRIPTS.refill, { pet_name: this.petName, refill_turnaround: this.ctx.refillTurnaround }));
      s.outcomes.push("refill_requested");
    }
    this.wrapUp();
    return this.resetBooking();
  }

  async deceased() {
    const s = this.s;
    const pet = s.pets.find((p) => p.id === s.petId);
    if (!pet) return this.ask("ask_pet", "I'm so sorry. Which of your pets was it?");
    if ((pet.status ?? "active") === "deceased") {
      // Already recorded: a reminder about this pet should never have gone out.
      this.say(`I'm so sorry. Our records already show that ${pet.name} has passed.`);
      this.say(fillScript(SCRIPTS.deceased, { pet_name: pet.name }));
      await this.task("sympathy", `Sympathy: ${pet.name}`, `${this.callerLabel()} mentioned ${pet.name} has died. Consider a sympathy card.`);
      await this.task("suppression_failure", `Reminder contact about deceased pet: ${pet.name}`, `${this.callerLabel()} was contacted about ${pet.name}, who is recorded as deceased. Check reminder suppression.`, "urgent");
      s.outcomes.push("deceased_already_recorded");
      this.wrapUp();
      return this.resetBooking();
    }
    return this.ask("confirm_deceased", `I'm so sorry for your loss. Just so I update the right record, was that ${pet.name}, your ${pet.species}?`);
  }

  async changeVisit(mode: "reschedule" | "cancel") {
    const s = this.s;
    const visits = (await this.port.upcoming({ clientId: s.caller.clientId! })).filter((v) => v.patientId === s.petId).sort((a, b) => a.start - b.start);
    const visit = visits[0];
    if (!visit) {
      s.mode = "book";
      return this.ask("rebook", `I don't see an upcoming visit for ${this.petName}. Would you like to book one?`);
    }
    s.target = visit;
    const when = `${this.phrase(visit.packServiceId).replace(/^(a|an) /, "")} on ${spokenDate(visit.start, this.ctx.timezone)} at ${spokenTime(visit.start, this.ctx.timezone)}`;
    if (mode === "cancel") {
      const hours = (visit.start - this.ctx.now) / 3_600_000;
      const late = hours < this.ctx.policy.cancellationWindowHours;
      if (late) {
        const fee = this.ctx.policy.cancellationFee ? `, and there may be a $${this.ctx.policy.cancellationFee.toFixed(0)} fee` : "";
        this.say(`Just so you know, our policy asks for ${this.ctx.policy.cancellationWindowHours} hours' notice for cancellations${fee}. I've cancelled ${this.petName}'s ${when} for you.`);
      } else {
        this.say(`I've cancelled ${this.petName}'s ${when}.`);
      }
      await this.port.cancel({ appointmentId: visit.appointmentId, reason: s.reason.join(" ").slice(0, 500) || "Client cancelled", lateCancel: late });
      if (late) await this.task("late_cancel_fee", `Late cancellation: ${this.petName}`, `Cancelled ${Math.max(0, Math.round(hours))} hours before the visit (${when}). Decide on the fee.`);
      s.outcomes.push(late ? "late_cancel" : "cancelled");
      s.serviceId = visit.packServiceId;
      s.mode = "book";
      s.target = null;
      return this.ask("rebook", `Would you like to rebook ${this.petName}?`);
    }
    this.say(`I see ${this.petName}'s ${when}.`);
    s.serviceId = visit.packServiceId;
    return this.offer();
  }

  async book(): Promise<void> {
    const s = this.s;
    if (!s.serviceId) return this.ask("ask_service", `What's going on with ${s.multi ? "them" : this.petName}?`);
    if (!s.multi && this.pet) s.serviceId = adjustServiceForPet(s.serviceId, this.petFacts(this.pet), this.ctx.intake);

    // Spay for a male (or neuter for a female): clarify gently and offer the right one (call 11).
    const pet = this.pet;
    const sterilise = /^(spay|neuter)_(canine|feline)$/.exec(s.serviceId);
    if (!s.multi && sterilise && pet) {
      if (pet.neutered) {
        this.say(`Our records show ${pet.name} is already ${pet.sex === "female" ? "spayed" : "neutered"}. I've asked the team to check and call you back.`);
        await this.task("callback", `Sterilisation request: ${pet.name}`, `${this.callerLabel()} asked for ${this.phrase(s.serviceId)}; records show ${pet.name} is already done.`);
        this.wrapUp();
        return this.resetBooking();
      }
      const right = pet.sex === "male" ? "neuter" : pet.sex === "female" ? "spay" : sterilise[1]!;
      if (right !== sterilise[1]) {
        this.say(
          right === "neuter"
            ? `A spay is for girls, and ${pet.name} is a boy, so for ${pet.name} it would be a neuter. I'll find a time for that.`
            : `A neuter is for boys, and ${pet.name} is a girl, so for ${pet.name} it would be a spay. I'll find a time for that.`,
        );
        s.serviceId = `${right}_${sterilise[2]}`;
      }
    }

    let info = this.ctx.services[s.serviceId];
    if (!info || !info.bookableByAi) {
      if (info?.aiAction === "book_exam_first") {
        if (!s.explained.includes(s.serviceId)) this.say(fillScript(info.aiScript ?? "", { pet_name: this.petName }));
        s.serviceId = this.ctx.intake.default_by_type.problem_default;
        info = this.ctx.services[s.serviceId];
      } else {
        await this.task("service_request", `${info?.id ?? s.serviceId} request: ${this.petName}`, `${this.callerLabel()} asked: "${s.reason.join(" ")}"`);
        if (!s.explained.includes(s.serviceId)) this.say(fillScript(info?.aiScript ?? "I'll pass this to the team and someone will call you back.", { pet_name: this.petName }));
        else this.say("I've passed that to the team, and someone will call you back.");
        s.outcomes.push("passed_to_staff");
        this.wrapUp();
        return this.resetBooking();
      }
    }
    if (info?.aiHandling === "book_with_care" && !s.careNoted) {
      s.careNoted = true;
      this.say(`I'm so sorry. We'll take good care of ${this.petName} and you. Let me find a quiet time.`);
    }
    return this.offer();
  }

  async offer(after?: number): Promise<void> {
    const s = this.s;
    // A requested day or time (not for urgent visits, which must be soonest).
    const prefer = after === undefined && !s.urgentWindow ? s.prefer : null;
    s.prefer = null;
    const from = after ?? (prefer ? prefer.after - 1 : undefined);
    const withinDays = s.urgentWindow ? 2 : prefer ? Math.max(14, Math.ceil((prefer.after - this.ctx.now) / 86_400_000) + 7) : 14;
    if (s.multi) return this.offerGroup(from);
    const { slots, blocked } = await this.port.findSlots({ patientId: s.petId!, packServiceId: s.serviceId!, withinDays, after: from, excludeAppointmentId: s.target?.appointmentId });
    if (blocked) {
      const info = this.ctx.services[s.serviceId!];
      if (info?.fallbackServiceId && info.fallbackServiceId !== s.serviceId) {
        if (info.fallbackScript) this.say(fillScript(info.fallbackScript, { pet_name: this.petName }));
        s.serviceId = info.fallbackServiceId;
        return this.offer();
      }
      await this.task("callback", `Booking needs staff: ${this.petName}`, `${blocked} Request: "${s.reason.join(" ")}"`);
      this.say(`${blocked} I've asked the team to call you back to set this up.`);
      this.wrapUp();
      return this.resetBooking();
    }
    if (slots.length === 0) {
      if (s.urgentWindow && !s.triedDropOff && s.serviceId === this.ctx.rules.levels.urgent.service_id) {
        s.triedDropOff = true;
        s.serviceId = this.ctx.rules.levels.urgent.fallback_if_no_slot;
        return this.offer();
      }
      if (s.urgentWindow) {
        await this.task("urgent_callback", `Urgent: fit in ${this.petName}`, `No same or next day opening. ${leadingMatch(s.triage)?.triggerName ?? ""}. Caller: ${this.callerLabel()}`, "urgent");
        this.say(`We don't have an opening today or tomorrow. If ${this.petName} gets worse, please go to ${this.er.er_name} at ${this.er.er_address}. I've asked the team to call you back first thing to fit ${this.petName} in.`);
        s.outcomes.push("urgent_callback");
        this.wrapUp();
        return this.resetBooking();
      }
      await this.task("callback", `Find a time: ${this.petName}`, `No opening in two weeks for ${s.serviceId}. Caller: ${this.callerLabel()}`);
      this.say("I couldn't find an opening in the next two weeks. I've asked the team to call you to find a time.");
      this.wrapUp();
      return this.resetBooking();
    }

    const dropOff = s.triedDropOff && s.serviceId === this.ctx.rules.levels.urgent.fallback_if_no_slot;
    s.offered = dropOff ? slots.slice(0, 1) : slots.slice(0, 2);
    s.offerRounds += 1;
    s.phase = "offering";
    const [a, b] = s.offered.map((o) => slotLabel(o.start, this.ctx.timezone, this.ctx.now));
    const scripts = this.ctx.rules.scripts;
    const values = { patient_name: this.petName, pet_name: this.petName, slot_1: a, slot_2: b, ...this.er };
    if (dropOff && scripts.urgent_no_slot) return this.say(fillScript(scripts.urgent_no_slot, values));
    if (s.adviceAsked && b) {
      s.adviceAsked = false;
      return this.say(`${fillScript(scripts.advice_requested ?? "I am not able to give medical advice, but I can get {{patient_name}} seen. The next available is {{slot_1}} or {{slot_2}}.", values)} Which works better?`);
    }
    if (s.urgentWindow && b && scripts.urgent_booked) return this.say(fillScript(scripts.urgent_booked, values).replace(/\.\s+If anything.*$/, ". Which works better?"));
    const phrase = this.phrase(s.serviceId);
    if (prefer?.minutes != null) {
      const asked = slotLabel(prefer.after, this.ctx.timezone, this.ctx.now);
      if (s.offered[0]!.start === prefer.after) {
        s.offered = s.offered.slice(0, 1);
        return this.say(`I can do ${asked} for ${this.petName}. Shall I book that?`);
      }
      return this.say(b ? `${asked.charAt(0).toUpperCase()}${asked.slice(1)} isn't free. The closest I have is ${a} or ${b}. Which works better?` : `${asked.charAt(0).toUpperCase()}${asked.slice(1)} isn't free. The closest I have is ${a}. Does that work?`);
    }
    this.say(b ? `For ${phrase} for ${this.petName}, I have ${a} or ${b}. Which works better?` : `The next opening for ${phrase} for ${this.petName} is ${a}. Does that work?`);
  }

  async offerGroup(after?: number) {
    const s = this.s;
    const pets = s.petIds.map((id) => s.pets.find((p) => p.id === id)!).filter(Boolean);
    const items = pets.map((p) => ({ patientId: p.id, packServiceId: adjustServiceForPet(s.serviceId!, this.petFacts(p), this.ctx.intake) }));
    const { groups, blocked } = await this.port.findGroupSlots({ items, withinDays: 14, after });
    if (blocked || groups.length === 0) {
      await this.task("callback", `Book together: ${joinAnd(pets.map((p) => p.name))}`, `${blocked ?? "No back-to-back times in two weeks."} Caller: ${this.callerLabel()}`);
      this.say(`I couldn't find back-to-back times for ${joinAnd(pets.map((p) => p.name))}, so I've asked the team to call you to set them up together.`);
      this.wrapUp();
      return this.resetBooking();
    }
    s.offeredGroups = groups.slice(0, 2);
    s.offered = s.offeredGroups.map((g) => g[0]!);
    s.offerRounds += 1;
    s.phase = "offering";
    const [a, b] = s.offered.map((o) => slotLabel(o.start, this.ctx.timezone, this.ctx.now));
    const names = joinAnd(pets.map((p) => p.name));
    this.say(b ? `I can see ${names} back to back starting ${a}, or starting ${b}. Which works better?` : `I can see ${names} back to back starting ${a}. Does that work?`);
  }

  bring(serviceId: string, pet: PetRef | null): string[] {
    const ids = this.ctx.services[serviceId]?.whatToBring ?? [];
    const out = ids
      .map((id) => {
        if (id === "carrier_or_leash") return pet?.species === "cat" ? "a carrier" : pet?.species === "dog" ? "a leash" : this.ctx.whatToBringPhrases[id];
        return this.ctx.whatToBringPhrases[id];
      })
      .filter((x): x is string => Boolean(x))
      .map((x) => fillScript(x, { patient_name: pet?.name ?? "your pet" }));
    if (pet?.flags?.includes("cat_carrier_required") && !out.includes("a carrier")) out.unshift("a carrier");
    return [...new Set(out)];
  }

  async confirmationText(visits: Booked[], pets: PetRef[]) {
    if (!this.s.caller.smsConsent || !this.ctx.callerNumber) return;
    const lines = visits.map((v, i) => {
      const pet = pets[i] ?? null;
      const bring = this.bring(this.s.serviceId ?? "", pet);
      const carrier = pet?.flags?.includes("cat_carrier_required") ? ` Please bring ${v.petName} in a carrier.` : bring.length ? ` Please bring ${joinAnd(bring)}.` : "";
      return `${v.petName} is booked for ${v.phrase} on ${spokenDate(v.start, this.ctx.timezone)} at ${spokenTime(v.start, this.ctx.timezone)}.${carrier}`;
    });
    await this.port.sendText({
      to: this.ctx.callerNumber,
      body: fillScript(SCRIPTS.confirmationSms, { clinic_name: this.ctx.clinicName, visits: lines.join(" ").replace(/\.$/, "") }),
      templateKey: "appointment_confirmation",
      clientId: this.s.caller.clientId,
      patientId: pets.length === 1 ? pets[0]!.id : null,
      appointmentId: visits.length === 1 ? visits[0]!.appointmentId : null,
    });
  }

  async takeSlot(index: number): Promise<void> {
    const s = this.s;
    if (s.multi) return this.takeGroup(index);
    const slot = s.offered[index]!;
    const info = this.ctx.services[s.serviceId!];
    const pet = this.pet;
    let providerName = "";
    let preopStart: number | null = null;
    try {
      if (s.target) {
        const moved = await this.port.reschedule({ appointmentId: s.target.appointmentId, slot });
        s.appointmentIds.push(moved.appointmentId);
        providerName = moved.providerName;
        s.outcomes.push("rescheduled");
      } else {
        const r = await this.port.book({
          patientId: s.petId!,
          packServiceId: s.serviceId!,
          slot,
          reason: s.reason.join(" ").slice(0, 500) || null,
          triageLevel: s.triage.level,
          preop: Boolean(info?.requiresPreop),
        });
        s.appointmentIds.push(r.appointmentId);
        providerName = r.providerName;
        preopStart = r.preopStart;
        s.outcomes.push(s.triage.level === "routine" ? "booked" : `booked_${s.triage.level}`);
      }
    } catch (error) {
      if (error instanceof ConflictError) {
        if (error.userMessage.includes("bloodwork")) {
          this.say(error.userMessage);
          return this.offer(slot.start);
        }
        this.say("Sorry, that time was just taken.");
        return this.offer();
      }
      throw error;
    }
    const phrase = this.phrase(s.serviceId);
    const booked: Booked = { appointmentId: s.appointmentIds.at(-1)!, petName: this.petName, phrase, start: slot.start };
    s.booked.push(booked);
    const bring = this.bring(s.serviceId!, pet);
    this.say(
      fillScript(SCRIPTS.readBack, {
        patient_name: this.petName,
        service_phrase: phrase,
        date_spoken: spokenDate(slot.start, this.ctx.timezone),
        time_spoken: spokenTime(slot.start, this.ctx.timezone),
        provider_spoken: providerName || "the doctor",
        what_to_bring_spoken: bring.length ? joinAnd(bring) : "anything you'd like the doctor to see",
      }),
    );
    if (preopStart) this.say(`I've also booked ${this.petName}'s pre-op bloodwork ${slotLabel(preopStart, this.ctx.timezone, this.ctx.now)}, which the doctor needs before the anaesthetic.`);
    if (info?.fastingRequired) {
      // 05-compliance.md fasting script, verbatim (call 10).
      this.say(fillScript(SCRIPTS.fasting, { pet_name: this.petName, drop_off_window: spokenWindow(info.dropOffWindow ?? "07:00-08:30") }));
    }
    if (s.triage.level !== "routine") this.say(`If anything gets worse before then, please go to ${this.er.er_name} or call us straight back.`);
    await this.confirmationText([booked], pet ? [pet] : []);
    this.wrapUp();
    this.resetBooking();
  }

  async takeGroup(index: number): Promise<void> {
    const s = this.s;
    const group = s.offeredGroups[index]!;
    const pets = s.petIds.map((id) => s.pets.find((p) => p.id === id)!);
    const items = pets.map((p, i) => ({ patientId: p.id, packServiceId: adjustServiceForPet(s.serviceId!, this.petFacts(p), this.ctx.intake), slot: group[i]! }));
    let result: { appointmentIds: string[]; providerNames: string[] };
    try {
      result = await this.port.bookGroup({ items, reason: s.reason.join(" ").slice(0, 500) || null, triageLevel: s.triage.level });
    } catch (error) {
      if (error instanceof ConflictError) {
        this.say("Sorry, those times were just taken.");
        return this.offerGroup();
      }
      throw error;
    }
    s.appointmentIds.push(...result.appointmentIds);
    const booked = items.map((it, i) => ({ appointmentId: result.appointmentIds[i]!, petName: pets[i]!.name, phrase: this.phrase(it.packServiceId), start: it.slot.start }));
    s.booked.push(...booked);
    s.outcomes.push("booked_group");
    const provider = [...new Set(result.providerNames)];
    this.say(
      `You're all set: ${booked.map((b) => `${b.petName} at ${spokenTime(b.start, this.ctx.timezone)}`).join(" and ")} on ${spokenDate(group[0]!.start, this.ctx.timezone)}${provider.length === 1 ? ` with ${provider[0]}` : ""}.`,
    );
    await this.confirmationText(booked, pets);
    this.wrapUp();
    this.resetBooking();
  }

  // ----- Phases -----

  async handle(text: string, intentOverride: Intent | null): Promise<void> {
    const s = this.s;
    switch (s.phase) {
      case "open":
      case "anything_else": {
        const intent = intentOverride ?? detectIntent(text);
        const match = matchService(text, this.petFacts(this.pet), this.ctx.intake);
        const death = deathMentioned(text);
        if (s.phase === "anything_else" && intent === "unknown" && !match && !death && (isGoodbye(text) || isNo(text))) {
          const last = s.booked.at(-1);
          this.say(last ? fillScript(this.ctx.channel === "sms" ? SCRIPTS.goodbyeBookedText : SCRIPTS.goodbyeBooked, { clinic_name: this.ctx.clinicName, patient_name: last.petName, date_spoken: spokenDate(last.start, this.ctx.timezone) }) : `Thanks for contacting ${this.ctx.clinicName}. Take care!`);
          s.phase = "ended";
          return;
        }
        s.reason.push(text);
        this.absorbFacts(text);
        s.prefer = parseTimeRequest(text, this.ctx.timezone, this.ctx.now) ?? s.prefer;
        if (death) {
          s.mode = "deceased";
          return this.advance();
        }
        if (wantsSeveralPets(text) || this.petsIn(text).length > 1) {
          s.multi = true;
          s.petIds = this.petsIn(text).map((p) => p.id);
        }
        switch (intent) {
          case "hours":
            this.say(`We're open ${this.ctx.hoursText}.`);
            return this.wrapUp();
          case "staff":
            await this.task("callback", `Call back ${this.callerLabel()}`, `Caller asked to speak to someone. Message: "${text}"`);
            this.say(this.ctx.situation.open ? "I've passed your message to the team, and someone will call you back as soon as they can." : "We're closed right now. I've passed your message to the team, and someone will call you back when we open.");
            s.outcomes.push("callback_requested");
            return this.wrapUp();
          case "reschedule":
          case "cancel":
            s.mode = intent;
            return this.advance();
          case "refill":
            s.mode = "refill";
            s.controlled = match?.controlled ?? null;
            return this.advance();
          case "advice":
            s.adviceAsked = true;
            s.serviceId ??= this.ctx.intake.default_by_type.problem_default;
            s.mode = "book";
            return this.advance();
          default:
            if (match?.serviceId === "rx_refill_request") {
              s.mode = "refill";
              s.controlled = match.controlled ?? null;
              return this.advance();
            }
            if (match?.serviceId === "euthanasia" && !s.outcomes.includes("end_of_life_request")) {
              // Regression check: an end-of-life request always reaches a person; the pet stays active.
              await this.task("end_of_life", `End-of-life request${this.pet ? `: ${this.pet.name}` : ""}`, `${this.callerLabel()} said: "${text}". Book with care; cremation options are left to staff.`);
              s.outcomes.push("end_of_life_request");
            }
            if (match && !s.serviceId) s.serviceId = match.serviceId;
            if (intent === "book" || match || s.serviceId || s.multi) {
              s.mode = "book";
              if (!s.serviceId && s.multi) s.serviceId = this.ctx.intake.default_by_type.routine_default;
              return this.advance();
            }
            this.say("I can book a visit, help with a prescription refill, or pass a message to the team. What can I do for you?");
            s.phase = "open";
            return;
        }
      }
      case "verify": {
        const named = this.petsIn(text, s.mode === "deceased");
        if (named.length > 0) {
          s.caller.verified = true;
          if (named.length > 1 || s.multi) {
            s.multi = true;
            s.petIds = named.map((p) => p.id);
          } else s.petId = named[0]!.id;
          return this.advance();
        }
        if (isNo(text) && !isYes(text) && parseName(text, 1).length === 0) {
          // Not the person on file: treat as a new caller with their own number.
          s.caller = { clientId: null, firstName: null, lastName: null, smsConsent: false, verified: false, verifyTries: 0 };
          s.pets = [];
          s.client = { firstName: null, lastName: null, mobile: null, mobileDeclined: true };
          return this.advance();
        }
        s.caller.verifyTries += 1;
        const name = parseName(text.replace(/\b(yes|yeah|yep|it is|that's me|speaking)\b/gi, " "), 1)[0];
        if (name && s.caller.verifyTries <= 2) {
          s.newPet = { name, species: speciesFromWords(text) };
          return this.ask("confirm_new_pet", `I don't see ${name} on your file. Is ${name} a new pet?`);
        }
        if (s.caller.verifyTries >= 3) {
          await this.task("callback", `Identity check: ${this.callerLabel()}`, `Caller could not be matched to a pet on file. Said: "${s.reason.join(" ")}"`);
          this.say("I'm sorry, I couldn't match that to our records. I've asked the team to call you back to help.");
          s.phase = "anything_else";
          return;
        }
        return this.say("And which of your pets is this about?");
      }
      case "confirm_new_pet": {
        if (isYes(text) && !isNo(text)) {
          s.caller.verified = true;
          return this.advance();
        }
        s.newPet = null;
        return this.ask("verify", "Sorry about that. Which of your pets is this about?");
      }
      case "question":
        return this.answer(text);
      case "ask_pet": {
        const named = this.petsIn(text, s.mode === "deceased");
        if (named.length) {
          s.petId = named[0]!.id;
          return this.advance();
        }
        if (/\b(new|another|different)\b/i.test(text) || parseName(text, 1).length) {
          s.newPet = { name: parseName(text.replace(/\b(new|another|different)\b/gi, " "), 2).join(" ") || null, species: speciesFromWords(text) };
          return this.advance();
        }
        return this.say("Sorry, which pet is this for?");
      }
      case "ask_service": {
        s.reason.push(text);
        s.prefer = parseTimeRequest(text, this.ctx.timezone, this.ctx.now) ?? s.prefer;
        const match = matchService(text, this.petFacts(this.pet), this.ctx.intake);
        if (!match) return this.ask("unclear_service", fillScript(this.ctx.intake.unclear_fallback.prompt, { patient_name: this.petName }));
        s.serviceId = match.serviceId;
        return this.advance();
      }
      case "unclear_service": {
        const n = normalizeUtterance(text);
        s.serviceId = / (routine|checkup|check up|annual|wellness|just|regular) /.test(n) ? this.ctx.intake.unclear_fallback.routine : this.ctx.intake.unclear_fallback.problem;
        return this.advance();
      }
      case "offering": {
        const choice = pickOffered(text, s.offered, this.ctx.timezone);
        if (typeof choice === "number") return this.takeSlot(choice);
        if (choice === "none") {
          if (s.offerRounds >= 3) {
            await this.task("callback", `Find a time: ${this.petName}`, `Caller declined ${s.offerRounds} sets of times for ${s.serviceId}.`);
            this.say("No problem. I've asked the team to call you to find a time that works.");
            this.resetBooking();
            return this.wrapUp();
          }
          return this.offer(Math.max(...s.offered.map((o) => o.start)));
        }
        const wanted = parseTimeRequest(text, this.ctx.timezone, this.ctx.now);
        if (wanted) {
          s.prefer = wanted;
          return this.offer();
        }
        const labels = s.offered.map((o) => slotLabel(o.start, this.ctx.timezone, this.ctx.now));
        return this.say(labels.length > 1 ? `Sorry, which works better: ${labels[0]} or ${labels[1]}? You can also tell me a day or time that suits you.` : `Sorry, does ${labels[0]} work? You can also tell me a day or time that suits you.`);
      }
      case "confirm_deceased": {
        const pet = this.pet;
        if (pet && isYes(text) && !isNo(text)) {
          await this.port.markDeceased({ patientId: pet.id, confirmedName: pet.name, confirmedSpecies: pet.species });
          pet.status = "deceased";
          this.say(fillScript(SCRIPTS.deceased, { pet_name: pet.name }));
          await this.task("sympathy", `Sympathy: ${pet.name}`, `${this.callerLabel()} told us ${pet.name} has died. Marked deceased; reminders stopped.`);
          s.outcomes.push("deceased_recorded");
        } else {
          // retention.json if_death_not_confirmed: no status change, priority task.
          await this.task("deceased_unconfirmed", `Possible death not confirmed${pet ? `: ${pet.name}` : ""}`, `${this.callerLabel()} said: "${s.reason.join(" ")}". Not confirmed on the call; status unchanged.`, "urgent");
          this.say("I'm sorry. I've asked the team to call you back so we get this right.");
        }
        this.wrapUp();
        return this.resetBooking();
      }
      case "rebook": {
        if (isYes(text) && !isNo(text)) {
          s.mode = "book";
          return this.advance();
        }
        this.wrapUp();
        return this.resetBooking();
      }
      case "ended":
        return;
    }
  }

  /** Stores the answer to the current new-client or new-pet question, then moves on. */
  async answer(text: string): Promise<void> {
    const s = this.s;
    const q = s.question!;
    // The caller does not want to go on ("maybe I'll wait till morning", "never mind").
    // Hard exits work at every question; a soft "no thanks" only where it can't be the answer itself.
    const hardExit = /\b(bye|goodbye|cancel|stop|never ?mind|forget it|don'?t bother)\b/i.test(text);
    const softExit = /\b(i'?ll wait|wait (?:till|until)|not now|no thanks?|maybe later)\b/i.test(text);
    if (hardExit || (softExit && !["sms_consent", "email", "referring_clinic", "mobile_confirm", "neutered"].includes(q))) {
      s.question = null;
      if (!s.caller.clientId) {
        s.client = null;
        s.newPet = null;
      }
      this.say(s.triage.level === "emergency" ? `Okay. Please don't wait if things get worse: ${this.er.er_name} is open now.` : "No problem.");
      this.wrapUp();
      return this.resetBooking();
    }
    const c = s.client;
    const p = s.newPet;
    const askAgain = () => this.say(`Sorry, ${QUESTION_PROMPTS[q].charAt(0).toLowerCase()}${QUESTION_PROMPTS[q].slice(1)}`.replace("{{patient_name}}", p?.name ?? this.petName).replace("{{mobile}}", c?.mobile ? formatPhone(c.mobile) : ""));
    /** One retry, then never get stuck: optional answers become "unknown", required ones go to the team. */
    const sorry = async (): Promise<void> => {
      if (!s.retried) {
        s.retried = true;
        return askAgain();
      }
      s.retried = false;
      if (q === "sex" && p) p.sex = null;
      else if (q === "sms_consent" && c) c.smsConsent = false;
      else if (q === "which_pets") s.multi = false;
      else {
        await this.task("callback", `Finish booking: ${this.callerLabel()}`, `Riley could not get the ${q.replace(/_/g, " ")} from the caller. Said: "${s.reason.join(" ")}"`);
        this.say("Sorry, I'm having trouble with that. I've asked the team to call you back to finish the booking.");
        s.question = null;
        if (!s.caller.clientId) {
          s.client = null;
          s.newPet = null;
        }
        this.wrapUp();
        return this.resetBooking();
      }
      s.question = null;
      return this.advance();
    };
    switch (q) {
      case "first_name":
      case "last_name": {
        const words = parseName(text, 2);
        if (!words.length) return sorry();
        if (q === "first_name") {
          c!.firstName = words[0]!;
          if (words[1] && !c!.lastName) c!.lastName = words[1];
        } else c!.lastName = words.at(-1)!;
        break;
      }
      case "mobile_confirm": {
        const digits = parsePhoneDigits(text);
        if (digits) c!.mobile = `+1${digits}`;
        else if (isYes(text) && !isNo(text)) c!.mobile = this.ctx.callerNumber;
        else {
          c!.mobileDeclined = true;
          c!.mobile = null;
          return this.askQuestion("mobile");
        }
        break;
      }
      case "mobile": {
        const digits = parsePhoneDigits(text);
        if (!digits) return sorry();
        c!.mobile = `+1${digits}`;
        this.say(`Thanks, that's ${formatPhone(c!.mobile)}.`);
        break;
      }
      case "email": {
        c!.email = parseEmail(text);
        if (!c!.email) this.say("That's fine, I'll text you instead.");
        break;
      }
      case "sms_consent": {
        const yes = parseYesNo(text);
        if (yes === null) return sorry();
        c!.smsConsent = yes;
        break;
      }
      case "pet_name": {
        const name = parseName(text, 2).join(" ");
        if (!name) return sorry();
        s.newPet = { ...(p ?? { species: null }), name, species: p?.species ?? speciesFromWords(text) };
        break;
      }
      case "species": {
        const species = speciesFromWords(text) ?? (/\b(other|another|something else|exotic)\b/i.test(text) ? "other" : null);
        if (!species) return sorry();
        p!.species = species;
        break;
      }
      case "breed":
        p!.breed = parseBreed(text);
        break;
      case "age": {
        const age = parseAgeMonths(text);
        if (age === undefined && !/\d/.test(text) && !s.retried) {
          s.retried = true;
          return this.say(`Sorry, how old is ${p?.name ?? "your pet"}, roughly? For example "3 years" or "not sure".`);
        }
        if (age === undefined) {
          const n = text.match(/\d+/);
          p!.ageMonths = n ? Number(n[0]) * 12 : null; // never_block: "not sure" is fine
        } else p!.ageMonths = age;
        break;
      }
      case "sex": {
        const sex = parseSex(text);
        if (sex === undefined) return sorry();
        p!.sex = sex;
        break;
      }
      case "neutered": {
        const v = parseNeutered(text);
        p!.neutered = v === undefined ? null : v;
        break;
      }
      case "referring_clinic": {
        const n = normalizeUtterance(text);
        const none = / (no|nope|none|first vet|first time|never|not yet) /.test(n) && !/ (yes|yeah) /.test(n);
        if (!none) {
          const clinic = text.replace(/^(yes|yeah|yep)[,.]?\s*/i, "").replace(/^(at|we went to|we used|it was)\s+/i, "").trim();
          await this.task("records_transfer", `Request records: ${this.petName}`, `${this.callerLabel()} is new. Previous clinic: ${clinic.slice(0, 200)}. Request ${this.petName}'s records.`);
          this.say("Thanks, we'll request the records.");
        }
        break;
      }
      case "which_pets": {
        const named = this.petsIn(text);
        if (named.length < 2) {
          if (named.length === 1) {
            s.multi = false;
            s.petId = named[0]!.id;
            break;
          }
          return sorry();
        }
        s.petIds = named.map((x) => x.id);
        break;
      }
    }
    s.question = null;
    return this.advance();
  }
}

/** Handles one thing the caller said and returns what to say back. */
export async function respond(state: ConversationState, text: string, ctx: FrontDeskContext, port: FrontDeskPort): Promise<TurnResult> {
  const s: ConversationState = structuredClone(state);
  const turn = new Turn(s, ctx, port);
  if (s.phase === "ended") {
    return { state: s, replies: [`This conversation has ended. Please contact ${ctx.clinicName} again if you need anything.`] };
  }

  // A pet named in the message counts even if triage cuts the turn short.
  // Before verification, a named pet on file is the identity check itself.
  const named = turn.petsIn(text, deathMentioned(text));
  if (named.length === 1 && !s.petId && s.caller.clientId) {
    s.petId = named[0]!.id;
    s.caller.verified = true;
  } else if (named.length > 1 && s.caller.clientId) {
    s.caller.verified = true;
  }

  // Triage first, on every utterance, with the household's pet names masked.
  const petNames = [...s.pets.map((p) => p.name), ...(s.newPet?.name ? [s.newPet.name] : [])];
  const applied = applyAssessment(s.triage, await port.classify(text, petNames));
  s.triage = applied.state;
  if (applied.escalated && s.triage.level === "emergency") {
    s.reason.push(text);
    await turn.emergency(applied.newMatches, text);
    return { state: s, replies: turn.replies };
  }
  let intentOverride: Intent | null = null;
  if (applied.escalated && s.triage.level === "urgent") {
    for (const m of applied.newMatches) await port.logTriage({ match: m, actionTaken: "book_urgent" });
    turn.say("I'm sorry to hear that.");
    s.serviceId = ctx.rules.levels.urgent.service_id;
    s.urgentWindow = true;
    s.triedDropOff = false;
    s.offered = [];
    s.mode = "book";
    if (detectIntent(text) === "advice") s.adviceAsked = true;
    // Keep whatever the caller was answering (a name, a pet); otherwise book.
    if (s.phase === "offering" || s.phase === "ask_service" || s.phase === "unclear_service") s.phase = "open";
    intentOverride = "book";
  } else {
    for (const m of applied.newMatches) await port.logTriage({ match: m, actionTaken: "noted" });
  }
  await turn.handle(text, s.phase === "open" || s.phase === "anything_else" ? intentOverride : null);
  return { state: s, replies: turn.replies };
}

/**
 * The warm transfer did not connect (no answer, busy, failed). Pack W6: read
 * the ER details, text them and raise an urgent staff alert.
 */
export async function respondTransferFailed(state: ConversationState, ctx: FrontDeskContext, port: FrontDeskPort): Promise<TurnResult> {
  const s: ConversationState = structuredClone(state);
  const turn = new Turn(s, ctx, port);
  s.transferOutcome = "failed";
  s.phase = "open";
  const action = decideTriageAction(ctx.rules, "emergency", { ...ctx.situation, transferFailed: true });
  if (action.kind === "er_referral") await turn.erReferral(action, []);
  s.phase = "ended";
  return { state: s, replies: turn.replies };
}

/** A one-line summary of the conversation for the calls list. */
export function summarizeConversation(s: ConversationState): string {
  const parts: string[] = [];
  const lead = leadingMatch(s.triage);
  if (s.triage.level !== "routine") parts.push(`${s.triage.level === "emergency" ? "Emergency" : "Urgent"}: ${lead?.triggerName ?? "concern"}`);
  if (s.transferOutcome === "transferred") parts.push("transferred to staff");
  if (s.outcomes.includes("emergency_staff_alerted")) parts.push("staff asked to call now");
  if (s.transferOutcome === "er_referred" || s.transferOutcome === "failed") parts.push("referred to ER");
  const booked = s.booked.length || s.appointmentIds.length;
  if (s.outcomes.includes("rescheduled")) parts.push("visit moved");
  else if (booked) parts.push(`booked ${booked} visit${booked > 1 ? "s" : ""}`);
  const labels: Record<string, string> = {
    new_client: "new client",
    refill_requested: "refill requested",
    callback_requested: "callback requested",
    urgent_callback: "callback requested",
    passed_to_staff: "passed to staff",
    cancelled: "visit cancelled",
    late_cancel: "late cancellation",
    deceased_recorded: "pet's death recorded",
    deceased_already_recorded: "pet already recorded as deceased",
    end_of_life_request: "end-of-life request",
  };
  for (const o of s.outcomes) if (labels[o]) parts.push(labels[o]!);
  const unique = [...new Set(parts)];
  if (unique.length === 0) return "Enquiry, no action";
  const text = unique.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
