// The AI front desk conversation (workflows W1 and W6, pack v0.2).
// One engine serves texts and calls. It decides what to say and what to do;
// the database layer supplies a "port" (look up, book, create tasks, send
// texts, transfer), so the rules can be tested without a database and the
// Azure AI can drive the same port later.
//
// Every caller turn is triaged first. An emergency stops whatever was
// happening; an urgent symptom switches the booking to a same or next day
// sick visit. Levels never go down within a conversation.
import { formatPhone, type Species } from "./clients";
import { ConflictError } from "./errors";
import { adjustServiceForPet, detectIntent, isGoodbye, isNo, matchService, parseName, speciesFromWords, pickOffered, slotLabel, type Intent } from "./front-desk-language";
import {
  applyAssessment,
  normalizeUtterance,
  decideTriageAction,
  erValues,
  fillScript,
  initialTriage,
  leadingMatch,
  transferSummary,
  type TriageAction,
  type TriageAssessment,
  type TriageLevel,
  type TriageMatch,
  type TriageRules,
  type TriageSituation,
  type TriageState,
} from "./triage";

// ---------- Inputs ----------

export interface PetRef {
  id: string;
  name: string;
  species: Species;
  ageMonths: number | null;
  /** Created during this conversation. */
  isNew?: boolean;
}

export interface CallerRecord {
  clientId: string;
  firstName: string;
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
}

export interface TaskRequest {
  type: string;
  title: string;
  details: string;
  priority: "normal" | "urgent";
  clientId: string | null;
  patientId: string | null;
}

export interface FrontDeskPort {
  classify(text: string, petNames: string[]): Promise<TriageAssessment>;
  /** Up to two good options (or the next ones after `after`), searching `withinDays` from today. */
  findSlots(req: { patientId: string; packServiceId: string; withinDays: number; after?: number }): Promise<{ slots: SlotOffer[]; blocked: string | null }>;
  book(req: { patientId: string; packServiceId: string; slot: SlotOffer; reason: string | null; triageLevel: TriageLevel }): Promise<{ appointmentId: string }>;
  createCaller(req: { firstName: string; lastName: string; mobile: string; pet: { name: string; species: Species } }): Promise<CallerRecord>;
  addPet(req: { clientId: string; name: string; species: Species }): Promise<PetRef>;
  createTask(req: TaskRequest): Promise<void>;
  sendText(req: { to: string; body: string; templateKey: string; clientId: string | null }): Promise<void>;
  transfer(req: { to: string; summary: string }): Promise<{ ok: boolean }>;
  logTriage(req: { match: TriageMatch; actionTaken: string }): Promise<void>;
}

// ---------- State ----------

export type Phase =
  | "open"
  | "ask_name"
  | "ask_last_name"
  | "ask_pet"
  | "ask_pet_name"
  | "ask_species"
  | "ask_service"
  | "offering"
  | "anything_else"
  | "ended";

export type TransferOutcome = "none" | "transferred" | "failed" | "er_referred";

