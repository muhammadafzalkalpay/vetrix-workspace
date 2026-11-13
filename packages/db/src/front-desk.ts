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
  startConversation,
  summarizeConversation,
  validateClient,
  validatePatient,
  ValidationError,
  type CallerRecord,
  type ConversationState,
  type FrontDeskContext,
  type FrontDeskPort,
  type PetRef,
  type ServiceInfo,
  type Species,
  type TriageLevel,
} from "@vetrix/domain";
import { getVeterinaryPack } from "@vetrix/pack";
import { bookAppointment, loadPatientForBooking, loadSchedulingData, loadService } from "./booking";
import { createClient, createPatient, withTransaction, type Actor, type TransactionPool } from "./clients";
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
    };
  }
  return out;
}

async function loadSetup(db: SqlClient, locationId: string, now: number): Promise<Setup> {
  const [loc, hours, services] = await Promise.all([
    db.query<{
      name: string; timezone: string; main_phone: string | null; ai_persona_name: string | null; emergency_transfer_number: string | null;
      er_name: string | null; er_phone: string | null; er_address: string | null; behaviour: "er_only" | "er_and_book_next" | null;
      refill_turnaround: string | null;
    }>(
      `SELECT l.name, l.timezone, l.main_phone, ps.ai_persona_name, ps.emergency_transfer_number,
              ah.er_name, ah.er_phone, ah.er_address, ah.behaviour, lp.refill_turnaround
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
    },
  };
}

/** The client whose mobile matches, with their active pets. */
export async function findCaller(db: SqlClient, locationId: string, mobile: string, today: string): Promise<CallerRecord | null> {
  const client = await db.query<{ id: string; first_name: string }>(
    `SELECT id, first_name FROM clients WHERE location_id = $1 AND mobile = $2`,
    [locationId, mobile],
  );
  const c = client.rows[0];
  if (!c) return null;
  return { clientId: c.id, firstName: c.first_name, pets: await petsOf(db, locationId, c.id, today) };
}

async function petsOf(db: SqlClient, locationId: string, clientId: string, today: string): Promise<PetRef[]> {
  const { rows } = await db.query<{ id: string; name: string; species: Species; dob: string | null; approx_age_months: number | null }>(
    `SELECT id, name, species, to_char(date_of_birth, 'YYYY-MM-DD') AS dob, approx_age_months
     FROM patients WHERE location_id = $1 AND client_id = $2 AND status = 'active' ORDER BY name`,
    [locationId, clientId],
  );
  return rows.map((p) => ({ id: p.id, name: p.name, species: p.species, ageMonths: ageInMonths({ dateOfBirth: p.dob, approxAgeMonths: p.approx_age_months }, today) }));
}

// ---------- The port ----------

interface PortNotes {
  /** Things that happened, shown in the transcript between turns. */
  notes: string[];
}

function createPort(db: SqlClient, input: { locationId: string; callId: string; setup: Setup; sandbox: boolean }, out: PortNotes): FrontDeskPort {
  const { locationId, callId, setup, sandbox } = input;
  const label = sandbox ? "Sandbox: " : "";
  const pack = getVeterinaryPack();

  const serviceRow = (packServiceId: string) => setup.serviceIds.get(packServiceId) ?? null;

  return {
    async classify(text, petNames) {
      return classifyByPhrases(pack.triage as unknown as FrontDeskContext["rules"], text, { petNames });
    },

    async findSlots(req) {
      const serviceId = serviceRow(req.packServiceId);
      if (!serviceId) return { slots: [], blocked: "We don't offer that at this clinic." };
      const [service, patient, data] = await Promise.all([
        loadService(db, locationId, serviceId),
        loadPatientForBooking(db, locationId, req.patientId),
        loadSchedulingData(db, locationId, setup.today, req.withinDays),
      ]);
      // The AI books only when nothing needs a staff decision (pack: strict for AI bookings).
      const eligibility = checkEligibility(service, patient, setup.today);
      const blocking = [...eligibility.blocking, ...eligibility.warnings];
      if (blocking.length > 0) return { slots: [], blocked: blocking[0]!.message };
      const notBefore = Math.max(setup.ctx.now + LEAD_MS, (req.after ?? 0) + 1);
      const all = findSlots(data, { service, patient, dates: dateRange(setup.today, req.withinDays), notBefore, limit: 400 });
      return { slots: offerTwo(all, setup.ctx.timezone).map((s) => ({ start: s.start, end: s.end, providerId: s.providerId })), blocked: null };
    },

    async book(req) {
      const serviceId = serviceRow(req.packServiceId);
      if (!serviceId) throw new ConflictError("That service is not offered here.");
      // A savepoint keeps the turn's transaction usable if the slot was just taken.
      await db.query("SAVEPOINT ai_book");
      try {
        const result = await bookAppointment(db, {
          locationId,
          patientId: req.patientId,
          serviceId,
          start: req.slot.start,
          providerId: req.slot.providerId,
          bookedBy: "ai",
          actor: AI,
          reasonText: req.reason,
          triageLevel: req.triageLevel,
          today: setup.today,
          strict: true,
        });
        await db.query("RELEASE SAVEPOINT ai_book");
        await db.query(`UPDATE calls SET appointment_id = $2 WHERE id = $1`, [callId, result.appointmentId]);
        return { appointmentId: result.appointmentId };
      } catch (error) {
        await db.query("ROLLBACK TO SAVEPOINT ai_book");
        throw error;
      }
    },

    async createCaller(req) {
      const client = validateClient({ firstName: req.firstName, lastName: req.lastName, mobile: req.mobile, preferredChannel: "sms" });
      const clientId = await createClient(db, { locationId, client, source: "phone_ai", actor: AI });
      const patient = validatePatient({ name: req.pet.name, species: req.pet.species }, setup.today);
      const petId = await createPatient(db, { locationId, clientId, patient, actor: AI, provisional: true });
      out.notes.push(`${label}New client ${client.firstName} ${client.lastName} and pet ${patient.name} added (provisional).`);
      return { clientId, firstName: client.firstName, pets: [{ id: petId, name: patient.name, species: patient.species, ageMonths: null }] };
    },

    async addPet(req) {
      const patient = validatePatient({ name: req.name, species: req.species }, setup.today);
      const id = await createPatient(db, { locationId, clientId: req.clientId, patient, actor: AI, provisional: true });
      out.notes.push(`${label}New pet ${patient.name} added (provisional).`);
      return { id, name: patient.name, species: patient.species, ageMonths: null };
    },

    async createTask(t) {
      await db.query(
        `INSERT INTO staff_tasks (location_id, call_id, client_id, patient_id, type, priority, title, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [locationId, callId, t.clientId, t.patientId, t.type, t.priority, t.title.slice(0, 200), t.details.slice(0, 2000)],
      );
      out.notes.push(`${t.priority === "urgent" ? "Urgent staff task" : "Staff task"}: ${t.title}`);
    },

    async sendText(t) {
      // Sandbox texts are saved and labelled, never sent. Live texts queue for the dispatcher.
      if (t.clientId) {
        await db.query(
          `INSERT INTO messages (location_id, client_id, channel, template_key, body, status, sent_at)
           VALUES ($1, $2, 'sms', $3, $4, $5, $6)`,
          [locationId, t.clientId, t.templateKey, t.body, sandbox ? "simulated" : "queued", sandbox ? new Date() : null],
        );
      }
      out.notes.push(`${label}Text to ${t.to}: ${t.body}`);
    },

    async transfer(t) {
      if (!sandbox) {
        // Live transfers run in the voice service; the web app cannot bridge a call.
        out.notes.push(`Transfer to ${t.to} not available here.`);
        return { ok: false };
      }
      out.notes.push(`${label}Warm transfer to ${t.to}. Summary for staff: ${t.summary}`);
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
}

export interface TurnOutput {
  callId: string;
  replies: string[];
  notes: string[];
  ended: boolean;
  triageLevel: TriageLevel;
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
      `INSERT INTO calls (location_id, client_id, direction, caller_number, after_hours, started_at, channel, sandbox, state, summary)
       VALUES ($1, $2, 'inbound', $3, $4, $5, $6, $7, $8, 'No action yet') RETURNING id`,
      [input.locationId, caller?.clientId ?? null, mobile, !setup.ctx.situation.open, new Date(now), input.channel, input.sandbox, JSON.stringify(state)],
    );
    const callId = rows[0]!.id;
    await addTurns(db, callId, replies.map((body) => ({ speaker: "ai" as const, body })));
    return { callId, replies, notes: [], ended: false, triageLevel: "routine" };
  });
}

