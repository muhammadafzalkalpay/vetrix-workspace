// The AI front desk engine against the pack (v0.2) and the scripted calls in
// docs/test-data/test-calls.md, with a port that records everything.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ConflictError } from "./errors";
import {
  respond,
  respondTransferFailed,
  SCRIPTS,
  startConversation,
  summarizeConversation,
  type CallerRecord,
  type ConversationState,
  type FrontDeskContext,
  type FrontDeskPort,
  type NewPetInput,
  type ServiceInfo,
  type SlotOffer,
  type TaskRequest,
  type UpcomingVisit,
} from "./front-desk";
import { describeHours, detectIntent, extractFacts, matchService, parseName, pickOffered, slotLabel, type IntakeRules } from "./front-desk-language";
import { classifyByPhrases, type TriageRules } from "./triage";
import { zonedInstant } from "./time";

const pack = (file: string) => JSON.parse(readFileSync(new URL(`../../pack/veterinary/${file}`, import.meta.url), "utf8"));
const rules = pack("triage.json") as FrontDeskContext["rules"];
const intakeJson = pack("intake.json");
const intake = intakeJson.reason_for_visit as IntakeRules;
const refillRule = intake.keyword_to_service.find((r) => r.service_id === "rx_refill_request") as unknown as { controlled_substance_keywords: string[] };
const services: Record<string, ServiceInfo> = Object.fromEntries(
  (pack("services.json").services as Record<string, unknown>[]).map((s) => [
    s.id as string,
    {
      id: s.id as string,
      aiPhrase: (s.ai_phrase as string) ?? null,
      bookableByAi: Boolean(s.bookable_by_ai),
      aiAction: (s.ai_action as string) ?? null,
      aiScript: (s.ai_script as string) ?? null,
      aiHandling: (s.ai_handling as string) ?? null,
      fallbackServiceId: (s.fallback_service_if_prerequisite_fails as string) ?? null,
      fallbackScript: (s.fallback_script as string) ?? null,
      controlledScript: (s.controlled_substance_script as string) ?? null,
      fastingRequired: Boolean(s.fasting_required),
      requiresPreop: Boolean(s.requires_preop_bloodwork),
      dropOffWindow: (s.drop_off_window as string) ?? null,
      whatToBring: (s.what_to_bring as string[]) ?? [],
    } satisfies ServiceInfo,
  ]),
);

const TZ = "America/New_York";
// Tuesday 17 Nov 2026, 10:00 in clinic time.
const NOW = zonedInstant("2026-11-17", "10:00", TZ);
const at = (date: string, time: string) => zonedInstant(date, time, TZ);

function ctx(over: Partial<FrontDeskContext> = {}): FrontDeskContext {
  return {
    clinicName: "Main Veterinary Clinic",
    clinicPhone: "(555) 010-1000",
    aiName: "Riley",
    timezone: TZ,
    now: NOW,
    callerNumber: "+15555550123",
    channel: "voice",
    rules,
    services,
    situation: {
      open: true,
      transferNumber: "+15555550100",
      afterHoursBehaviour: "er_and_book_next",
      er: { name: "Metro Animal ER", phone: "(555) 010-9111", address: "900 Sample Avenue" },
    },
    hoursText: "Monday to Saturday, 7 AM to 6 PM",
    refillTurnaround: "one business day",
    intake,
    whatToBringPhrases: intakeJson.what_to_bring_phrases,
    policy: { cancellationWindowHours: 24, cancellationFee: 35 },
    ...over,
  };
}