export interface ConversationState {
  phase: Phase;
  triage: TriageState;
  caller: { clientId: string | null; firstName: string | null; lastName: string | null };
  pets: PetRef[];
  petId: string | null;
  /** A pet being added in this conversation. */
  newPet: { name: string | null; species: Species | null } | null;
  /** Pack service id being booked. */
  serviceId: string | null;
  /** Book today or tomorrow (urgent). */
  urgentWindow: boolean;
  triedDropOff: boolean;
  adviceAsked: boolean;
  careNoted: boolean;
  pending: "refill" | null;
  reason: string[];
  offered: SlotOffer[];
  offerRounds: number;
  appointmentIds: string[];
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
    triage: initialTriage,
    caller: { clientId: caller?.clientId ?? null, firstName: caller?.firstName ?? null, lastName: null },
    pets: caller?.pets ?? [],
    petId: null,
    newPet: null,
    serviceId: null,
    urgentWindow: false,
    triedDropOff: false,
    adviceAsked: false,
    careNoted: false,
    pending: null,
    reason: [],
    offered: [],
    offerRounds: 0,
    appointmentIds: [],
    outcomes: [],
    transferOutcome: "none",
  };
  const greeting = caller
    ? `Hi ${caller.firstName}, this is ${ctx.aiName} at ${ctx.clinicName}. How can I help today?`
    : `Thanks for contacting ${ctx.clinicName}, this is ${ctx.aiName}. How can I help today?`;
  return { state, replies: [greeting] };
}

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

  get pet(): PetRef | null {
    return this.s.pets.find((p) => p.id === this.s.petId) ?? null;
  }

  get petName(): string {
    return this.pet?.name ?? this.s.newPet?.name ?? "your pet";
  }

  get er() {
    return erValues(this.ctx.situation.er).values;
  }

  task(type: string, title: string, details: string, priority: "normal" | "urgent" = "normal") {
    return this.port.createTask({ type, title, details, priority, clientId: this.s.caller.clientId, patientId: this.s.petId });
  }

  callerLabel(): string {
    const name = [this.s.caller.firstName, this.s.caller.lastName].filter(Boolean).join(" ");
    return name || this.ctx.callerNumber || "Unknown caller";
  }

  wrapUp(question = "Is there anything else I can help with?") {
    this.say(question);
    this.s.phase = "anything_else";
  }

  resetBooking() {
    this.s.serviceId = null;
    this.s.urgentWindow = false;
    this.s.triedDropOff = false;
    this.s.adviceAsked = false;
    this.s.careNoted = false;
    this.s.offered = [];
    this.s.offerRounds = 0;
    if (this.s.pets.length > 1) this.s.petId = null;
  }

  findPetIn(text: string): PetRef | null {
    const n = normalizeUtterance(text);
    return this.s.pets.find((p) => n.includes(normalizeUtterance(p.name))) ?? null;
  }

  // ----- Triage -----

  async emergency(newMatches: TriageMatch[]) {
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
      this.say(action.say);
      const summary = transferSummary(this.ctx.rules, this.s.triage, {
        patientName: this.pet?.name ?? this.s.newPet?.name ?? null,
        species: this.pet?.species ?? this.s.newPet?.species ?? null,
        clientFirstName: this.s.caller.firstName,
        mobile: this.ctx.callerNumber,
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
      this.s.serviceId = this.ctx.rules.levels.urgent.service_id;
      this.s.urgentWindow = false;
      this.s.offered = [];
      await this.advance();
      return;
    }
    this.s.phase = "ended";
  }

  // ----- Moving the booking forward -----

  /** Asks for whatever is missing, or offers times when everything is known. */
  async advance(): Promise<void> {
    const s = this.s;
    // 1. Who is calling. New callers give a name and their pet before we create them.
    if (!s.caller.clientId) {
      if (!s.caller.firstName) return this.ask("ask_name", "I can help with that. Can I have your first and last name?");
      if (!s.caller.lastName) return this.ask("ask_last_name", `Thanks, ${s.caller.firstName}. And your last name?`);
      s.newPet ??= { name: null, species: null };
      if (!s.newPet.name) return this.ask("ask_pet_name", "And what's your pet's name?");
      if (!s.newPet.species) return this.ask("ask_species", `Is ${s.newPet.name} a dog, a cat, or another animal?`);
      if (!this.ctx.callerNumber) {
        await this.task("callback", `Call back ${this.callerLabel()}`, `New caller with no number on file wants help for ${s.newPet.name}.`);
        this.say("I've asked the team to call you back to finish setting this up.");
        s.phase = "ended";
        return;
      }
      const created = await this.port.createCaller({
        firstName: s.caller.firstName,
        lastName: s.caller.lastName,
        mobile: this.ctx.callerNumber,
        pet: { name: s.newPet.name, species: s.newPet.species },
      });
      s.caller.clientId = created.clientId;
      s.pets = created.pets.map((p) => ({ ...p, isNew: true }));
      s.petId = s.pets[0]?.id ?? null;
      s.newPet = null;
      s.outcomes.push("new_client");
      await this.task("records_request", `New client: request records for ${this.petName}`, `${this.callerLabel()} is new. Ask the previous clinic for ${this.petName}'s records.`);
    }

    // 2. Which pet.
    if (!s.petId) {
      if (s.newPet) {
        if (!s.newPet.name) return this.ask("ask_pet_name", "What's your new pet's name?");
        if (!s.newPet.species) return this.ask("ask_species", `Is ${s.newPet.name} a dog, a cat, or another animal?`);
        const pet = await this.port.addPet({ clientId: s.caller.clientId!, name: s.newPet.name, species: s.newPet.species });
        s.pets.push({ ...pet, isNew: true });
        s.petId = pet.id;
        s.newPet = null;
      } else if (s.pets.length === 1) {
        s.petId = s.pets[0]!.id;
      } else if (s.pets.length === 0) {
        s.newPet = { name: null, species: null };
        return this.ask("ask_pet_name", "What's your pet's name?");
      } else {
        const names = s.pets.map((p) => p.name);
        return this.ask("ask_pet", `Is this for ${names.slice(0, -1).join(", ")} or ${names.at(-1)}?`);
      }
    }

    // 3. Requests that are not bookings.
    if (s.pending === "refill") {
      s.pending = null;
      await this.task("refill_request", `Refill request: ${this.petName}`, `${this.callerLabel()} asked: "${s.reason.join(" ")}"`);
      const script = this.ctx.services.rx_refill_request?.aiScript ?? "I'll pass the refill request for {{pet_name}} to the team.";
      this.say(fillScript(script, { pet_name: this.petName, refill_turnaround: this.ctx.refillTurnaround }));
      s.outcomes.push("refill_requested");
      return this.wrapUp();
    }

    // 4. What to book.
    if (!s.serviceId) return this.ask("ask_service", `What would you like to book for ${this.petName}? For example a checkup, vaccines or a nail trim.`);
    if (this.pet) s.serviceId = adjustServiceForPet(s.serviceId, { ...this.pet, isNew: Boolean(this.pet.isNew) });
    let info = this.ctx.services[s.serviceId];
    if (!info || !info.bookableByAi) {
      if (info?.aiAction === "book_exam_first") {
        this.say(fillScript(info.aiScript ?? "", { pet_name: this.petName }).split(/(?<=\.)\s/)[0] ?? "");
        s.serviceId = "sick_visit";
        info = this.ctx.services.sick_visit;
      } else {
        await this.task("service_request", `${info?.id ?? s.serviceId} request: ${this.petName}`, `${this.callerLabel()} asked: "${s.reason.join(" ")}"`);
        this.say(fillScript(info?.aiScript ?? "I'll pass this to the team and someone will call you back.", { pet_name: this.petName }));
        s.outcomes.push("passed_to_staff");
        this.resetBooking();
        return this.wrapUp();
      }
    }
    if (info?.aiHandling === "book_with_care" && !s.careNoted) {
      s.careNoted = true;
      this.say(`I'm so sorry. We'll take good care of ${this.petName} and you. Let me find a quiet time.`);
    }
    await this.offer();
  }

  ask(phase: Phase, question: string) {
    this.s.phase = phase;
    this.say(question);
  }

  async offer(after?: number): Promise<void> {
    const s = this.s;
    const withinDays = s.urgentWindow ? 2 : 14;
    const { slots, blocked } = await this.port.findSlots({ patientId: s.petId!, packServiceId: s.serviceId!, withinDays, after });
    if (blocked) {
      const info = this.ctx.services[s.serviceId!];
      if (info?.fallbackServiceId && info.fallbackServiceId !== s.serviceId) {
        if (info.fallbackScript) this.say(fillScript(info.fallbackScript, { pet_name: this.petName }));
        s.serviceId = info.fallbackServiceId;
        return this.offer();
      }
      await this.task("callback", `Booking needs staff: ${this.petName}`, `${blocked} Request: "${s.reason.join(" ")}"`);
      this.say(`${blocked} I've asked the team to call you back to set this up.`);
      this.resetBooking();
      return this.wrapUp();
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
        this.resetBooking();
        return this.wrapUp();
      }
      await this.task("callback", `Find a time: ${this.petName}`, `No opening in two weeks for ${s.serviceId}. Caller: ${this.callerLabel()}`);
      this.say("I couldn't find an opening in the next two weeks. I've asked the team to call you to find a time.");
      this.resetBooking();
      return this.wrapUp();
    }

    const dropOff = s.triedDropOff && s.serviceId === this.ctx.rules.levels.urgent.fallback_if_no_slot;
    s.offered = dropOff ? slots.slice(0, 1) : slots.slice(0, 2);
    s.offerRounds += 1;
    s.phase = "offering";
    const [a, b] = s.offered.map((o) => slotLabel(o.start, this.ctx.timezone, this.ctx.now));
    const scripts = this.ctx.rules.scripts;
    const values = { patient_name: this.petName, slot_1: a, slot_2: b, ...this.er };
    if (dropOff && scripts.urgent_no_slot) return this.say(fillScript(scripts.urgent_no_slot, values));
    if (s.urgentWindow && b && scripts.urgent_booked) return this.say(fillScript(scripts.urgent_booked, values).replace(/\.\s+If anything.*$/, ". Which works better?"));
    if (s.adviceAsked && b && scripts.advice_requested) {
      s.adviceAsked = false;
      return this.say(`${fillScript(scripts.advice_requested, values)} Which works better?`);
    }
    const phrase = this.ctx.services[s.serviceId!]?.aiPhrase ?? "an appointment";
    this.say(b ? `For ${phrase} for ${this.petName}, I have ${a} or ${b}. Which works better?` : `The next opening for ${phrase} for ${this.petName} is ${a}. Does that work?`);
  }

  async book(slot: SlotOffer): Promise<void> {
    const s = this.s;
    try {
      const { appointmentId } = await this.port.book({
        patientId: s.petId!,
        packServiceId: s.serviceId!,
        slot,
        reason: s.reason.join(" ").slice(0, 500) || null,
        triageLevel: s.triage.level,
      });
      s.appointmentIds.push(appointmentId);
    } catch (error) {
      if (error instanceof ConflictError) {
        this.say("Sorry, that time was just taken.");
        return this.offer();
      }
      throw error;
    }
    const phrase = this.ctx.services[s.serviceId!]?.aiPhrase ?? "an appointment";
    const when = slotLabel(slot.start, this.ctx.timezone, this.ctx.now);
    s.outcomes.push(s.triage.level === "routine" ? "booked" : `booked_${s.triage.level}`);
    this.say(`You're all set: ${this.petName} is booked for ${phrase} ${when}.`);
    if (s.triage.level !== "routine") this.say(`If anything gets worse before then, please go to ${this.er.er_name} or call us straight back.`);
    this.resetBooking();
    this.wrapUp();
  }

  // ----- Phases -----

  async handle(text: string, intentOverride: Intent | null): Promise<void> {
    const s = this.s;
    switch (s.phase) {
      case "open":
      case "anything_else": {
        const intent = intentOverride ?? detectIntent(text);
        const service = matchService(text, this.pet ? { ...this.pet, isNew: Boolean(this.pet.isNew) } : null);
        if (s.phase === "anything_else" && intent === "unknown" && !service && (isGoodbye(text) || isNo(text))) {
          this.say(`Thanks for contacting ${this.ctx.clinicName}. Take care!`);
          s.phase = "ended";
          return;
        }
        s.reason.push(text);
        const named = this.findPetIn(text);
        if (named) s.petId = named.id;
        if (service && !s.serviceId) s.serviceId = service;
        switch (intent) {
          case "hours":
            this.say(`We're open ${this.ctx.hoursText}.`);
            return this.wrapUp();
          case "reschedule":
          case "cancel":
            await this.task("change_appointment", `${intent === "cancel" ? "Cancel" : "Reschedule"} request: ${this.callerLabel()}`, `Caller said: "${text}"`);
            this.say(`I've passed that to the team. They'll ${intent === "cancel" ? "cancel" : "move"} the appointment and text you to confirm.`);
            s.outcomes.push(`${intent}_requested`);
            return this.wrapUp();
          case "staff":
            await this.task("callback", `Call back ${this.callerLabel()}`, `Caller asked to speak to someone. Said: "${text}"`);
            this.say(this.ctx.situation.open ? "I've asked the team to call you back as soon as they can." : "I've asked the team to call you back when we open.");
            s.outcomes.push("callback_requested");
            return this.wrapUp();
          case "refill":
            s.pending = "refill";
            s.serviceId = null;
            return this.advance();
          case "advice":
            s.adviceAsked = true;
            s.serviceId ??= "sick_visit";
            return this.advance();
          default:
            if (intent === "book" || service || s.serviceId) return this.advance();
            this.say("I can book a visit, help with a prescription refill, or pass a message to the team. What can I do for you?");
            s.phase = "open";
            return;
        }
      }
      case "ask_name": {
        const words = parseName(text, 2);
        if (words.length === 0) return this.say("Sorry, could I have your first and last name?");
        s.caller.firstName = words[0]!;
        s.caller.lastName = words[1] ?? null;
        return this.advance();
      }
      case "ask_last_name": {
        const words = parseName(text, 1);
        if (words.length === 0) return this.say("Sorry, what's your last name?");
        s.caller.lastName = words[0]!;
        return this.advance();
      }
      case "ask_pet": {
        const named = this.findPetIn(text);
        if (named) {
          s.petId = named.id;
          return this.advance();
        }
        const name = parseName(text.replace(/\b(new|another|different)\b/gi, " "), 2).join(" ");
        if (!name) return this.say(`Sorry, which pet is this for? ${s.pets.map((p) => p.name).join(", ")}, or a new pet?`);
        s.newPet = { name, species: speciesFromWords(text) };
        return this.advance();
      }
      case "ask_pet_name": {
        const name = parseName(text, 2).join(" ");
        if (!name) return this.say("Sorry, what's your pet's name?");
        s.newPet = { name, species: speciesFromWords(text) ?? s.newPet?.species ?? null };
        return this.advance();
      }
      case "ask_species": {
        const species = speciesFromWords(text) ?? (/\b(other|another|something else)\b/i.test(text) ? "other" : null);
        if (!species) return this.say(`Is ${s.newPet?.name ?? "your pet"} a dog, a cat, or another animal?`);
        s.newPet = { name: s.newPet?.name ?? null, species };
        return this.advance();
      }
      case "ask_service": {
        s.reason.push(text);
        const service = matchService(text, this.pet ? { ...this.pet, isNew: Boolean(this.pet.isNew) } : null);
        if (!service) return this.say(`Sorry, what would you like to book for ${this.petName}? For example a checkup, vaccines or a nail trim.`);
        s.serviceId = service;
        return this.advance();
      }
      case "offering": {
        const choice = pickOffered(text, s.offered, this.ctx.timezone);
        if (typeof choice === "number") return this.book(s.offered[choice]!);
        if (choice === "none") {
          if (s.offerRounds >= 3) {
            await this.task("callback", `Find a time: ${this.petName}`, `Caller declined ${s.offerRounds} sets of times for ${s.serviceId}.`);
            this.say("No problem. I've asked the team to call you to find a time that works.");
            this.resetBooking();
            return this.wrapUp();
          }
          return this.offer(Math.max(...s.offered.map((o) => o.start)));
        }
        const labels = s.offered.map((o) => slotLabel(o.start, this.ctx.timezone, this.ctx.now));
        return this.say(labels.length > 1 ? `Sorry, which works better: ${labels[0]} or ${labels[1]}?` : `Sorry, does ${labels[0]} work?`);
      }
      case "ended":
        return;
    }
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
  const named = turn.findPetIn(text);
  if (named) s.petId = named.id;

  // Triage first, on every utterance, with the household's pet names masked.
  const petNames = [...s.pets.map((p) => p.name), ...(s.newPet?.name ? [s.newPet.name] : [])];
  const applied = applyAssessment(s.triage, await port.classify(text, petNames));
  s.triage = applied.state;
  if (applied.escalated && s.triage.level === "emergency") {
    s.reason.push(text);
    await turn.emergency(applied.newMatches);
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
    // Keep whatever the caller was answering (a name, a pet); otherwise book.
    if (s.phase === "offering" || s.phase === "ask_service") s.phase = "open";
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
  const booked = s.appointmentIds.length;
  if (booked) parts.push(`booked ${booked} visit${booked > 1 ? "s" : ""}`);
  for (const o of s.outcomes) {
    if (o === "new_client") parts.push("new client");
    if (o === "refill_requested") parts.push("refill requested");
    if (o === "callback_requested" || o === "urgent_callback") parts.push("callback requested");
    if (o === "reschedule_requested" || o === "cancel_requested") parts.push(o.replace("_requested", " requested"));
    if (o === "passed_to_staff") parts.push("passed to staff");
  }
  const unique = [...new Set(parts)];
  if (unique.length === 0) return "Enquiry, no action";
  const text = unique.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
