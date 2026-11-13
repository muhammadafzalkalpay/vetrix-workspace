// The reminder engine (pack retention.json). Pure: given the clinic's data
// and a date, it says which pets are due for what, which touch applies today,
// and what to send to whom, with every suppression rule applied.
//
// Day arithmetic follows the pack's test generator: 12 months = 365 days,
// 6 months = 183 days, age in years = days / 365.25.
import { fillScript } from "./triage";

export interface RetentionTouch {
  offset_days?: number;
  offset_hours?: number;
  channels: ("sms" | "email" | "ai_call")[];
  template: string;
}

export interface RetentionRule {
  id: string;
  name: string;
  species?: string[];
  books_service?: string | null;
  qualifies_if?: { min_age_years?: Record<string, number>; max_age_months?: number };
  touches: RetentionTouch[];
}

export interface RetentionPatient {
  id: string;
  clientId: string;
  name: string;
  species: string;
  dateOfBirth: string | null;
  approxAgeMonths: number | null;
  status: string;
  lastWellnessAt: string | null;
  lastSurgeryAt: string | null;
}

export interface RetentionClient {
  id: string;
  firstName: string;
  householdId: string | null;
  flags: string[];
  smsConsent: boolean;
  email: string | null;
}

export interface RetentionInput {
  asOf: string;
  rules: RetentionRule[];
  patients: RetentionPatient[];
  clients: RetentionClient[];
  vaccines: { patientId: string; vaccineName: string; dueAt: string }[];
  prevention: { patientId: string; productName: string; supplyEndAt: string }[];
  /** Missed visits (no-shows), clinic date. */
  noShows: { patientId: string; date: string }[];
  /** Open (requested or confirmed) visits from today on. */
  booked: { patientId: string; packServiceId: string; date: string }[];
}

export interface TouchPlan {
  index: number;
  offsetDays: number;
  channels: RetentionTouch["channels"];
  template: string;
}

export interface DueReminder {
  ruleId: string;
  ruleName: string;
  patientId: string;
  clientId: string;
  dueAt: string;
  /** Days from the run date to the due date (negative = overdue). */
  dueIn: number;
  /** Vaccine names or the prevention product. */
  detail: string | null;
  /** Touches whose window includes the run date. */
  active: TouchPlan[];
  suppressed: string | null;
}

const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

function touchOffsetDays(t: RetentionTouch): number {
  return t.offset_days ?? Math.floor((t.offset_hours ?? 0) / 24);
}

/**
 * A touch's window: before the due date (negative offset) from that many days
 * out until the due date; on or after it (zero or positive offset) from that
 * many days overdue onwards.
 */
export function touchIsActive(offsetDays: number, dueIn: number): boolean {
  return offsetDays < 0 ? dueIn >= 0 && dueIn <= -offsetDays : dueIn <= -offsetDays;
}

function ageYears(p: RetentionPatient, asOf: string): number | null {
  if (p.dateOfBirth) return days(asOf, p.dateOfBirth) / 365.25;
  return p.approxAgeMonths != null ? p.approxAgeMonths / 12 : null;
}

function joinNames(names: string[]): string {
  const u = [...new Set(names)];
  return u.length <= 1 ? (u[0] ?? "") : `${u.slice(0, -1).join(", ")} and ${u.at(-1)}`;
}

