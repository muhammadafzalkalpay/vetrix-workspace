// The AI front desk against a clinic database: loads the location's settings,
// recognises the caller, gives the conversation engine its "port" (slots,
// booking, new clients, tasks, texts, transfers, triage log) and saves every
// turn. Each caller turn runs in one transaction, so a turn is saved whole or
// not at all.
import {
  ageInMonths,
  checkEligibility,
  classifyByPhrases,
  ConflictError,
  dateRange,
  describeHours,
  findSlots,
  localParts,
  normalizePhone,
  NotFoundError,
  offerTwo,
  respond,
  respondTransferFailed,
  startConversation,
  summarizeConversation,
  validateClient,
  validatePatient,
  ValidationError,
  type CallerRecord,
  type ConversationState,
  type FrontDeskContext,
  type FrontDeskPort,
  type Hold,
  type IntakeRules,
  type NewPetInput,
  type PetRef,
  type SlotOffer,
  type ServiceInfo,
  type Species,
  type TriageAssessment,
  type TriageLevel,
} from "@vetrix/domain";
import { getVeterinaryPack } from "@vetrix/pack";
import { bookAppointment, cancelAppointment, loadPatientForBooking, loadSchedulingData, loadService, rescheduleAppointment } from "./booking";
import { createClient, createPatient, markPatientDeceased, withTransaction, type Actor, type TransactionPool } from "./clients";
import type { SqlClient } from "./sql-client";

const AI: Actor = { type: "ai", id: null };
const MAX_TEXT = 1000;
/** The AI never offers a time sooner than this. */
const LEAD_MS = 30 * 60_000;

// ---------- Setup ----------

interface Setup {
  ctx: Omit<FrontDeskContext, "callerNumber" | "channel">;
  serviceIds: Map<string, string>;
  today: string;
}

function packServices(): Record<string, ServiceInfo> {
  const out: Record<string, ServiceInfo> = {};
  for (const raw of getVeterinaryPack().services.services as unknown as Record<string, unknown>[]) {
    const id = raw.id as string;
    out[id] = {
      id,
      aiPhrase: (raw.ai_phrase as string | undefined) ?? null,
      bookableByAi: raw.bookable_by_ai === true,
      aiAction: (raw.ai_action as string | undefined) ?? null,
      aiScript: (raw.ai_script as string | undefined) ?? null,
      aiHandling: (raw.ai_handling as string | undefined) ?? null,
      fallbackServiceId: (raw.fallback_service_if_prerequisite_fails as string | undefined) ?? null,
      fallbackScript: (raw.fallback_script as string | undefined) ?? null,
      controlledScript: (raw.controlled_substance_script as string | undefined) ?? null,
      fastingRequired: raw.fasting_required === true,
      requiresPreop: raw.requires_preop_bloodwork === true,
      dropOffWindow: (raw.drop_off_window as string | undefined) ?? null,
      whatToBring: (raw.what_to_bring as string[] | undefined) ?? [],
    };
  }
  return out;
}

async function loadSetup(db: SqlClient, locationId: string, now: number): Promise<Setup> {
  const [loc, hours, services] = await Promise.all([
    db.query<{
      name: string; timezone: string; main_phone: string | null; ai_persona_name: string | null; emergency_transfer_number: string | null;
      er_name: string | null; er_phone: string | null; er_address: string | null; behaviour: "er_only" | "er_and_book_next" | null;
      refill_turnaround: string | null; cancellation_window_hours: number | null; cancellation_fee: string | null;
    }>(
      `SELECT l.name, l.timezone, l.main_phone, ps.ai_persona_name, ps.emergency_transfer_number,
              ah.er_name, ah.er_phone, ah.er_address, ah.behaviour, lp.refill_turnaround,
              lp.cancellation_window_hours, lp.cancellation_fee
       FROM locations l
       LEFT JOIN location_phone_settings ps ON ps.location_id = l.id
       LEFT JOIN location_after_hours ah ON ah.location_id = l.id
       LEFT JOIN location_policies lp ON lp.location_id = l.id
       WHERE l.id = $1`,
      [locationId],
    ),
    db.query<{ weekday: number; opens: string; closes: string }>(
      `SELECT weekday, to_char(opens_at, 'HH24:MI') AS opens, to_char(closes_at, 'HH24:MI') AS closes
       FROM location_hours WHERE location_id = $1 ORDER BY weekday, opens_at`,
      [locationId],
    ),
    db.query<{ id: string; pack_service_id: string }>(`SELECT id, pack_service_id FROM services WHERE location_id = $1 AND active`, [locationId]),
  ]);
  const l = loc.rows[0];
  if (!l) throw new NotFoundError("Location", locationId);
  const here = localParts(now, l.timezone);
  const holiday = await db.query(`SELECT 1 FROM location_holidays WHERE location_id = $1 AND holiday_date = $2`, [locationId, here.date]);
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const open =
    holiday.rows.length === 0 &&
    hours.rows.some((h) => h.weekday === here.weekday && toMin(h.opens) <= here.minutes && here.minutes < toMin(h.closes));
  return {
    today: here.date,
    serviceIds: new Map(services.rows.map((s) => [s.pack_service_id, s.id])),
    ctx: {
      clinicName: l.name,
      clinicPhone: l.main_phone,
      aiName: l.ai_persona_name ?? getVeterinaryPack().brand.ai_persona?.default_name ?? "Riley",
      timezone: l.timezone,
      now,
      rules: getVeterinaryPack().triage as unknown as FrontDeskContext["rules"],
      services: packServices(),
      situation: {
        open,
        transferNumber: l.emergency_transfer_number,
        afterHoursBehaviour: l.behaviour ?? "er_and_book_next",
        er: { name: l.er_name, phone: l.er_phone, address: l.er_address },
      },
      hoursText: describeHours(hours.rows),
      refillTurnaround: l.refill_turnaround ?? "a day or two",
      intake: (getVeterinaryPack().intake as unknown as { reason_for_visit: IntakeRules }).reason_for_visit,
      whatToBringPhrases: (getVeterinaryPack().intake as unknown as { what_to_bring_phrases: Record<string, string> }).what_to_bring_phrases ?? {},
      policy: {
        cancellationWindowHours: l.cancellation_window_hours ?? 24,
        cancellationFee: l.cancellation_fee === null ? null : Number(l.cancellation_fee),
      },
    },
  };
}