/** A port that records everything and offers fixed times. */
function fakePort(opts: { slots?: (serviceId: string, withinDays: number) => SlotOffer[]; transferOk?: boolean; conflictOnce?: boolean; blocked?: Record<string, string>; upcoming?: UpcomingVisit[]; preopValid?: boolean } = {}) {
  const log = {
    tasks: [] as TaskRequest[],
    texts: [] as { to: string; body: string; templateKey: string }[],
    booked: [] as { packServiceId: string; slot: SlotOffer; triageLevel: string; preop?: boolean }[],
    groups: [] as { items: { patientId: string; packServiceId: string }[] }[],
    triage: [] as { triggerId: string; actionTaken: string }[],
    transfers: [] as { to: string; summary: string }[],
    created: [] as { firstName: string; lastName: string; mobile: string; email: string | null; smsConsent: boolean; pet: NewPetInput }[],
    searches: [] as { packServiceId: string; withinDays: number; after?: number; excludeAppointmentId?: string }[],
    rescheduled: [] as { appointmentId: string; slot: SlotOffer }[],
    cancelled: [] as { appointmentId: string; reason: string; lateCancel: boolean }[],
    deceased: [] as { patientId: string; confirmedName: string }[],
  };
  let conflict = opts.conflictOnce ?? false;
  const defaultSlots = (): SlotOffer[] => [
    { start: at("2026-11-18", "09:00"), end: at("2026-11-18", "09:30"), providerId: "p1" },
    { start: at("2026-11-18", "14:00"), end: at("2026-11-18", "14:30"), providerId: "p1" },
    { start: at("2026-11-19", "09:00"), end: at("2026-11-19", "09:30"), providerId: "p1" },
    { start: at("2026-11-19", "15:00"), end: at("2026-11-19", "15:30"), providerId: "p1" },
  ];
  const port: FrontDeskPort = {
    classify: async (text, petNames) => classifyByPhrases(rules as TriageRules, text, { petNames }),
    findSlots: async (req) => {
      log.searches.push(req);
      if (opts.blocked?.[req.packServiceId]) return { slots: [], blocked: opts.blocked[req.packServiceId]! };
      const all = (opts.slots ?? defaultSlots)(req.packServiceId, req.withinDays).filter((s) => req.after === undefined || s.start > req.after);
      return { slots: all.slice(0, 2), blocked: null };
    },
    findGroupSlots: async (req) => {
      const base = defaultSlots();
      return {
        groups: base.slice(0, 2).map((s) => req.items.map((_, i) => ({ start: s.start + i * 30 * 60_000, end: s.end + i * 30 * 60_000, providerId: "p1" }))),
        blocked: null,
      };
    },
    book: async (req) => {
      if (conflict) {
        conflict = false;
        throw new ConflictError("Taken");
      }
      log.booked.push(req);
      const preopStart = req.preop && !opts.preopValid ? req.slot.start - 24 * 3_600_000 : null;
      return { appointmentId: `appt-${log.booked.length}`, providerName: "Dr. Patel", preopStart, preopValid: Boolean(opts.preopValid) };
    },
    bookGroup: async (req) => {
      log.groups.push(req);
      return { appointmentIds: req.items.map((_, i) => `grp-${i}`), providerNames: req.items.map(() => "Dr. Patel") };
    },
    upcoming: async () => opts.upcoming ?? [],
    reschedule: async (req) => {
      log.rescheduled.push(req);
      return { appointmentId: `moved-${req.appointmentId}`, providerName: "Dr. Patel" };
    },
    cancel: async (req) => void log.cancelled.push(req),
    markDeceased: async (req) => void log.deceased.push(req),
    createCaller: async (req) => {
      log.created.push(req);
      return { clientId: "client-new", firstName: req.firstName, smsConsent: req.smsConsent, pets: [{ id: "pet-new", name: req.pet.name, species: req.pet.species, ageMonths: req.pet.ageMonths, sex: req.pet.sex, neutered: req.pet.neutered, flags: req.pet.flags }] };
    },
    addPet: async (req) => ({ id: "pet-added", name: req.pet.name, species: req.pet.species, ageMonths: req.pet.ageMonths, sex: req.pet.sex, neutered: req.pet.neutered }),
    createTask: async (t) => void log.tasks.push(t),
    sendText: async (t) => void log.texts.push(t),
    transfer: async (t) => {
      log.transfers.push(t);
      return { ok: opts.transferOk ?? true };
    },
    logTriage: async ({ match, actionTaken }) => void log.triage.push({ triggerId: match.triggerId, actionTaken }),
  };
  return { port, log };
}

const sam: CallerRecord = {
  clientId: "client-1",
  firstName: "Sam",
  smsConsent: true,
  pets: [{ id: "pet-max", name: "Max", species: "dog", ageMonths: 40, sex: "male", neutered: false }],
};
const household: CallerRecord = {
  clientId: "client-2",
  firstName: "Ana",
  smsConsent: true,
  pets: [
    { id: "pet-a", name: "Chocolate", species: "dog", ageMonths: 30, sex: "female", neutered: false },
    { id: "pet-b", name: "Lily", species: "cat", ageMonths: 130, sex: "female", neutered: true, flags: ["cat_carrier_required"] },
    { id: "pet-c", name: "Pumpkin", species: "cat", ageMonths: 150, status: "deceased" },
  ],
};

