import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ConflictError } from "./errors";
import {
  respond,
  startConversation,
  summarizeConversation,
  type CallerRecord,
  type ConversationState,
  type FrontDeskContext,
  type FrontDeskPort,
  type ServiceInfo,
  type SlotOffer,
  type TaskRequest,
} from "./front-desk";
import { describeHours, detectIntent, matchService, parseName, pickOffered, slotLabel } from "./front-desk-language";
import { classifyByPhrases, type TriageRules } from "./triage";
import { zonedInstant } from "./time";

const pack = (file: string) => JSON.parse(readFileSync(new URL(`../../pack/veterinary/${file}`, import.meta.url), "utf8"));
const rules = pack("triage.json") as FrontDeskContext["rules"];
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
    },
  ]),
);

const TZ = "America/New_York";
// Monday 16 Nov 2026, 10:00 in clinic time.
const NOW = zonedInstant("2026-11-16", "10:00", TZ);
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
    ...over,
  };
}

/** A port that records everything and offers fixed times. */
function fakePort(opts: { slots?: (serviceId: string, withinDays: number) => SlotOffer[]; transferOk?: boolean; conflictOnce?: boolean; blocked?: Record<string, string> } = {}) {
  const log = {
    tasks: [] as TaskRequest[],
    texts: [] as { to: string; body: string }[],
    booked: [] as { packServiceId: string; slot: SlotOffer; triageLevel: string }[],
    triage: [] as { triggerId: string; actionTaken: string }[],
    transfers: [] as { to: string; summary: string }[],
    created: [] as unknown[],
    searches: [] as { packServiceId: string; withinDays: number; after?: number }[],
  };
  let conflict = opts.conflictOnce ?? false;
  const defaultSlots = (): SlotOffer[] => [
    { start: at("2026-11-17", "09:00"), end: at("2026-11-17", "09:30"), providerId: "p1" },
    { start: at("2026-11-17", "14:00"), end: at("2026-11-17", "14:30"), providerId: "p1" },
    { start: at("2026-11-18", "09:00"), end: at("2026-11-18", "09:30"), providerId: "p1" },
    { start: at("2026-11-18", "15:00"), end: at("2026-11-18", "15:30"), providerId: "p1" },
  ];
  const port: FrontDeskPort = {
    classify: async (text, petNames) => classifyByPhrases(rules as TriageRules, text, { petNames }),
    findSlots: async (req) => {
      log.searches.push(req);
      if (opts.blocked?.[req.packServiceId]) return { slots: [], blocked: opts.blocked[req.packServiceId]! };
      const all = (opts.slots ?? defaultSlots)(req.packServiceId, req.withinDays).filter((s) => req.after === undefined || s.start > req.after);
      return { slots: all.slice(0, 2), blocked: null };
    },
    book: async (req) => {
      if (conflict) {
        conflict = false;
        throw new ConflictError("Taken");
      }
      log.booked.push(req);
      return { appointmentId: `appt-${log.booked.length}` };
    },
    createCaller: async (req) => {
      log.created.push(req);
      return { clientId: "client-new", firstName: req.firstName, pets: [{ id: "pet-new", name: req.pet.name, species: req.pet.species, ageMonths: null }] };
    },
    addPet: async (req) => ({ id: "pet-added", name: req.name, species: req.species, ageMonths: null }),
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

const sam: CallerRecord = { clientId: "client-1", firstName: "Sam", pets: [{ id: "pet-max", name: "Max", species: "dog", ageMonths: 40 }] };
const household: CallerRecord = {
  clientId: "client-2",
  firstName: "Ana",
  pets: [
    { id: "pet-a", name: "Chocolate", species: "dog", ageMonths: 30 },
    { id: "pet-b", name: "Lily", species: "cat", ageMonths: 100 },
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
  return { state, replies, last: replies.at(-1)!.join(" ") };
}

describe("booking (W1)", () => {
  it("books a known caller's pet in two choices and says goodbye", async () => {
    const { port, log } = fakePort();
    const c = ctx();
    const { state, replies } = await talk(c, port, sam, ["Hi, can I book Max in for his annual checkup?", "the first one please", "no thanks"]);
    expect(replies[0]!.join(" ")).toMatch(/tomorrow at 9 AM or tomorrow at 2 PM/);
    expect(log.booked[0]).toMatchObject({ packServiceId: "wellness_exam", triageLevel: "routine" });
    expect(replies[1]!.join(" ")).toContain("You're all set: Max is booked for a wellness exam tomorrow at 9 AM");
    expect(state.phase).toBe("ended");
    expect(summarizeConversation(state)).toBe("Booked 1 visit");
  });

  it("creates a new caller and their pet, then books a first exam", async () => {
    const { port, log } = fakePort();
    const { state, replies } = await talk(ctx(), port, null, [
      "I'd like to book a checkup",
      "My name is Jordan Rivera",
      "Her name is Pepper",
      "she's a cat",
      "2 pm works",
    ]);
    expect(replies[0]!.join(" ")).toMatch(/first and last name/);
    expect(replies[1]!.join(" ")).toMatch(/pet's name/);
    expect(replies[2]!.join(" ")).toMatch(/Is Pepper a dog, a cat/);
    expect(log.created[0]).toMatchObject({ firstName: "Jordan", lastName: "Rivera", mobile: "+15555550123", pet: { name: "Pepper", species: "cat" } });
    expect(log.booked[0]!.packServiceId).toBe("wellness_exam_new");
    expect(log.booked[0]!.slot.start).toBe(at("2026-11-17", "14:00"));
    expect(log.tasks.map((t) => t.type)).toContain("records_request");
    expect(summarizeConversation(state)).toBe("Booked 1 visit, new client");
  });

  it("asks which pet in a household, and is not fooled by a pet called Chocolate", async () => {
    const { port, log } = fakePort();
    const { replies, state } = await talk(ctx(), port, household, ["I need to book a nail trim", "It's for Lily", "first"]);
    expect(replies[0]!.join(" ")).toBe("Is this for Chocolate or Lily?");
    expect(log.booked[0]!.packServiceId).toBe("nail_trim");
    expect(state.triage.level).toBe("routine");
    const r = await talk(ctx(), fakePort().port, household, ["Chocolate needs her vaccines"]);
    expect(r.state.triage.level).toBe("routine");
  });

  it("offers the next times when neither works", async () => {
    const { port, log } = fakePort();
    const { replies } = await talk(ctx(), port, sam, ["book a nail trim for Max", "neither of those work"]);
    expect(log.searches[1]!.after).toBe(at("2026-11-17", "14:00"));
    expect(replies[1]!.join(" ")).toMatch(/Wednesday, Nov 18 at 9 AM or Wednesday, Nov 18 at 3 PM/);
  });

  it("re-offers when the chosen time was just taken", async () => {
    const { port, log } = fakePort({ conflictOnce: true });
    const { replies } = await talk(ctx(), port, sam, ["book a nail trim", "the first"]);
    expect(replies[1]!.join(" ")).toMatch(/just taken/);
    expect(log.booked).toHaveLength(0);
  });

  it("books euthanasia with care", async () => {
    const { port } = fakePort();
    const { replies } = await talk(ctx(), port, sam, ["I think it's time to put Max to sleep"]);
    expect(replies[0]!.join(" ")).toMatch(/I'm so sorry/);
  });

  it("passes requests the AI may not book to staff", async () => {
    const { port, log } = fakePort();
    const { replies } = await talk(ctx(), port, sam, ["Max needs an ultrasound"]);
    expect(log.tasks[0]!.type).toBe("service_request");
    expect(replies[0]!.join(" ")).toMatch(/Ultrasounds are scheduled by the team/);
  });

  it("books an exam first for a lump", async () => {
    const { port, log } = fakePort();
    await talk(ctx(), port, sam, ["I want to book Max to have a lump removed", "the first"]);
    expect(log.booked[0]!.packServiceId).toBe("sick_visit");
  });

  it("falls back when a vaccine visit needs an exam first", async () => {
    const { port, log } = fakePort({ blocked: { vaccine_booster_tech: "Needs an exam in the last year." } });
    await talk(ctx(), port, sam, ["book Max for his booster", "first"]);
    expect(log.booked[0]!.packServiceId).toBe(services.vaccine_booster_tech!.fallbackServiceId);
  });

  it("takes refill requests as a staff task", async () => {
    const { port, log } = fakePort();
    const { replies } = await talk(ctx(), port, sam, ["Max needs a refill of his prescription"]);
    expect(log.tasks[0]!.type).toBe("refill_request");
    expect(replies[0]!.join(" ")).toContain("one business day");
  });
});

describe("triage during the conversation (W6)", () => {
  it("transfers an emergency in hours and ends", async () => {
    const { port, log } = fakePort();
    const { state, replies } = await talk(ctx(), port, sam, ["Max ate rat poison"]);
    expect(replies[0]!.join(" ")).toMatch(/connecting you to the team/);
    expect(log.transfers[0]!.summary).toContain("Emergency: Possible poisoning");
    expect(log.triage[0]).toEqual({ triggerId: "toxin_ingestion", actionTaken: "transferred" });
    expect(state).toMatchObject({ phase: "ended", transferOutcome: "transferred" });
  });

  it("asks a texting caller to phone now and alerts staff (texts cannot be transferred)", async () => {
    const { port, log } = fakePort();
    const { state, last } = await talk(ctx({ channel: "sms" }), port, sam, ["Max ate rat poison"]);
    expect(last).toContain("Please call us now on (555) 010-1000");
    expect(log.transfers).toHaveLength(0);
    expect(log.tasks[0]).toMatchObject({ type: "emergency_alert", priority: "urgent" });
    expect(summarizeConversation(state)).toBe("Emergency: Possible poisoning, staff asked to call now");
  });

  it("stops a booking in progress when an emergency comes up", async () => {
    const { port, log } = fakePort();
    const { state } = await talk(ctx(), port, sam, ["book a nail trim", "oh no he just collapsed"]);
    expect(state.phase).toBe("ended");
    expect(log.booked).toHaveLength(0);
  });

  it("gives ER details by voice and text after hours, alerts staff, and offers the next slot", async () => {
    const { port, log } = fakePort();
    const c = ctx({ situation: { ...ctx().situation, open: false } });
    const { state, replies } = await talk(c, port, sam, ["Max is having a seizure"]);
    const said = replies[0]!.join(" ");
    expect(said).toContain("Metro Animal ER at 900 Sample Avenue");
    expect(log.transfers).toHaveLength(0);
    expect(log.texts[0]!.body).toContain("Metro Animal ER");
    expect(log.tasks[0]).toMatchObject({ type: "emergency_alert", priority: "urgent" });
    expect(state.phase).toBe("offering");
    expect(state.transferOutcome).toBe("er_referred");
  });

  it("falls back to ER details when the transfer fails", async () => {
    const { port, log } = fakePort({ transferOk: false });
    const { state, replies } = await talk(ctx(), port, sam, ["she can't breathe"]);
    expect(replies[0]!.join(" ")).toMatch(/couldn't reach the team/);
    expect(log.tasks[0]!.title).toMatch(/transfer failed/);
    expect(state.transferOutcome).toBe("failed");
  });

  it("does not downgrade when the caller says it is not that bad", async () => {
    const { port } = fakePort();
    const c = ctx({ situation: { ...ctx().situation, open: false, afterHoursBehaviour: "er_only" } });
    const { state, replies } = await talk(c, port, sam, ["he was hit by a car", "it's not that bad, can I just book a checkup?"]);
    expect(state.triage.level).toBe("emergency");
    expect(replies[1]!.join(" ")).toMatch(/conversation has ended/);
  });

  it("books urgent cases as a sick visit today or tomorrow", async () => {
    const { port, log } = fakePort();
    const { replies, state } = await talk(ctx(), port, sam, ["Max keeps throwing up", "the second one"]);
    expect(log.searches[0]).toMatchObject({ packServiceId: "sick_visit", withinDays: 2 });
    expect(replies[0]!.join(" ")).toMatch(/Let's get Max seen today/);
    expect(log.booked[0]).toMatchObject({ packServiceId: "sick_visit", triageLevel: "urgent" });
    expect(replies[1]!.join(" ")).toMatch(/If anything gets worse/);
    expect(summarizeConversation(state)).toBe("Urgent: Repeated vomiting, booked 1 visit");
  });

  it("switches a routine booking to urgent mid-conversation", async () => {
    const { port, log } = fakePort();
    await talk(ctx(), port, sam, ["book a nail trim for Max", "actually he's been limping badly too", "first"]);
    expect(log.booked[0]).toMatchObject({ packServiceId: "sick_visit", triageLevel: "urgent" });
  });

  it("offers a drop-off when no urgent slot is free, then asks for a callback", async () => {
    const none = fakePort({ slots: (id) => (id === "drop_off_visit" ? [{ start: at("2026-11-16", "11:00"), end: at("2026-11-16", "15:00"), providerId: "p1" }] : []) });
    const r = await talk(ctx(), none.port, sam, ["he won't eat anything"]);
    expect(r.last).toMatch(/drop-off/);
    expect(r.state.offered).toHaveLength(1);

    const empty = fakePort({ slots: () => [] });
    const r2 = await talk(ctx(), empty.port, sam, ["he won't eat anything"]);
    expect(r2.last).toMatch(/Metro Animal ER/);
    expect(empty.log.tasks[0]).toMatchObject({ type: "urgent_callback", priority: "urgent" });
  });

  it("does not give medical advice", async () => {
    const { port } = fakePort();
    const { last } = await talk(ctx(), port, sam, ["What can I give Max for an upset tummy?"]);
    expect(last).toMatch(/not able to give medical advice/);
  });
});

describe("language helpers", () => {
  it("reads names", () => {
    expect(parseName("My name is jordan rivera")).toEqual(["Jordan", "Rivera"]);
    expect(parseName("it's Sam")).toEqual(["Sam"]);
    expect(parseName("Her name is Pepper, she's a cat")).toEqual(["Pepper"]);
  });

  it("reads choices", () => {
    const offered = [{ start: at("2026-11-17", "09:00") }, { start: at("2026-11-17", "14:30") }];
    expect(pickOffered("the second one", offered, TZ)).toBe(1);
    expect(pickOffered("first please", offered, TZ)).toBe(0);
    expect(pickOffered("2:30 is good", offered, TZ)).toBe(1);
    expect(pickOffered("9 am", offered, TZ)).toBe(0);
    expect(pickOffered("neither", offered, TZ)).toBe("none");
    expect(pickOffered("hmm", offered, TZ)).toBeNull();
  });

  it("labels times in clinic time", () => {
    expect(slotLabel(at("2026-11-16", "15:30"), TZ, NOW)).toBe("today at 3:30 PM");
    expect(slotLabel(at("2026-11-19", "12:00"), TZ, NOW)).toBe("Thursday, Nov 19 at 12 PM");
  });

  it("describes opening hours", () => {
    const rows = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opens: "07:00", closes: "18:00" }));
    expect(describeHours([...rows, { weekday: 6, opens: "08:00", closes: "12:30" }])).toBe("Monday to Friday, 7 AM to 6 PM; Saturday, 8 AM to 12:30 PM");
  });

  it("maps requests to services by pet", () => {
    expect(matchService("time for her spay", { species: "cat", ageMonths: 8, isNew: false })).toBe("spay_feline");
    expect(matchService("annual checkup", { species: "dog", ageMonths: 100, isNew: false })).toBe("senior_wellness");
    expect(matchService("new puppy shots", { species: "dog", ageMonths: 3, isNew: true })).toBe("puppy_kitten_visit");
    expect(detectIntent("can I cancel tomorrow")).toBe("cancel");
  });
});

// Keeps the state type exercised so a refactor that breaks JSON storage is caught.
it("state survives a JSON round trip", async () => {
  const { port } = fakePort();
  const { state } = await talk(ctx(), port, sam, ["book a nail trim"]);
  const copy = JSON.parse(JSON.stringify(state)) as ConversationState;
  const r = await respond(copy, "first", ctx(), port);
  expect(r.replies.join(" ")).toMatch(/You're all set/);
});