/** Handles one thing the caller said. */
export async function continueFrontDesk(
  pool: TransactionPool,
  input: { locationId: string; callId: string; text: string },
  now = Date.now(),
): Promise<TurnOutput> {
  const text = input.text.trim();
  if (!text) throw new ValidationError("Type a message.", { field: "text" });
  if (text.length > MAX_TEXT) throw new ValidationError(`Keep messages under ${MAX_TEXT} characters.`, { field: "text" });
  return withTransaction(pool, async (db) => {
    const { rows } = await db.query<{ state: ConversationState; channel: "voice" | "sms"; caller_number: string | null; sandbox: boolean; ended_at: Date | null; started_at: Date }>(
      `SELECT state, channel, caller_number, sandbox, ended_at, started_at FROM calls WHERE id = $1 AND location_id = $2 FOR UPDATE`,
      [input.callId, input.locationId],
    );
    const call = rows[0];
    if (!call) throw new NotFoundError("Conversation", input.callId);
    const setup = await loadSetup(db, input.locationId, now);
    const ctx: FrontDeskContext = { ...setup.ctx, callerNumber: call.caller_number, channel: call.channel };
    const out: PortNotes = { notes: [] };
    const port = createPort(db, { locationId: input.locationId, callId: input.callId, setup, sandbox: call.sandbox }, out);
    const { state, replies } = await respond(call.state, text, ctx, port);
    const ended = state.phase === "ended";
    await addTurns(db, input.callId, [
      { speaker: "caller", body: text },
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
    return { callId: input.callId, replies, notes: out.notes, ended, triageLevel: state.triage.level };
  });
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