/** The client whose mobile matches, with their active pets. */
export async function findCaller(db: SqlClient, locationId: string, mobile: string, today: string): Promise<CallerRecord | null> {
  const client = await db.query<{ id: string; first_name: string; sms_consent: boolean }>(
    `SELECT id, first_name, sms_consent FROM clients WHERE location_id = $1 AND mobile = $2`,
    [locationId, mobile],
  );
  const c = client.rows[0];
  if (!c) return null;
  return { clientId: c.id, firstName: c.first_name, smsConsent: c.sms_consent, pets: await petsOf(db, locationId, c.id, today) };
}

async function petsOf(db: SqlClient, locationId: string, clientId: string, today: string): Promise<PetRef[]> {
  // Deceased pets are included so a caller can tell us; they are never offered for booking.
  const { rows } = await db.query<{
    id: string; name: string; species: Species; dob: string | null; approx_age_months: number | null;
    sex: "male" | "female" | null; neutered: boolean | null; status: "active" | "deceased"; flags: string[];
  }>(
    `SELECT p.id, p.name, p.species, to_char(p.date_of_birth, 'YYYY-MM-DD') AS dob, p.approx_age_months, p.sex, p.neutered, p.status,
            coalesce((SELECT array_agg(flag) FROM patient_temperament_flags WHERE patient_id = p.id), '{}') AS flags
     FROM patients p WHERE p.location_id = $1 AND p.client_id = $2 AND p.status IN ('active', 'deceased') ORDER BY p.name`,
    [locationId, clientId],
  );
  return rows.map((p) => ({
    id: p.id, name: p.name, species: p.species, sex: p.sex, neutered: p.neutered, status: p.status, flags: p.flags,
    ageMonths: ageInMonths({ dateOfBirth: p.dob, approxAgeMonths: p.approx_age_months }, today),
  }));
}

// ---------- The port ----------

/** How the caller's words are classified: the sandbox phrase rules, or a model merged with them. */
export type TriageClassifier = (text: string, petNames: string[]) => Promise<TriageAssessment>;

export interface FrontDeskOptions {
  classify?: TriageClassifier;
}

/** The sandbox AI's classifier: pack phrases and broad cues. */
export const sandboxClassifier: TriageClassifier = async (text, petNames) =>
  classifyByPhrases(getVeterinaryPack().triage as unknown as FrontDeskContext["rules"], text, { petNames });

/** A text the caller should receive now (live mode); sandbox texts are only recorded. */
export interface OutboundText {
  messageId: string | null;
  to: string;
  body: string;
}

interface PortNotes {
  /** Things that happened, shown in the transcript between turns. */
  notes: string[];
  outbound: OutboundText[];
  /** Live calls: the number to warm-transfer to after the reply. */
  transferTo: string | null;
}

const newNotes = (): PortNotes => ({ notes: [], outbound: [], transferTo: null });