/** Every reminder that applies on the run date, with its active touches and any suppression. */
export function dueReminders(input: RetentionInput): DueReminder[] {
  const { asOf } = input;
  const rule = new Map(input.rules.map((r) => [r.id, r]));
  const clients = new Map(input.clients.map((c) => [c.id, c]));
  const active = input.patients.filter((p) => p.status === "active");
  const out: DueReminder[] = [];

  const add = (ruleId: string, p: RetentionPatient, dueAt: string, detail: string | null = null) => {
    const r = rule.get(ruleId);
    if (!r || (r.species && !r.species.includes(p.species))) return;
    const dueIn = days(dueAt, asOf);
    const touches = r.touches.map((t, index) => ({ index, offsetDays: touchOffsetDays(t), channels: t.channels, template: t.template }));
    out.push({
      ruleId,
      ruleName: r.name,
      patientId: p.id,
      clientId: p.clientId,
      dueAt,
      dueIn,
      detail,
      active: touches.filter((t) => touchIsActive(t.offsetDays, dueIn)),
      suppressed: null,
    });
  };

  for (const p of active) {
    // Senior pets get the six-monthly check instead of the annual one.
    const senior = rule.get("senior_recheck")?.qualifies_if?.min_age_years?.[p.species];
    const age = ageYears(p, asOf);
    const isSenior = senior !== undefined && age !== null && age >= senior;
    if (p.lastWellnessAt) add(isSenior ? "senior_recheck" : "annual_wellness", p, addDays(p.lastWellnessAt, isSenior ? 183 : 365));
    if (p.lastSurgeryAt) {
      const due = addDays(p.lastSurgeryAt, 12);
      const dueIn = days(due, asOf);
      if (dueIn >= -14 && dueIn <= 11) add("post_surgery_recheck", p, due);
    }
  }

  // Vaccines: one reminder for what is coming up, one for what is overdue, per pet.
  const byPet = new Map<string, { vaccineName: string; dueAt: string }[]>();
  for (const v of input.vaccines) (byPet.get(v.patientId) ?? byPet.set(v.patientId, []).get(v.patientId)!).push(v);
  const petById = new Map(active.map((p) => [p.id, p]));
  for (const [patientId, records] of byPet) {
    const p = petById.get(patientId);
    if (!p) continue;
    const upcoming = records.filter((r) => days(r.dueAt, asOf) >= 0).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    const overdue = records.filter((r) => days(r.dueAt, asOf) < 0).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    if (upcoming[0]) {
      const first = upcoming[0].dueAt;
      add("vaccine_due", p, first, joinNames(upcoming.filter((r) => days(r.dueAt, first) <= 30).map((r) => r.vaccineName)));
    }
    if (overdue[0]) add("vaccine_due", p, overdue[0].dueAt, joinNames(overdue.map((r) => r.vaccineName)));
  }

  for (const pr of input.prevention) {
    const p = petById.get(pr.patientId);
    if (p) add("parasite_prevention_refill", p, addDays(pr.supplyEndAt, -10), pr.productName);
  }

  // No-shows: open for two weeks unless the pet has been booked again.
  for (const ns of input.noShows) {
    const p = petById.get(ns.patientId);
    if (!p) continue;
    const age = days(asOf, ns.date);
    const rebooked = input.booked.some((b) => b.patientId === ns.patientId && b.date >= ns.date);
    if (age >= 0 && age <= 14 && !rebooked) add("no_show_recovery", p, ns.date);
  }

  // Suppression (retention.json suppress_if_any), re-checked on every run.
  for (const item of out) {
    const client = clients.get(item.clientId);
    const r = rule.get(item.ruleId)!;
    if (client?.flags.includes("do_not_contact")) item.suppressed = "Client is marked do not contact";
    else if (input.booked.some((b) => b.patientId === item.patientId && b.packServiceId === "euthanasia")) item.suppressed = "End-of-life visit booked";
    else if (
      r.books_service &&
      input.booked.some((b) => b.patientId === item.patientId && b.packServiceId === r.books_service && days(b.date, asOf) <= 45 && days(b.date, asOf) >= 0)
    ) {
      item.suppressed = "Already booked";
    }
  }
  return out;
}

/** Counts per rule and touch, as in docs/test-data/expected-reminders.md (suppressed excluded). */
export function reminderCounts(items: DueReminder[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const it of items) {
    if (it.suppressed) continue;
    for (const t of it.active) counts.set(`${it.ruleId}:${t.offsetDays}`, (counts.get(`${it.ruleId}:${t.offsetDays}`) ?? 0) + 1);
    counts.set(`${it.ruleId}:all`, (counts.get(`${it.ruleId}:all`) ?? 0) + 1);
  }
  return counts;
}

// ---------- What to send ----------

export interface SendValues {
  clinicName: string;
  aiName: string;
  clinicPhone: string;
  /** No online booking page yet: replying reaches the front desk. */
  bookingLink: string;
}

export interface PlannedTouch {
  ruleId: string;
  patientId: string;
  dueAt: string;
  touchIndex: number;
}

export interface SendPlan {
  clientId: string;
  channel: "sms" | "email" | "ai_call";
  templateKey: string;
  body: string;
  petNames: string[];
  touches: PlannedTouch[];
}

export interface PlanResult {
  plans: SendPlan[];
  /** Touches that apply today but cannot go out, with why. */
  skipped: { touch: PlannedTouch; reason: string }[];
  /** Earlier touches overtaken by a later one (never sent late). */
  superseded: PlannedTouch[];
}

const WHAT: Record<string, (detail: string | null) => string> = {
  annual_wellness: () => "a wellness exam",
  senior_recheck: () => "a senior wellness check",
  vaccine_due: (d) => d ?? "vaccines",
  heartworm_test: () => "a heartworm test",
  dental_recall: () => "a dental check",
};

/**
 * One message per touch, per channel the client can receive. Pets of the same
 * household due within the merge window get one message naming them all
 * (texts and emails only; calls stay per pet).
 */