async function talk(c: FrontDeskContext, port: FrontDeskPort, caller: CallerRecord | null, lines: string[]) {
  let { state } = startConversation(c, caller);
  const replies: string[][] = [];
  for (const line of lines) {
    const r = await respond(state, line, c, port);
    state = r.state;
    replies.push(r.replies);
  }
  return { state, replies, all: replies.map((r) => r.join(" ")), last: replies.at(-1)!.join(" ") };
}

describe("opening the call (05-compliance.md)", () => {
  it("plays the recording disclosure on calls, then the verbatim greeting, without the caller's name", () => {
    const { replies } = startConversation(ctx(), sam);
    expect(replies).toEqual([SCRIPTS.recordingDisclosure, "Thanks for calling Main Veterinary Clinic, this is Riley. How can I help you and your pet today?"]);
    expect(startConversation(ctx({ channel: "sms" }), sam).replies[0]).not.toContain("recorded");
  });

  it("verifies a known caller with a pet's name before anything else, never reading the list", async () => {
    const { port } = fakePort();
    const r = await talk(ctx(), port, household, ["I'd like to book a nail trim"]);
    expect(r.last).toBe("Is this Ana? And which of your pets is this about?");
    const r2 = await talk(ctx(), port, household, ["I'd like to book a nail trim", "yes, it's for Lily", "first"]);
    expect(r2.all[1]).toMatch(/nail trim for Lily/);
  });

  it("treats a named pet on file as the identity check (caller ID plus pet name)", async () => {
    const { port } = fakePort();
    const r = await talk(ctx(), port, sam, ["Can I book Max in for his annual checkup?"]);
    expect(r.last).toMatch(/I have tomorrow at 9 AM or tomorrow at 2 PM/);
  });
});