function createPort(
  db: SqlClient,
  input: { locationId: string; callId: string; setup: Setup; sandbox: boolean; channel: "voice" | "sms"; classify?: TriageClassifier },
  out: PortNotes,
): FrontDeskPort {
  const { locationId, callId, setup, sandbox } = input;
  const label = sandbox ? "Sandbox: " : "";

  const serviceRow = (packServiceId: string) => setup.serviceIds.get(packServiceId) ?? null;

  const insertPet = async (clientId: string, p: NewPetInput): Promise<PetRef> => {
    const patient = validatePatient(
      { name: p.name, species: p.species, breed: p.breed, sex: p.sex, neutered: p.neutered, approxAgeMonths: p.ageMonths, temperamentFlags: p.flags },
      setup.today,
    );
    const id = await createPatient(db, { locationId, clientId, patient, actor: AI, provisional: true });
    return { id, name: patient.name, species: patient.species, ageMonths: p.ageMonths, sex: patient.sex, neutered: patient.neutered, flags: patient.temperamentFlags, isNew: true };
  };

  const bookOne = (patientId: string, serviceId: string, slot: SlotOffer, reason: string | null, triageLevel: TriageLevel) =>
    bookAppointment(db, {
      locationId,
      patientId,
      serviceId,
      start: slot.start,
      providerId: slot.providerId,
      bookedBy: "ai",
      actor: AI,
      reasonText: reason,
      triageLevel,
      today: setup.today,
      strict: true,
    });

  const providerName = async (providerId: string) =>
    (await db.query<{ name: string }>(`SELECT display_name AS name FROM providers WHERE id = $1 AND location_id = $2`, [providerId, locationId])).rows[0]?.name ?? "the doctor";

  /** resources.json preop_bloodwork_valid_days: completed pre-op bloodwork within that many days. */
  const preopStillValid = async (patientId: string) => {
    const days = (getVeterinaryPack().resources.scheduling_rules as { preop_bloodwork_valid_days?: number }).preop_bloodwork_valid_days ?? 30;
    const { rows } = await db.query(
      `SELECT 1 FROM appointments a JOIN services s ON s.id = a.service_id
       WHERE a.patient_id = $1 AND a.location_id = $2 AND s.pack_service_id = 'preop_bloodwork' AND a.status = 'completed'
         AND a.start_at > $3::timestamptz - make_interval(days => $4)`,
      [patientId, locationId, new Date(setup.ctx.now), days],
    );
    return rows.length > 0;
  };

  /** Books pre-op bloodwork as late as possible before the procedure (same morning or earlier, within a week). */
  const bookPreop = async (patientId: string, procedureStart: number, reason: string | null): Promise<number> => {
    const serviceId = serviceRow("preop_bloodwork");
    if (!serviceId) throw new ConflictError("Pre-op bloodwork is not set up at this clinic, so the team will book this procedure with you.");
    const from = localParts(Math.max(setup.ctx.now, procedureStart - 7 * 86_400_000), setup.ctx.timezone).date;
    const days = Math.max(1, Math.round((procedureStart - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 2);
    const [service, patient, data] = await Promise.all([
      loadService(db, locationId, serviceId),
      loadPatientForBooking(db, locationId, patientId),
      loadSchedulingData(db, locationId, from, days),
    ]);
    const options = findSlots(data, { service, patient, dates: dateRange(from, days), notBefore: setup.ctx.now + LEAD_MS, limit: 2000 }).filter((x) => x.end <= procedureStart);
    const last = options.at(-1);
    if (!last) throw new ConflictError("There's no time for the pre-op bloodwork before that date. Let me find a later one.");
    await bookOne(patientId, serviceId, { start: last.start, end: last.end, providerId: last.providerId }, reason ? `Pre-op bloodwork. ${reason}` : "Pre-op bloodwork", "routine");
    out.notes.push(`${label}Pre-op bloodwork booked before the procedure.`);
    return last.start;
  };

  return {
    async classify(text, petNames) {
      return (input.classify ?? sandboxClassifier)(text, petNames);
    },

    async findSlots(req) {
      const serviceId = serviceRow(req.packServiceId);
      if (!serviceId) return { slots: [], blocked: "We don't offer that at this clinic." };
      const [service, patient, data] = await Promise.all([
        loadService(db, locationId, serviceId),
        loadPatientForBooking(db, locationId, req.patientId),
        loadSchedulingData(db, locationId, setup.today, req.withinDays, { excludeAppointmentId: req.excludeAppointmentId }),
      ]);
      // The AI books only when nothing needs a staff decision (pack: strict for AI bookings).
      const eligibility = checkEligibility(service, patient, setup.today);
      const blocking = [...eligibility.blocking, ...eligibility.warnings];
      if (blocking.length > 0) return { slots: [], blocked: blocking[0]!.message };
      const notBefore = Math.max(setup.ctx.now + LEAD_MS, (req.after ?? 0) + 1);
      const all = findSlots(data, { service, patient, dates: dateRange(setup.today, req.withinDays), notBefore, limit: 400 });
      return { slots: offerTwo(all, setup.ctx.timezone).map((s) => ({ start: s.start, end: s.end, providerId: s.providerId })), blocked: null };
    },

    async findGroupSlots(req) {
      const ids = req.items.map((i) => serviceRow(i.packServiceId));
      if (ids.some((x) => !x)) return { groups: [], blocked: "We don't offer that at this clinic." };
      const [data, ...loaded] = await Promise.all([
        loadSchedulingData(db, locationId, setup.today, req.withinDays),
        ...req.items.map((it, i) => Promise.all([loadService(db, locationId, ids[i]!), loadPatientForBooking(db, locationId, it.patientId)])),
      ]);
      for (const [service, patient] of loaded) {
        const e = checkEligibility(service, patient, setup.today);
        const b = [...e.blocking, ...e.warnings][0];
        if (b) return { groups: [], blocked: `${patient.name}: ${b.message}` };
      }
      const notBefore = Math.max(setup.ctx.now + LEAD_MS, (req.after ?? 0) + 1);
      const dates = dateRange(setup.today, req.withinDays);
      const holdsOf = (sl: { providerId: string; roomId: string | null; equipmentIds: string[]; holdStart: number; holdEnd: number }): Hold[] => [
        { providerId: sl.providerId, start: sl.holdStart, end: sl.holdEnd },
        ...(sl.roomId ? [{ roomId: sl.roomId, start: sl.holdStart, end: sl.holdEnd }] : []),
        ...sl.equipmentIds.map((equipmentId) => ({ equipmentId, start: sl.holdStart, end: sl.holdEnd })),
      ];
      // Back to back: each next pet starts within 15 minutes of the previous one, same provider preferred.
      const groups: SlotOffer[][] = [];
      const firsts = findSlots(data, { service: loaded[0]![0], patient: loaded[0]![1], dates, notBefore, limit: 120 });
      for (const first of firsts) {
        let holds = [...data.holds, ...holdsOf(first)];
        const chain = [first];
        for (let i = 1; i < loaded.length; i++) {
          const prev = chain.at(-1)!;
          const day = localParts(prev.start, setup.ctx.timezone).date;
          const tryWith = (providerId?: string) =>
            findSlots({ ...data, holds }, { service: loaded[i]![0], patient: loaded[i]![1], dates: [day], notBefore: prev.end, providerId, limit: 5 }).find((x) => x.start - prev.end <= 15 * 60_000);
          const next = tryWith(prev.providerId) ?? tryWith();
          if (!next) break;
          chain.push(next);
          holds = [...holds, ...holdsOf(next)];
        }
        if (chain.length === loaded.length) groups.push(chain.map((c) => ({ start: c.start, end: c.end, providerId: c.providerId })));
        if (groups.length >= 12) break;
      }
      const picked = offerTwo(groups.map((g) => ({ ...g[0]!, holdStart: g[0]!.start, holdEnd: g[0]!.end, roomId: null, equipmentIds: [] })), setup.ctx.timezone);
      return { groups: picked.map((p) => groups.find((g) => g[0]!.start === p.start && g[0]!.providerId === p.providerId)!), blocked: null };
    },

    async book(req) {
      const serviceId = serviceRow(req.packServiceId);
      if (!serviceId) throw new ConflictError("That service is not offered here.");
      // A savepoint keeps the turn's transaction usable if the slot was just taken,
      // and makes the procedure and its pre-op bloodwork one step (both or neither).
      await db.query("SAVEPOINT ai_book");
      try {
        const result = await bookOne(req.patientId, serviceId, req.slot, req.reason, req.triageLevel);
        let preopStart: number | null = null;
        let preopValid = false;
        if (req.preop) {
          preopValid = await preopStillValid(req.patientId);
          if (preopValid) {
            await db.query(`UPDATE appointments SET preop_bloodwork_valid = true WHERE id = $1`, [result.appointmentId]);
          } else {
            preopStart = await bookPreop(req.patientId, req.slot.start, req.reason);
          }
        }
        await db.query("RELEASE SAVEPOINT ai_book");
        await db.query(`UPDATE calls SET appointment_id = $2 WHERE id = $1`, [callId, result.appointmentId]);
        return { appointmentId: result.appointmentId, providerName: await providerName(result.slot.providerId), preopStart, preopValid };
      } catch (error) {
        await db.query("ROLLBACK TO SAVEPOINT ai_book");
        throw error;
      }
    },

    async bookGroup(req) {
      await db.query("SAVEPOINT ai_book");
      try {
        const ids: string[] = [];
        const names: string[] = [];
        for (const it of req.items) {
          const serviceId = serviceRow(it.packServiceId);
          if (!serviceId) throw new ConflictError("That service is not offered here.");
          const r = await bookOne(it.patientId, serviceId, it.slot, req.reason, req.triageLevel);
          ids.push(r.appointmentId);
          names.push(await providerName(r.slot.providerId));
        }
        await db.query("RELEASE SAVEPOINT ai_book");
        await db.query(`UPDATE calls SET appointment_id = $2 WHERE id = $1`, [callId, ids[0]]);
        return { appointmentIds: ids, providerNames: names };
      } catch (error) {
        await db.query("ROLLBACK TO SAVEPOINT ai_book");
        throw error;
      }
    },

    async upcoming(req) {
      const { rows } = await db.query<{ id: string; patient_id: string; pack_service_id: string; start_at: Date }>(
        `SELECT a.id, a.patient_id, s.pack_service_id, a.start_at FROM appointments a JOIN services s ON s.id = a.service_id
         WHERE a.location_id = $1 AND a.client_id = $2 AND a.status IN ('requested', 'confirmed') AND a.start_at > $3
         ORDER BY a.start_at`,
        [locationId, req.clientId, new Date(setup.ctx.now)],
      );
      return rows.map((r) => ({ appointmentId: r.id, patientId: r.patient_id, packServiceId: r.pack_service_id, start: r.start_at.getTime() }));
    },

    async reschedule(req) {
      await db.query("SAVEPOINT ai_book");
      try {
        const r = await rescheduleAppointment(db, { locationId, appointmentId: req.appointmentId, start: req.slot.start, providerId: req.slot.providerId, actor: AI, today: setup.today });
        await db.query("RELEASE SAVEPOINT ai_book");
        await db.query(`UPDATE calls SET appointment_id = $2 WHERE id = $1`, [callId, r.appointmentId]);
        return { appointmentId: r.appointmentId, providerName: await providerName(r.slot.providerId) };
      } catch (error) {
        await db.query("ROLLBACK TO SAVEPOINT ai_book");
        throw error;
      }
    },

    async cancel(req) {
      await cancelAppointment(db, { locationId, appointmentId: req.appointmentId, reason: req.reason, actor: AI, lateCancel: req.lateCancel });
      out.notes.push(`${label}Visit cancelled${req.lateCancel ? " (late cancellation)" : ""}.`);
    },

    async markDeceased(req) {
      await markPatientDeceased(db, {
        locationId,
        patientId: req.patientId,
        confirmation: { confirmedName: req.confirmedName, confirmedSpecies: req.confirmedSpecies, deathConfirmed: true, deceasedDate: setup.today },
        today: setup.today,
        actor: AI,
      });
      out.notes.push(`${label}${req.confirmedName} marked deceased; reminders stopped.`);
    },

    async createCaller(req) {
      const client = validateClient({
        firstName: req.firstName,
        lastName: req.lastName,
        mobile: req.mobile,
        email: req.email,
        preferredChannel: "sms",
        smsConsent: req.smsConsent,
      });
      // Consent captured on this call: stored with its time and source (phone_ai).
      const clientId = await createClient(db, { locationId, client, source: "phone_ai", actor: AI });
      const pet = await insertPet(clientId, req.pet);
      out.notes.push(`${label}New client ${client.firstName} ${client.lastName} and pet ${pet.name} added (provisional). Texts ${client.smsConsent ? "allowed" : "not allowed"}.`);
      return { clientId, firstName: client.firstName, smsConsent: client.smsConsent, pets: [pet] };
    },

    async addPet(req) {
      const pet = await insertPet(req.clientId, req.pet);
      out.notes.push(`${label}New pet ${pet.name} added (provisional).`);
      return pet;
    },

    async createTask(t) {
      await db.query(
        `INSERT INTO staff_tasks (location_id, call_id, client_id, patient_id, type, priority, title, details, controlled_substance)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [locationId, callId, t.clientId, t.patientId, t.type, t.priority, t.title.slice(0, 200), t.details.slice(0, 2000), t.controlled ?? false],
      );
      out.notes.push(`${t.priority === "urgent" ? "Urgent staff task" : "Staff task"}: ${t.title}`);
    },

    async sendText(t) {
      // Sandbox texts are saved and labelled, never sent. Live texts are
      // queued here and sent by the caller of this turn after it is saved.
      let messageId: string | null = null;
      if (t.clientId) {
        const { rows } = await db.query<{ id: string }>(
          `INSERT INTO messages (location_id, client_id, channel, template_key, body, status, sent_at)
           VALUES ($1, $2, 'sms', $3, $4, $5, $6) RETURNING id`,
          [locationId, t.clientId, t.templateKey, t.body, sandbox ? "simulated" : "queued", sandbox ? new Date() : null],
        );
        messageId = rows[0]!.id;
      }
      if (!sandbox) out.outbound.push({ messageId, to: t.to, body: t.body });
      out.notes.push(`${label}Text to ${t.to}: ${t.body}`);
    },

    async transfer(t) {
      if (sandbox) {
        out.notes.push(`${label}Warm transfer to ${t.to}. Summary for staff: ${t.summary}`);
        return { ok: true };
      }
      if (input.channel !== "voice") return { ok: false };
      // Live call: the reply is spoken, then the call is dialled through.
      // If it does not connect, transferFailedFrontDesk() takes over.
      out.transferTo = t.to;
      out.notes.push(`Warm transfer to ${t.to}. Summary for staff: ${t.summary}`);
      return { ok: true };
    },

    async logTriage({ match, actionTaken }) {
      await db.query(
        `INSERT INTO triage_events (call_id, level, trigger_id, action_taken, evidence) VALUES ($1, $2, $3, $4, $5)`,
        [callId, match.level, match.triggerId, actionTaken, match.evidence],
      );
    },
  };
}

// ---------- Conversations ----------

export interface StartInput {
  locationId: string;
  channel: "voice" | "sms";
  callerNumber: string | null;
  sandbox: boolean;
  /** Twilio's CallSid for phone calls, so later webhooks find the conversation. */
  providerCallId?: string | null;
}

export interface TurnOutput {
  callId: string;
  replies: string[];
  notes: string[];
  ended: boolean;
  triageLevel: TriageLevel;
  /** Texts to send now (live mode only). */
  outbound: OutboundText[];
  /** Live calls: dial this number after speaking the replies. */
  transferTo: string | null;
}

async function addTurns(db: SqlClient, callId: string, turns: { speaker: "caller" | "ai" | "system"; body: string }[]) {
  if (turns.length === 0) return;
  const { rows } = await db.query<{ seq: number }>(`SELECT coalesce(max(seq), 0)::int AS seq FROM call_turns WHERE call_id = $1`, [callId]);
  const start = rows[0]!.seq + 1;
  await db.query(
    `INSERT INTO call_turns (call_id, seq, speaker, body)
     SELECT $1, u.seq, u.speaker, u.body FROM unnest($2::int[], $3::text[], $4::text[]) AS u(seq, speaker, body)`,
    [callId, turns.map((_, i) => start + i), turns.map((t) => t.speaker), turns.map((t) => t.body)],
  );
}

/** Opens a conversation and returns the greeting. */
export async function startFrontDesk(pool: TransactionPool, input: StartInput, now = Date.now()): Promise<TurnOutput> {
  const mobile = input.callerNumber?.trim() ? normalizePhone(input.callerNumber) : null;
  return withTransaction(pool, async (db) => {
    const setup = await loadSetup(db, input.locationId, now);
    const caller = mobile ? await findCaller(db, input.locationId, mobile, setup.today) : null;
    const ctx: FrontDeskContext = { ...setup.ctx, callerNumber: mobile, channel: input.channel };
    const { state, replies } = startConversation(ctx, caller);
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO calls (location_id, client_id, direction, caller_number, after_hours, started_at, channel, sandbox, state, summary, provider_call_id)
       VALUES ($1, $2, 'inbound', $3, $4, $5, $6, $7, $8, 'No action yet', $9) RETURNING id`,
      [input.locationId, caller?.clientId ?? null, mobile, !setup.ctx.situation.open, new Date(now), input.channel, input.sandbox, JSON.stringify(state), input.providerCallId ?? null],
    );
    const callId = rows[0]!.id;
    await addTurns(db, callId, replies.map((body) => ({ speaker: "ai" as const, body })));
    return { callId, replies, notes: [], ended: false, triageLevel: "routine", outbound: [], transferTo: null };
  });
}

/** Handles one thing the caller said. */
export async function continueFrontDesk(
  pool: TransactionPool,
  input: { locationId: string; callId: string; text: string },
  now = Date.now(),
  options: FrontDeskOptions = {},
): Promise<TurnOutput> {
  const text = input.text.trim();
  if (!text) throw new ValidationError("Type a message.", { field: "text" });
  if (text.length > MAX_TEXT) throw new ValidationError(`Keep messages under ${MAX_TEXT} characters.`, { field: "text" });
  return runTurn(pool, input, now, options, text, (state, ctx, port) => respond(state, text, ctx, port));
}

/** A live warm transfer did not connect: ER details, text and an urgent staff alert (pack W6). */
export async function transferFailedFrontDesk(
  pool: TransactionPool,
  input: { locationId: string; callId: string },
  now = Date.now(),
  options: FrontDeskOptions = {},
): Promise<TurnOutput> {
  return runTurn(pool, input, now, options, null, (state, ctx, port) => respondTransferFailed(state, ctx, port), "Transfer did not connect.");
}

async function runTurn(
  pool: TransactionPool,
  input: { locationId: string; callId: string },
  now: number,
  options: FrontDeskOptions,
  callerText: string | null,
  step: (state: ConversationState, ctx: FrontDeskContext, port: FrontDeskPort) => ReturnType<typeof respond>,
  systemNote?: string,
): Promise<TurnOutput> {
  return withTransaction(pool, async (db) => {
    const { rows } = await db.query<{ state: ConversationState; channel: "voice" | "sms"; caller_number: string | null; sandbox: boolean }>(
      `SELECT state, channel, caller_number, sandbox FROM calls WHERE id = $1 AND location_id = $2 FOR UPDATE`,
      [input.callId, input.locationId],
    );
    const call = rows[0];
    if (!call) throw new NotFoundError("Conversation", input.callId);
    const setup = await loadSetup(db, input.locationId, now);
    const ctx: FrontDeskContext = { ...setup.ctx, callerNumber: call.caller_number, channel: call.channel };
    const out = newNotes();
    const port = createPort(db, { locationId: input.locationId, callId: input.callId, setup, sandbox: call.sandbox, channel: call.channel, classify: options.classify }, out);
    const { state, replies } = await step(call.state, ctx, port);
    const ended = state.phase === "ended" && !out.transferTo;
    await addTurns(db, input.callId, [
      ...(systemNote ? [{ speaker: "system" as const, body: systemNote }] : []),
      ...(callerText ? [{ speaker: "caller" as const, body: callerText }] : []),
      ...replies.map((body) => ({ speaker: "ai" as const, body })),
      ...out.notes.map((body) => ({ speaker: "system" as const, body })),
    ]);
    await db.query(
      `UPDATE calls SET state = $3, triage_level = $4, client_id = coalesce($5, client_id), patient_id = coalesce($6, patient_id),
              transfer_outcome = $7, outcome = $8, summary = $9,
              ended_at = CASE WHEN $10 THEN coalesce(ended_at, $11) ELSE ended_at END,
              duration_sec = CASE WHEN $10 THEN greatest(0, extract(epoch FROM ($11::timestamptz - started_at)))::int ELSE duration_sec END
       WHERE id = $1 AND location_id = $2`,
      [input.callId, input.locationId, JSON.stringify(state), state.triage.level, state.caller.clientId, state.petId,
       state.transferOutcome, state.outcomes.join(",") || null, summarizeConversation(state), ended, new Date(now)],
    );
    return { callId: input.callId, replies, notes: out.notes, ended, triageLevel: state.triage.level, outbound: out.outbound, transferTo: out.transferTo };
  });
}

/** The client's text thread at this location that is still open and active recently. */
export async function findOpenTextThread(db: SqlClient, locationId: string, mobile: string, idleMinutes = 240): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT k.id FROM calls k
     WHERE k.location_id = $1 AND k.caller_number = $2 AND k.channel = 'sms' AND k.ended_at IS NULL
       AND coalesce((SELECT max(t.created_at) FROM call_turns t WHERE t.call_id = k.id), k.started_at) > now() - make_interval(mins => $3)
     ORDER BY k.started_at DESC LIMIT 1`,
    [locationId, mobile, idleMinutes],
  );
  return rows[0]?.id ?? null;
}

/** The conversation for a Twilio CallSid, if any. */
export async function findCallByProviderId(db: SqlClient, locationId: string, providerCallId: string): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(`SELECT id FROM calls WHERE location_id = $1 AND provider_call_id = $2`, [locationId, providerCallId]);
  return rows[0]?.id ?? null;
}

/** Records the outcome of sending a live text. */
export async function markMessageSent(db: SqlClient, input: { locationId: string; messageId: string; providerMessageId: string | null; ok: boolean }): Promise<void> {
  await db.query(
    `UPDATE messages SET status = $3, provider_message_id = $4, sent_at = CASE WHEN $3 = 'sent' THEN now() ELSE sent_at END
     WHERE id = $1 AND location_id = $2`,
    [input.messageId, input.locationId, input.ok ? "sent" : "failed", input.providerMessageId],
  );
}

/** Closes a conversation the caller has left (hang up, or the thread went quiet). */
export async function endFrontDesk(pool: TransactionPool, input: { locationId: string; callId: string }, now = Date.now()): Promise<void> {
  await withTransaction(pool, async (db) => {
    const { rows } = await db.query<{ state: ConversationState }>(
      `SELECT state FROM calls WHERE id = $1 AND location_id = $2 AND ended_at IS NULL FOR UPDATE`,
      [input.callId, input.locationId],
    );
    if (!rows[0]) return;
    const state = { ...rows[0].state, phase: "ended" as const };
    await db.query(
      `UPDATE calls SET state = $3, summary = $4, ended_at = $5, duration_sec = greatest(0, extract(epoch FROM ($5::timestamptz - started_at)))::int
       WHERE id = $1 AND location_id = $2`,
      [input.callId, input.locationId, JSON.stringify(state), summarizeConversation(state), new Date(now)],
    );
  });
}

// ---------- Reading ----------

export interface CallListItem {
  id: string;
  channel: "voice" | "sms";
  sandbox: boolean;
  caller_number: string | null;
  client_name: string | null;
  patient_name: string | null;
  triage_level: TriageLevel;
  summary: string | null;
  transfer_outcome: string;
  after_hours: boolean;
  started_at: Date;
  ended_at: Date | null;
}

export async function listCalls(
  db: SqlClient,
  locationId: string,
  opts: { level?: TriageLevel; limit?: number; offset?: number } = {},
): Promise<{ rows: CallListItem[]; total: number }> {
  const limit = Math.min(opts.limit ?? 25, 100);
  const params: unknown[] = [locationId, limit, opts.offset ?? 0];
  const filter = opts.level ? ` AND k.triage_level = $${params.push(opts.level)}` : "";
  const { rows } = await db.query<CallListItem & { total: string }>(
    `SELECT k.id, k.channel, k.sandbox, k.caller_number, k.triage_level, k.summary, k.transfer_outcome, k.after_hours, k.started_at, k.ended_at,
            nullif(trim(c.first_name || ' ' || c.last_name), '') AS client_name, p.name AS patient_name,
            count(*) OVER () AS total
     FROM calls k LEFT JOIN clients c ON c.id = k.client_id LEFT JOIN patients p ON p.id = k.patient_id
     WHERE k.location_id = $1${filter}
     ORDER BY k.started_at DESC LIMIT $2 OFFSET $3`,
    params,
  );
  return { rows: rows.map(({ total: _total, ...r }) => r), total: Number(rows[0]?.total ?? 0) };
}

export interface CallDetail extends CallListItem {
  client_id: string | null;
  patient_id: string | null;
  appointment_id: string | null;
  appointment_start: Date | null;
  duration_sec: number | null;
  turns: { seq: number; speaker: "caller" | "ai" | "system"; body: string; created_at: Date }[];
  triage: { level: string; trigger_id: string; action_taken: string; evidence: string | null; occurred_at: Date }[];
  tasks: { id: string; type: string; title: string | null; priority: string; status: string }[];
}

export async function getCall(db: SqlClient, locationId: string, callId: string): Promise<CallDetail> {
  const { rows } = await db.query<CallDetail>(
    `SELECT k.id, k.channel, k.sandbox, k.caller_number, k.triage_level, k.summary, k.transfer_outcome, k.after_hours, k.started_at, k.ended_at,
            k.client_id, k.patient_id, k.appointment_id, k.duration_sec, a.start_at AS appointment_start,
            nullif(trim(c.first_name || ' ' || c.last_name), '') AS client_name, p.name AS patient_name
     FROM calls k LEFT JOIN clients c ON c.id = k.client_id LEFT JOIN patients p ON p.id = k.patient_id
     LEFT JOIN appointments a ON a.id = k.appointment_id AND a.location_id = k.location_id
     WHERE k.id = $1 AND k.location_id = $2`,
    [callId, locationId],
  );
  const call = rows[0];
  if (!call) throw new NotFoundError("Conversation", callId);
  const [turns, triage, tasks] = await Promise.all([
    db.query<CallDetail["turns"][number]>(`SELECT seq, speaker, body, created_at FROM call_turns WHERE call_id = $1 ORDER BY seq`, [callId]),
    db.query<CallDetail["triage"][number]>(
      `SELECT level, trigger_id, action_taken, evidence, occurred_at FROM triage_events WHERE call_id = $1 ORDER BY occurred_at`,
      [callId],
    ),
    db.query<CallDetail["tasks"][number]>(
      `SELECT id, type, title, priority, status FROM staff_tasks WHERE call_id = $1 AND location_id = $2 ORDER BY created_at`,
      [callId, locationId],
    ),
  ]);
  return { ...call, turns: turns.rows, triage: triage.rows, tasks: tasks.rows };
}

/** The AI's name at this location (clinics may rename Riley). */
export async function aiPersonaName(db: SqlClient, locationId: string): Promise<string> {
  const { rows } = await db.query<{ name: string | null }>(`SELECT ai_persona_name AS name FROM location_phone_settings WHERE location_id = $1`, [locationId]);
  return rows[0]?.name ?? getVeterinaryPack().brand.ai_persona.default_name;
}

/**
 * STOP and START keywords (carrier rules). STOP blocks all texts to this
 * mobile at the location; START turns texting back on. Returns true when the
 * message was one of these keywords and needs no conversation.
 */
export async function applyTextKeyword(db: SqlClient, input: { locationId: string; mobile: string; body: string }): Promise<"stop" | "start" | null> {
  const word = input.body.trim().toLowerCase().replace(/[^a-z]/g, "");
  const stop = ["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "optout"].includes(word);
  const start = ["start", "unstop", "optin"].includes(word);
  if (!stop && !start) return null;
  await db.query(
    `UPDATE clients SET sms_consent = $3, sms_consent_at = now(), sms_consent_source = $4 WHERE location_id = $1 AND mobile = $2`,
    [input.locationId, input.mobile, start, stop ? "sms_stop" : "sms_start"],
  );
  return stop ? "stop" : "start";
}