export function planSends(input: {
  items: DueReminder[];
  patients: RetentionPatient[];
  clients: RetentionClient[];
  /** Keys of touches already sent: `${ruleId}|${patientId}|${dueAt}|${touchIndex}`. */
  sent: ReadonlySet<string>;
  templates: Record<string, string>;
  merge: { applies_to_rules: string[]; template_multi: string; windowDays: number };
  values: SendValues;
}): PlanResult {
  const pets = new Map(input.patients.map((p) => [p.id, p]));
  const clients = new Map(input.clients.map((c) => [c.id, c]));
  const key = (t: PlannedTouch) => `${t.ruleId}|${t.patientId}|${t.dueAt}|${t.touchIndex}`;
  const plans: SendPlan[] = [];
  const skipped: PlanResult["skipped"] = [];
  const superseded: PlannedTouch[] = [];
  type One = { item: DueReminder; touch: TouchPlan; channel: SendPlan["channel"] };
  const singles: One[] = [];

  for (const item of input.items) {
    if (item.suppressed || item.active.length === 0) continue;
    const pending = item.active.filter((t) => !input.sent.has(key({ ruleId: item.ruleId, patientId: item.patientId, dueAt: item.dueAt, touchIndex: t.index })));
    const latest = pending.sort((a, b) => b.index - a.index)[0];
    if (!latest) continue;
    // Never send a reminder late: older pending touches are overtaken by the latest one.
    for (const t of pending) if (t !== latest) superseded.push({ ruleId: item.ruleId, patientId: item.patientId, dueAt: item.dueAt, touchIndex: t.index });
    const client = clients.get(item.clientId);
    const planned = { ruleId: item.ruleId, patientId: item.patientId, dueAt: item.dueAt, touchIndex: latest.index };
    const allowed = latest.channels.filter((ch) =>
      ch === "sms" ? client?.smsConsent : ch === "email" ? Boolean(client?.email) : !client?.flags.includes("do_not_call"),
    );
    if (allowed.length === 0) {
      skipped.push({ touch: planned, reason: latest.channels.includes("sms") ? "No consent to text and no email on file" : "Cannot be contacted this way" });
      continue;
    }
    for (const channel of allowed) singles.push({ item, touch: latest, channel });
  }

  const fill = (template: string, one: One, petNames?: string[], what?: string) => {
    const pet = pets.get(one.item.patientId)!;
    const client = clients.get(one.item.clientId);
    return fillScript(template, {
      clinic_name: input.values.clinicName,
      ai_name: input.values.aiName,
      clinic_phone: input.values.clinicPhone,
      booking_link: input.values.bookingLink,
      client_first_name: client?.firstName ?? "",
      pet_name: pet.name,
      pet_names_joined: joinNames(petNames ?? [pet.name]),
      vaccine_names: one.item.detail ?? "vaccines",
      product_name: one.item.detail ?? "prevention",
      what: what ?? "",
      slot_1: "this week",
      slot_2: "next week",
    });
  };

  // Household merge: same client and channel, mergeable rules, due within the window.
  const used = new Set<One>();
  const mergeable = singles.filter((s) => s.channel !== "ai_call" && input.merge.applies_to_rules.includes(s.item.ruleId));
  const byClientChannel = new Map<string, One[]>();
  for (const s of mergeable) (byClientChannel.get(`${s.item.clientId}|${s.channel}`) ?? byClientChannel.set(`${s.item.clientId}|${s.channel}`, []).get(`${s.item.clientId}|${s.channel}`)!).push(s);
  for (const group of byClientChannel.values()) {
    group.sort((a, b) => a.item.dueAt.localeCompare(b.item.dueAt));
    const first = group[0]!;
    const inWindow = group.filter((g) => Math.abs(days(g.item.dueAt, first.item.dueAt)) <= input.merge.windowDays);
    const petIds = new Set(inWindow.map((g) => g.item.patientId));
    if (petIds.size < 2) continue;
    const names = [...petIds].map((id) => pets.get(id)!.name);
    const whats = joinNames(inWindow.map((g) => WHAT[g.item.ruleId]?.(g.item.detail) ?? "a visit"));
    const sentence = fillScript(input.merge.template_multi, { pet_names_joined: joinNames(names), what_joined: whats });
    plans.push({
      clientId: first.item.clientId,
      channel: first.channel,
      templateKey: "household_reminder",
      body: `${input.values.clinicName}: ${sentence}. Book: ${input.values.bookingLink}`,
      petNames: names,
      touches: inWindow.map((g) => ({ ruleId: g.item.ruleId, patientId: g.item.patientId, dueAt: g.item.dueAt, touchIndex: g.touch.index })),
    });
    for (const g of inWindow) used.add(g);
  }

  for (const s of singles) {
    if (used.has(s)) continue;
    const template = input.templates[s.touch.template];
    if (!template) {
      skipped.push({ touch: { ruleId: s.item.ruleId, patientId: s.item.patientId, dueAt: s.item.dueAt, touchIndex: s.touch.index }, reason: `No template "${s.touch.template}"` });
      continue;
    }
    plans.push({
      clientId: s.item.clientId,
      channel: s.channel,
      templateKey: s.touch.template,
      body: fill(template, s),
      petNames: [pets.get(s.item.patientId)!.name],
      touches: [{ ruleId: s.item.ruleId, patientId: s.item.patientId, dueAt: s.item.dueAt, touchIndex: s.touch.index }],
    });
  }
  return { plans, skipped, superseded };
}