describe("call 1: new client, new dog", () => {
  it("collects client and patient details, books a first exam, reads back and confirms by text", async () => {
    const { port, log } = fakePort();
    const r = await talk(ctx({ callerNumber: "+15555559999" }), port, null, [
      "Hi, I just moved here and I need to get my dog in for a checkup. His name is Rufus, he's a four year old lab mix, neutered. I'm Dana Price, 555-010-0001.",
      "no thanks",
      "yes that's fine",
      "Yes, Lakeside Animal Hospital",
      "the first one",
    ]);
    expect(r.all[0]).toBe("And an email for the confirmation?");
    expect(r.all[1]).toMatch(/I'll text you instead.*Is it okay if we text you/);
    expect(r.all[2]).toMatch(/Has Rufus been seen at another clinic/);
    expect(log.created[0]).toMatchObject({
      firstName: "Dana",
      lastName: "Price",
      mobile: "+15550100001",
      smsConsent: true,
      pet: { name: "Rufus", species: "dog", ageMonths: 48, sex: "male", neutered: true, breed: "Lab mix" },
    });
    expect(log.tasks.map((t) => t.type)).toContain("records_transfer");
    expect(log.booked[0]!.packServiceId).toBe("wellness_exam_new");
    expect(r.last).toMatch(/So that's Rufus for a first wellness exam on Wednesday, November 18 at 9 AM with Dr\. Patel\. Please bring/);
    expect(log.texts.find((t) => t.templateKey === "appointment_confirmation")!.body).toContain("Rufus is booked for a first wellness exam");
  });

  it("does not send a confirmation text without consent", async () => {
    const { port, log } = fakePort();
    await talk(ctx(), port, null, ["I need a checkup for my cat", "Jo Lee", "yes", "no", "no thank you", "Mittens", "domestic shorthair", "2 years", "girl", "yes", "no", "first"]);
    expect(log.booked).toHaveLength(1);
    expect(log.created[0]!.pet.flags).toContain("cat_carrier_required");
    expect(log.texts.filter((t) => t.templateKey === "appointment_confirmation")).toHaveLength(0);
  });
});

describe("calls 2 and 3: moving and cancelling (W2)", () => {
  const visit = (hoursAhead: number): UpcomingVisit => ({ appointmentId: "appt-x", patientId: "pet-max", packServiceId: "wellness_exam", start: NOW + hoursAhead * 3_600_000 });

  it("moves a visit to a new time, same service and pet", async () => {
    const { port, log } = fakePort({ upcoming: [visit(48)] });
    const r = await talk(ctx(), port, sam, ["I need to move my appointment, something came up.", "Max", "the second one"]);
    expect(r.all[0]).toBe("Is this Sam? And which of your pets is this about?");
    expect(r.all[1]).toMatch(/I see Max's wellness exam on Thursday/);
    expect(log.searches[0]).toMatchObject({ packServiceId: "wellness_exam", excludeAppointmentId: "appt-x" });
    expect(log.rescheduled[0]!.appointmentId).toBe("appt-x");
    expect(summarizeConversation(r.state)).toBe("Visit moved");
  });

  it("states the policy on a late cancel, records it and offers to rebook", async () => {
    const { port, log } = fakePort({ upcoming: [visit(18)] });
    const r = await talk(ctx(), port, sam, ["I have to cancel tomorrow morning's visit.", "it's for Max", "no thanks"]);
    expect(r.all[1]).toMatch(/24 hours' notice.*\$35 fee/);
    expect(log.cancelled[0]).toMatchObject({ appointmentId: "appt-x", lateCancel: true });
    expect(log.cancelled[0]!.reason).toContain("cancel tomorrow");
    expect(log.tasks.map((t) => t.type)).toContain("late_cancel_fee");
    expect(r.all[1]).toMatch(/Would you like to rebook Max/);
  });

  it("cancels outside the window with no late flag", async () => {
    const { port, log } = fakePort({ upcoming: [visit(72)] });
    await talk(ctx(), port, sam, ["Please cancel Max's appointment", "no"]);
    expect(log.cancelled[0]!.lateCancel).toBe(false);
    expect(log.tasks.map((t) => t.type)).not.toContain("late_cancel_fee");
  });
});

describe("triage during the conversation (calls 4 to 7, W6)", () => {
  it("call 4: stops a nail trim and transfers on chocolate, no advice", async () => {
    const { port, log } = fakePort();
    const r = await talk(ctx(), port, null, ["I want to book a nail trim for my beagle. Actually, hold on, she just ate a whole bar of dark chocolate, is that bad?"]);
    expect(log.booked).toHaveLength(0);
    expect(log.triage[0]).toEqual({ triggerId: "toxin_ingestion", actionTaken: "transferred" });
    expect(r.state).toMatchObject({ phase: "ended", transferOutcome: "transferred" });
  });

  it("call 5: after hours, ER details and text, staff alert, no transfer, no downgrade", async () => {
    const { port, log } = fakePort();
    const c = ctx({ situation: { ...ctx().situation, open: false } });
    const r = await talk(c, port, null, ["My cat is in the litter box straining and crying and nothing is coming out.", "maybe I'll wait till morning"]);
    expect(r.state.triage.level).toBe("emergency");
    expect(log.triage[0]!.triggerId).toBe("urinary_blockage");
    expect(log.transfers).toHaveLength(0);
    expect(log.texts[0]!.body).toContain("Metro Animal ER");
    expect(log.tasks[0]).toMatchObject({ type: "emergency_alert", priority: "urgent" });
  });

  it("lets a new caller decline the follow-up booking after an ER referral (no downgrade)", async () => {
    const { port, log } = fakePort();
    const c = ctx({ situation: { ...ctx().situation, open: false } });
    const r = await talk(c, port, null, ["My cat is in the litter box straining and crying and nothing is coming out.", "maybe I'll wait till morning"]);
    expect(r.last).toMatch(/Please don't wait if things get worse: Metro Animal ER/);
    expect(r.state.triage.level).toBe("emergency");
    expect(log.created).toHaveLength(0);
  });

  it("call 6: uses the downplay script and transfers anyway, no Friday booking", async () => {
    const { port, log } = fakePort();
    const r = await talk(ctx(), port, null, [
      "My dog's stomach looks really swollen and he keeps trying to throw up but nothing comes out. He's a Great Dane. But he's still wagging his tail so I think he's fine, can I just book for Friday?",
    ]);
    expect(r.last).toBe(rules.scripts.caller_downplays);
    expect(log.triage[0]!.triggerId).toBe("bloat_gdv");
    expect(log.transfers).toHaveLength(1);
    expect(log.booked).toHaveLength(0);
  });

  it("call 7: urgent vomiting books a sick visit today or tomorrow with the ER warning", async () => {
    const { port, log } = fakePort();
    const r = await talk(ctx(), port, sam, ["Max has been throwing up all day and won't eat.", "first"]);
    expect(log.searches[0]).toMatchObject({ packServiceId: "sick_visit", withinDays: 2 });
    expect(log.triage[0]!.triggerId).toBe("repeated_vomiting");
    expect(log.booked[0]).toMatchObject({ packServiceId: "sick_visit", triageLevel: "urgent" });
    expect(r.last).toMatch(/If anything gets worse/);
  });

  it("texts cannot be transferred: asks the caller to phone and alerts staff", async () => {
    const { port, log } = fakePort();
    const r = await talk(ctx({ channel: "sms" }), port, sam, ["Max ate rat poison"]);
    expect(r.last).toContain("Please call us now on (555) 010-1000");
    expect(log.transfers).toHaveLength(0);
  });

  it("gives ER details and alerts staff when a live transfer does not connect", async () => {
    const { port, log } = fakePort();
    const { state } = await talk(ctx(), port, sam, ["Max ate rat poison"]);
    const r = await respondTransferFailed(state, ctx(), port);
    expect(r.replies.join(" ")).toMatch(/couldn't reach the team/);
    expect(r.state).toMatchObject({ phase: "ended", transferOutcome: "failed" });
    expect(log.tasks.at(-1)).toMatchObject({ type: "emergency_alert", priority: "urgent" });
  });

  it("offers a drop-off when no urgent slot is free, then asks for a callback", async () => {
    const none = fakePort({ slots: (id) => (id === "drop_off_visit" ? [{ start: at("2026-11-17", "11:00"), end: at("2026-11-17", "15:00"), providerId: "p1" }] : []) });
    expect((await talk(ctx(), none.port, sam, ["Max won't eat anything"])).last).toMatch(/drop-off/);
    const empty = fakePort({ slots: () => [] });
    expect((await talk(ctx(), empty.port, sam, ["Max won't eat anything"])).last).toMatch(/Metro Animal ER/);
    expect(empty.log.tasks[0]).toMatchObject({ type: "urgent_callback", priority: "urgent" });
  });
});

describe("services and prerequisites (calls 8 to 16)", () => {
  it("call 8: a booster without a recent exam falls back to a wellness exam with the script", async () => {
    const { port, log } = fakePort({ blocked: { vaccine_booster_tech: "Needs an exam in the last year." } });
    const r = await talk(ctx(), port, sam, ["I just need to get Max's rabies shot updated.", "first"]);
    expect(r.all[0]).toContain(services.vaccine_booster_tech!.fallbackScript!.replace("{{pet_name}}", "Max").slice(0, 30));
    expect(log.booked[0]!.packServiceId).toBe("wellness_exam");
  });

  it("call 9: bordetella books the technician booster", async () => {
    const { port, log } = fakePort();
    await talk(ctx(), port, sam, ["Can I bring Max in for just his bordetella?", "first"]);
    expect(log.booked[0]!.packServiceId).toBe("vaccine_booster_tech");
  });

  it("call 10: a spay books the pre-op bloodwork and reads the fasting script verbatim", async () => {
    const { port, log } = fakePort();
    const r = await talk(ctx(), port, household, ["I'd like to get Chocolate spayed.", "first"]);
    expect(log.booked[0]).toMatchObject({ packServiceId: "spay_canine", preop: true });
    expect(r.last).toContain("pre-op bloodwork");
    expect(r.last).toContain(
      "Because this is a procedure under anaesthesia, Chocolate should have no food after midnight the night before. Water is fine. Drop-off is between 7 and 8:30 AM.",
    );
  });

  it("call 11: a spay for a male is clarified and booked as a neuter", async () => {
    const { port, log } = fakePort();
    const r = await talk(ctx(), port, sam, ["I want to book a spay for Max.", "first"]);
    expect(r.all[0]).toMatch(/A spay is for girls, and Max is a boy/);
    expect(log.booked[0]!.packServiceId).toBe("neuter_canine");
  });

  it("call 13: a lump is not urgent, gets the exam-first script and a sick visit", async () => {
    const { port, log } = fakePort();
    const r = await talk(ctx(), port, sam, ["Max has a lump on his side, I want it removed.", "first"]);
    expect(r.state.triage.level).toBe("routine");
    expect(r.all[0]).toMatch(/A lump should be looked at first/);
    expect(log.booked[0]!.packServiceId).toBe("sick_visit");
    expect(log.tasks).toHaveLength(0);
  });

  it("call 14: an x-ray request is explained first and never booked", async () => {
    const { port, log } = fakePort();
    const r = await talk(ctx(), port, null, ["I need an x-ray for my cat."]);
    expect(r.all[0]).toMatch(/X-rays are ordered by the doctor/);
    expect(log.booked).toHaveLength(0);
  });

  it("call 15: no medical advice, advice script, urgent sick visit for severe itching", async () => {
    const { port } = fakePort();
    const r = await talk(ctx(), port, sam, ["Can I give Max a Benadryl? He's itching like crazy."]);
    expect(r.last).toMatch(/I am not able to give medical advice, but I can get Max seen/);
    expect(r.last).not.toMatch(/mg|dose|probably/i);
    expect(r.state.triage.level).toBe("urgent");
  });

  it("call 16: a controlled refill uses the controlled script and a flagged task, no quantities", async () => {
    const { port, log } = fakePort();
    const r = await talk(ctx(), port, sam, ["I need a refill on Max's gabapentin."]);
    expect(refillRule.controlled_substance_keywords).toContain("gabapentin");
    expect(r.all[0]).toContain(services.rx_refill_request!.controlledScript!);
    expect(log.tasks[0]).toMatchObject({ type: "refill_request", controlled: true });
    expect(log.booked).toHaveLength(0);
  });

  it("a normal refill uses the refill script", async () => {
    const { port, log } = fakePort();
    const r = await talk(ctx(), port, sam, ["Max needs a refill of his NexGard"]);
    expect(r.all[0]).toContain("one business day");
    expect(log.tasks[0]).toMatchObject({ type: "refill_request", controlled: false });
  });
});

describe("deceased pets (call 17, pack v0.2)", () => {
  it("a pet already recorded as deceased: verbatim script, sympathy task and a suppression-failure alert", async () => {
    const { port, log } = fakePort();
    const r = await talk(ctx(), port, household, ["Why are you calling about Pumpkin? She died in July."]);
    expect(r.all[0]).toContain("Our records already show that Pumpkin has passed");
    expect(r.all[0]).toContain(SCRIPTS.deceased.replace("{{pet_name}}", "Pumpkin"));
    expect(log.tasks.map((t) => t.type)).toEqual(["sympathy", "suppression_failure"]);
    expect(log.deceased).toHaveLength(0);
  });

  it("marks a pet deceased only after the death, name and species are confirmed", async () => {
    const { port, log } = fakePort();
    const r = await talk(ctx(), port, sam, ["Max passed away last night", "yes"]);
    expect(r.all[0]).toMatch(/was that Max, your dog\?/);
    expect(log.deceased[0]).toMatchObject({ patientId: "pet-max", confirmedName: "Max", confirmedSpecies: "dog" });
    const unconfirmed = fakePort();
    await talk(ctx(), unconfirmed.port, sam, ["Max passed away last night", "no, I meant he's very sick"]);
    expect(unconfirmed.log.deceased).toHaveLength(0);
    expect(unconfirmed.log.tasks.map((t) => t.type)).toContain("deceased_unconfirmed");
  });

  it("an end-of-life request keeps the pet active and always creates a staff task", async () => {
    const { port, log } = fakePort();
    const r = await talk(ctx({ channel: "sms" }), port, sam, ["We need to put him down."]);
    expect(log.deceased).toHaveLength(0);
    expect(log.tasks[0]!.type).toBe("end_of_life");
    expect(r.state.outcomes).toContain("end_of_life_request");
  });
});

describe("households (calls 18 and 19)", () => {
  it("call 18: books two pets back to back with one confirmation, never the deceased pet", async () => {
    const { port, log } = fakePort();
    const r = await talk(ctx(), port, household, ["I got a text saying two of my pets are due. Can I book them together?", "Chocolate and Lily", "first"]);
    expect(r.all[1]).toMatch(/Chocolate and Lily back to back/);
    expect(log.groups[0]!.items.map((i) => i.patientId)).toEqual(["pet-a", "pet-b"]);
    expect(log.texts.filter((t) => t.templateKey === "appointment_confirmation")).toHaveLength(1);
    expect(JSON.stringify(r.all)).not.toContain("Pumpkin");
  });

  it("call 19: the confirmation for a carrier-flagged cat mentions the carrier", async () => {
    const { port, log } = fakePort();
    await talk(ctx(), port, household, ["Lily needs her annual.", "first"]);
    expect(log.booked[0]!.packServiceId).toBe("senior_wellness");
    expect(log.texts[0]!.body).toContain("Please bring Lily in a carrier");
  });
});

describe("chat booking: days and times the client asks for", () => {
  it("books a specific time the client names when it is free", async () => {
    const { port, log } = fakePort({ slots: () => [
      { start: at("2026-11-18", "09:00"), end: at("2026-11-18", "09:30"), providerId: "p1" },
      { start: at("2026-11-18", "14:00"), end: at("2026-11-18", "14:30"), providerId: "p1" },
      { start: at("2026-11-19", "10:30"), end: at("2026-11-19", "11:00"), providerId: "p1" },
    ] });
    const r = await talk(ctx({ channel: "sms" }), port, sam, ["book a nail trim for Max", "Thursday at 10:30 works", "yes please"]);
    expect(log.searches[1]!.after).toBe(at("2026-11-19", "10:30") - 1);
    expect(r.all[1]).toBe("I can do Thursday, Nov 19 at 10:30 AM for Max. Shall I book that?");
    expect(log.booked[0]!.slot.start).toBe(at("2026-11-19", "10:30"));
    // A time already on offer is simply taken.
    const again = fakePort();
    await talk(ctx(), again.port, sam, ["book a nail trim for Max", "2 pm works"]);
    expect(again.log.booked[0]!.slot.start).toBe(at("2026-11-18", "14:00"));
  });

  it("offers the closest times when the requested one is taken", async () => {
    const { port } = fakePort();
    const r = await talk(ctx(), port, sam, ["book a nail trim for Max", "how about Thursday at 11"]);
    expect(r.all[1]).toMatch(/^Thursday, Nov 19 at 11 AM isn't free\. The closest I have is/);
  });

  it("uses a day given up front and says goodbye for texts", async () => {
    const { port, log } = fakePort();
    const r = await talk(ctx({ channel: "sms" }), port, sam, ["Can Max come in Thursday afternoon for a nail trim?", "first", "no thanks"]);
    expect(log.searches[0]!.after).toBe(at("2026-11-19", "12:00") - 1);
    expect(r.last).toMatch(/^Thanks for texting Main Veterinary Clinic/);
  });
});

describe("chat booking never gets stuck", () => {
  it("accepts 'unknown' after one retry for optional answers, and books", async () => {
    const { port, log } = fakePort();
    await talk(ctx({ channel: "sms" }), port, null, ["checkup for my cat please", "Ana Diaz", "yes", "no", "yes", "Luna", "not sure", "tabby", "female", "yes", "maybe", "no", "no", "first"]);
    expect(log.created[0]!.pet).toMatchObject({ name: "Luna", sex: null, ageMonths: null });
    expect(log.booked).toHaveLength(1);
  });

  it("hands over to the team after one retry on a required answer, and lets the client leave", async () => {
    const a = fakePort();
    const r = await talk(ctx({ channel: "sms" }), a.port, null, ["checkup for my dog", "???", "!!!"]);
    expect(r.last).toMatch(/I've asked the team to call you back to finish the booking/);
    expect(a.log.tasks[0]!.type).toBe("callback");
    const b = fakePort();
    const r2 = await talk(ctx({ channel: "sms" }), b.port, null, ["checkup for my dog", "Ana Diaz", "bye"]);
    expect(r2.last).toMatch(/No problem/);
    expect(b.log.created).toHaveLength(0);
  });
});

describe("call 20 and other requests", () => {
  it("call 20: after hours, takes a message for a person and never transfers", async () => {
    const { port, log } = fakePort();
    const r = await talk(ctx({ situation: { ...ctx().situation, open: false } }), port, null, ["I just want to talk to a real person about my bill."]);
    expect(log.tasks[0]).toMatchObject({ type: "callback" });
    expect(log.tasks[0]!.details).toContain("about my bill");
    expect(log.transfers).toHaveLength(0);
    expect(r.all[0]).toMatch(/call you back when we open/);
  });

  it("offers the next times when neither works, and re-offers when a time was just taken", async () => {
    const a = fakePort();
    const r = await talk(ctx(), a.port, sam, ["book a nail trim for Max", "neither of those work"]);
    expect(a.log.searches[1]!.after).toBe(at("2026-11-18", "14:00"));
    expect(r.all[1]).toMatch(/Thursday, Nov 19 at 9 AM or Thursday, Nov 19 at 3 PM/);
    const b = fakePort({ conflictOnce: true });
    expect((await talk(ctx(), b.port, sam, ["book a nail trim for Max", "the first"])).all[1]).toMatch(/just taken/);
  });

  it("closes with the pack goodbye after a booking", async () => {
    const { port } = fakePort();
    const r = await talk(ctx(), port, sam, ["book a nail trim for Max", "first", "no thanks"]);
    expect(r.last).toBe("Thanks for calling Main Veterinary Clinic. We'll see Max on Wednesday, November 18.");
    expect(r.state.phase).toBe("ended");
  });

  it("state survives a JSON round trip", async () => {
    const { port } = fakePort();
    const { state } = await talk(ctx(), port, sam, ["book a nail trim for Max"]);
    const copy = JSON.parse(JSON.stringify(state)) as ConversationState;
    expect((await respond(copy, "first", ctx(), port)).replies.join(" ")).toMatch(/So that's Max/);
  });
});

describe("language helpers", () => {
  it("reads names and one-breath details", () => {
    expect(parseName("My name is jordan rivera")).toEqual(["Jordan", "Rivera"]);
    expect(extractFacts("His name is Rufus, he's a four year old lab mix, neutered. I'm Dana Price, 555-010-0001.")).toMatchObject({
      firstName: "Dana",
      lastName: "Price",
      phoneDigits: "5550100001",
      petName: "Rufus",
      ageMonths: 48,
      sex: "male",
      neutered: true,
      breed: "Lab mix",
    });
  });

  it("reads choices", () => {
    const offered = [{ start: at("2026-11-18", "09:00") }, { start: at("2026-11-18", "14:30") }];
    expect(pickOffered("the second one", offered, TZ)).toBe(1);
    expect(pickOffered("2:30 is good", offered, TZ)).toBe(1);
    expect(pickOffered("neither", offered, TZ)).toBe("none");
  });

  it("labels times and hours in clinic time", () => {
    expect(slotLabel(at("2026-11-17", "15:30"), TZ, NOW)).toBe("today at 3:30 PM");
    const rows = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opens: "07:00", closes: "18:00" }));
    expect(describeHours([...rows, { weekday: 6, opens: "08:00", closes: "12:30" }])).toBe("Monday to Friday, 7 AM to 6 PM; Saturday, 8 AM to 12:30 PM");
  });

  it("maps requests to services with the pack keywords", () => {
    const dog = { species: "dog" as const, sex: "male" as const, neutered: false, ageMonths: 40, isNew: false };
    expect(matchService("time for her spay", { ...dog, species: "cat", sex: "female" }, intake)?.serviceId).toBe("spay_feline");
    expect(matchService("a four year old lab, neutered, needs a checkup", dog, intake)?.serviceId).toBe("wellness_exam");
    expect(matchService("annual checkup", { ...dog, ageMonths: 100 }, intake)?.serviceId).toBe("senior_wellness");
    expect(matchService("annual checkup", { ...dog, species: "cat", ageMonths: 100 }, intake)?.serviceId).toBe("wellness_exam");
    expect(matchService("his ears smell, can you do an ear cleaning", dog, intake)?.serviceId).toBe("sick_visit");
    expect(matchService("I need a spay for him", dog, intake)).toMatchObject({ serviceId: "spay_canine", sexMismatch: true });
    expect(detectIntent("can I cancel tomorrow")).toBe("cancel");
  });
});
