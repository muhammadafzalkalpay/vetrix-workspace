// The waitlist (pack workflow W7) against a clinic database.
import { randomBytes } from "node:crypto";
import {
  checkEligibility,
  ConflictError,
  fillScript,
  findSlots,
  firstWave,
  localParts,
  matchingEntries,
  NotFoundError,
  RuleViolationError,
  secondWave,
  ValidationError,
  WAITLIST,
  WAITLIST_TEXT,
  worthOffering,
  type WaitlistEntryInput,
} from "@vetrix/domain";
import { getVeterinaryPack } from "@vetrix/pack";
import { bookAppointment, loadPatientForBooking, loadSchedulingData, loadService } from "./booking";
import { writeAudit, type Actor } from "./clients";
import type { SqlClient } from "./sql-client";

const SYSTEM: Actor = { type: "system", id: null };

// ---------- Managing the list ----------

export async function addToWaitlist(
  db: SqlClient,
  input: { locationId: string; patientId: string; serviceId: string; preferredProviderId: string | null; actor: Actor },
): Promise<string> {
  const pet = await db.query<{ status: string }>(`SELECT status FROM patients WHERE id = $1 AND location_id = $2`, [input.patientId, input.locationId]);
  if (!pet.rows[0]) throw new NotFoundError("Patient", input.patientId);
  if (pet.rows[0].status !== "active") throw new RuleViolationError("waitlist.inactive", "Only active pets can go on the waitlist.");
  const service = await db.query(`SELECT 1 FROM services WHERE id = $1 AND location_id = $2 AND active`, [input.serviceId, input.locationId]);
  if (!service.rows[0]) throw new ValidationError("Choose a service.", { field: "serviceId" });
  if (input.preferredProviderId) {
    const p = await db.query(`SELECT 1 FROM providers WHERE id = $1 AND location_id = $2`, [input.preferredProviderId, input.locationId]);
    if (!p.rows[0]) throw new ValidationError("Choose a provider.", { field: "providerId" });
  }
  const dup = await db.query(
    `SELECT 1 FROM waitlist_entries WHERE location_id = $1 AND patient_id = $2 AND service_id = $3 AND status IN ('waiting', 'offered')`,
    [input.locationId, input.patientId, input.serviceId],
  );
  if (dup.rows[0]) throw new RuleViolationError("waitlist.duplicate", "This pet is already waiting for that service.");
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO waitlist_entries (location_id, patient_id, service_id, preferred_provider_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [input.locationId, input.patientId, input.serviceId, input.preferredProviderId],
  );
  await writeAudit(db, { locationId: input.locationId, actor: input.actor, action: "waitlist.added", entityType: "waitlist_entry", entityId: rows[0]!.id });
  return rows[0]!.id;
}

export async function removeFromWaitlist(db: SqlClient, input: { locationId: string; entryId: string; actor: Actor }): Promise<void> {
  const { rows } = await db.query(`UPDATE waitlist_entries SET status = 'removed' WHERE id = $1 AND location_id = $2 AND status IN ('waiting', 'offered') RETURNING id`, [input.entryId, input.locationId]);
  if (!rows[0]) throw new NotFoundError("Waitlist entry", input.entryId);
  await db.query(`UPDATE waitlist_offers SET status = 'expired' WHERE waitlist_entry_id = $1 AND status = 'sent'`, [input.entryId]);
  await writeAudit(db, { locationId: input.locationId, actor: input.actor, action: "waitlist.removed", entityType: "waitlist_entry", entityId: input.entryId });
}

export interface WaitlistRow {
  id: string;
  status: "waiting" | "offered" | "filled" | "removed";
  created_at: Date;
  patient_id: string;
  pet_name: string;
  species: string;
  client_id: string;
  client_name: string;
  service_name: string;
  provider_name: string | null;
  offers: { status: string; channel: string; start: string; claimed_at: string | null }[];
}

export async function listWaitlist(db: SqlClient, locationId: string, opts: { include?: "active" | "all" } = {}): Promise<WaitlistRow[]> {
  const { rows } = await db.query<WaitlistRow>(
    `SELECT w.id, w.status, w.created_at, p.id AS patient_id, p.name AS pet_name, p.species, c.id AS client_id,
            c.first_name || ' ' || c.last_name AS client_name, s.name AS service_name, pr.display_name AS provider_name,
            coalesce((SELECT json_agg(json_build_object('status', o.status, 'channel', o.channel, 'start', lower(o.slot_range), 'claimed_at', o.claimed_at) ORDER BY lower(o.slot_range))
                      FROM waitlist_offers o WHERE o.waitlist_entry_id = w.id), '[]') AS offers
     FROM waitlist_entries w JOIN patients p ON p.id = w.patient_id JOIN clients c ON c.id = p.client_id
     JOIN services s ON s.id = w.service_id LEFT JOIN providers pr ON pr.id = w.preferred_provider_id
     WHERE w.location_id = $1 ${opts.include === "all" ? "" : "AND w.status IN ('waiting', 'offered')"}
     ORDER BY w.status = 'filled', w.created_at`,
    [locationId],
  );
  return rows;
}

// ---------- Offering a freed time ----------

export interface OfferValues {
  clinicName: string;
  aiName: string;
  timezone: string;
  /** e.g. "https://app.vetrix.com/claim/<organization id>"; the token is appended. */
  claimBase: string;
}

const spoken = (start: number, tz: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz }).format(start);

/** Entries that fit this freed time under the real booking rules, oldest first. */
async function fittingCandidates(db: SqlClient, locationId: string, slot: { serviceId: string; providerId: string | null; start: number; end: number }, timezone: string) {
  const { rows } = await db.query<WaitlistEntryInput & { pet: string; first_name: string }>(
    `SELECT w.id, w.patient_id AS "patientId", p.client_id AS "clientId", w.service_id AS "serviceId", w.preferred_provider_id AS "preferredProviderId",
            extract(epoch FROM w.created_at) * 1000 AS "createdAt", c.sms_consent AS "smsConsent", p.name AS pet, c.first_name,
            EXISTS (SELECT 1 FROM client_flags f WHERE f.client_id = c.id AND f.flag = 'do_not_contact') AS "doNotContact",
            EXISTS (SELECT 1 FROM client_flags f WHERE f.client_id = c.id AND f.flag = 'do_not_call') AS "doNotCall"
     FROM waitlist_entries w JOIN patients p ON p.id = w.patient_id JOIN clients c ON c.id = p.client_id
     WHERE w.location_id = $1 AND w.service_id = $2 AND w.status IN ('waiting', 'offered') AND p.status = 'active'`,
    [locationId, slot.serviceId],
  );
  const matches = matchingEntries(rows.map((r) => ({ ...r, createdAt: Number(r.createdAt) })), slot);
  if (matches.length === 0) return [];
  const service = await loadService(db, locationId, slot.serviceId);
  const date = localParts(slot.start, timezone).date;
  const data = await loadSchedulingData(db, locationId, date, 1);
  const needsPreop = (getVeterinaryPack().services.services.find((s) => s.id === service.packServiceId) as { requires_preop_bloodwork?: boolean } | undefined)?.requires_preop_bloodwork;
  const fits: typeof rows = [];
  for (const m of matches) {
    const patient = await loadPatientForBooking(db, locationId, m.patientId);
    const e = checkEligibility(service, patient, date);
    if (e.blocking.length) continue;
    if (needsPreop) {
      // W7: surgery times only go to pets with valid pre-op bloodwork.
      const ok = await db.query(
        `SELECT 1 FROM appointments a JOIN services s ON s.id = a.service_id WHERE a.patient_id = $1 AND s.pack_service_id = 'preop_bloodwork'
           AND a.status = 'completed' AND a.start_at > now() - interval '30 days'`,
        [m.patientId],
      );
      if (!ok.rows[0]) continue;
    }
    // The exact time must still be bookable for this pet (rooms, equipment, provider).
    const free = findSlots(data, { service, patient, dates: [date], notBefore: 0, providerId: slot.providerId ?? undefined, limit: 1000 }).some((s) => s.start === slot.start);
    if (free) fits.push(rows.find((r) => r.id === m.id)!);
  }
  return fits;
}

/**
 * A visit was cancelled or moved: offer its time to the waitlist by text
 * (first wave). Returns how many offers went out.
 */
export async function offerFreedSlot(
  db: SqlClient,
  input: { locationId: string; appointmentId: string; now: number; sandbox: boolean; values: OfferValues },
): Promise<{ offers: number }> {
  const { rows } = await db.query<{ service_id: string; provider_id: string | null; start_at: Date; end_at: Date; status: string; service_name: string }>(
    `SELECT a.service_id, a.provider_id, a.start_at, a.end_at, a.status, s.name AS service_name
     FROM appointments a JOIN services s ON s.id = a.service_id WHERE a.id = $1 AND a.location_id = $2`,
    [input.appointmentId, input.locationId],
  );
  const appt = rows[0];
  if (!appt || appt.status !== "cancelled") return { offers: 0 };
  const slot = { serviceId: appt.service_id, providerId: appt.provider_id, start: appt.start_at.getTime(), end: appt.end_at.getTime() };
  if (!worthOffering(slot, input.now)) return { offers: 0 };
  const already = await db.query(`SELECT 1 FROM waitlist_offers WHERE source_appointment_id = $1 LIMIT 1`, [input.appointmentId]);
  if (already.rows[0]) return { offers: 0 };

  const candidates = await fittingCandidates(db, input.locationId, slot, input.values.timezone);
  const wave = firstWave(candidates);
  const when = spoken(slot.start, input.values.timezone);
  for (const c of wave) {
    const token = randomBytes(18).toString("base64url");
    await db.query(
      `INSERT INTO waitlist_offers (waitlist_entry_id, source_appointment_id, slot_range, channel, claim_token, expires_at)
       VALUES ($1, $2, tstzrange($3, $4), 'sms', $5, $6)`,
      [c.id, input.appointmentId, new Date(slot.start), new Date(slot.end), token, new Date(input.now + WAITLIST.claimMinutes * 60_000)],
    );
    await db.query(`UPDATE waitlist_entries SET status = 'offered' WHERE id = $1`, [c.id]);
    const body = fillScript(WAITLIST_TEXT.offer, {
      clinic_name: input.values.clinicName, pet_name: c.pet, service: appt.service_name.toLowerCase(), when, claim_link: `${input.values.claimBase}/${token}`,
    });
    await db.query(
      `INSERT INTO messages (location_id, client_id, patient_id, channel, template_key, body, status, sent_at)
       VALUES ($1, $2, $3, 'sms', 'waitlist_offer', $4, $5, $6)`,
      [input.locationId, c.clientId, c.patientId, body, input.sandbox ? "simulated" : "queued", input.sandbox ? new Date() : null],
    );
  }
  if (wave.length) {
    await writeAudit(db, { locationId: input.locationId, actor: SYSTEM, action: "waitlist.offered", entityType: "appointment", entityId: input.appointmentId, changes: { offers: wave.length } });
  }
  return { offers: wave.length };
}

// ---------- Claiming ----------

export type ClaimResult =
  | { status: "claimed"; appointmentId: string; petName: string; when: string }
  | { status: "taken" | "expired" | "invalid"; petName?: string; when?: string };

export interface OfferView {
  status: string;
  petName: string;
  serviceName: string;
  clinicName: string;
  start: Date;
  expiresAt: Date;
  timezone: string;
}

/** For the public claim page: what the offer is (no client details beyond the pet's name). */
export async function offerByToken(db: SqlClient, token: string): Promise<OfferView | null> {
  const { rows } = await db.query<OfferView>(
    `SELECT o.status, p.name AS "petName", s.name AS "serviceName", l.name AS "clinicName", lower(o.slot_range) AS start, o.expires_at AS "expiresAt", l.timezone
     FROM waitlist_offers o JOIN waitlist_entries w ON w.id = o.waitlist_entry_id JOIN patients p ON p.id = w.patient_id
     JOIN services s ON s.id = w.service_id JOIN locations l ON l.id = w.location_id WHERE o.claim_token = $1`,
    [token],
  );
  return rows[0] ?? null;
}

/** First to claim gets the time; the others hear it was taken. */
export async function claimOffer(
  db: SqlClient,
  input: { token: string; now: number; sandbox: boolean; clinicName: string; /** false when the confirmation goes out as a text reply */ recordConfirmation?: boolean },
): Promise<ClaimResult> {
  const { rows } = await db.query<{
    id: string; status: string; expires_at: Date; start: Date; source: string; entry_id: string; location_id: string; patient_id: string;
    client_id: string; service_id: string; provider_id: string | null; pet: string; service_name: string; timezone: string;
  }>(
    `SELECT o.id, o.status, o.expires_at, lower(o.slot_range) AS start, o.source_appointment_id AS source, w.id AS entry_id, w.location_id,
            w.patient_id, p.client_id, w.service_id, a.provider_id, p.name AS pet, s.name AS service_name, l.timezone
     FROM waitlist_offers o JOIN waitlist_entries w ON w.id = o.waitlist_entry_id JOIN patients p ON p.id = w.patient_id
     JOIN services s ON s.id = w.service_id JOIN appointments a ON a.id = o.source_appointment_id JOIN locations l ON l.id = w.location_id
     WHERE o.claim_token = $1 FOR UPDATE OF o`,
    [input.token],
  );
  const offer = rows[0];
  if (!offer) return { status: "invalid" };
  const when = spoken(offer.start.getTime(), offer.timezone);
  if (offer.status === "claimed") return { status: "invalid", petName: offer.pet, when };
  if (offer.status === "slot_taken") return { status: "taken", petName: offer.pet, when };
  if (offer.status === "expired" || offer.expires_at.getTime() < input.now) {
    await db.query(`UPDATE waitlist_offers SET status = 'expired' WHERE id = $1`, [offer.id]);
    return { status: "expired", petName: offer.pet, when };
  }
  // Someone else already claimed this time?
  const won = await db.query(`SELECT 1 FROM waitlist_offers WHERE source_appointment_id = $1 AND status = 'claimed'`, [offer.source]);
  if (won.rows[0]) {
    await db.query(`UPDATE waitlist_offers SET status = 'slot_taken' WHERE id = $1`, [offer.id]);
    return { status: "taken", petName: offer.pet, when };
  }
  await db.query("SAVEPOINT claim");
  let appointmentId: string;
  try {
    const r = await bookAppointment(db, {
      locationId: offer.location_id,
      patientId: offer.patient_id,
      serviceId: offer.service_id,
      start: offer.start.getTime(),
      providerId: offer.provider_id,
      bookedBy: "client",
      actor: { type: "client", id: offer.client_id },
      reasonText: "Claimed from the waitlist",
      today: localParts(input.now, offer.timezone).date,
    });
    appointmentId = r.appointmentId;
    await db.query("RELEASE SAVEPOINT claim");
  } catch (error) {
    await db.query("ROLLBACK TO SAVEPOINT claim");
    if (error instanceof ConflictError || error instanceof RuleViolationError) {
      await db.query(`UPDATE waitlist_offers SET status = 'slot_taken' WHERE id = $1`, [offer.id]);
      return { status: "taken", petName: offer.pet, when };
    }
    throw error;
  }
  await db.query(`UPDATE waitlist_offers SET status = 'claimed', claimed_at = now() WHERE id = $1`, [offer.id]);
  await db.query(`UPDATE waitlist_entries SET status = 'filled' WHERE id = $1`, [offer.entry_id]);
  if (input.recordConfirmation !== false) await db.query(
    `INSERT INTO messages (location_id, client_id, patient_id, appointment_id, channel, template_key, body, status, sent_at)
     VALUES ($1, $2, $3, $4, 'sms', 'waitlist_claimed', $5, $6, $7)`,
    [offer.location_id, offer.client_id, offer.patient_id, appointmentId,
     fillScript(WAITLIST_TEXT.claimed, { clinic_name: input.clinicName, pet_name: offer.pet, service: offer.service_name.toLowerCase(), when }),
     input.sandbox ? "simulated" : "queued", input.sandbox ? new Date() : null],
  );
  // Everyone else offered this time: it's gone.
  const others = await db.query<{ id: string; client_id: string; patient_id: string; pet: string; entry_id: string }>(
    `UPDATE waitlist_offers o SET status = 'slot_taken' FROM waitlist_entries w JOIN patients p ON p.id = w.patient_id
     WHERE o.waitlist_entry_id = w.id AND o.source_appointment_id = $1 AND o.status = 'sent' AND o.id <> $2
     RETURNING o.id, p.client_id, w.patient_id, p.name AS pet, w.id AS entry_id`,
    [offer.source, offer.id],
  );
  for (const o of others.rows) {
    await db.query(`UPDATE waitlist_entries SET status = 'waiting' WHERE id = $1 AND status = 'offered'`, [o.entry_id]);
    await db.query(
      `INSERT INTO messages (location_id, client_id, patient_id, channel, template_key, body, status, sent_at) VALUES ($1, $2, $3, 'sms', 'waitlist_taken', $4, $5, $6)`,
      [offer.location_id, o.client_id, o.patient_id, fillScript(WAITLIST_TEXT.taken, { clinic_name: input.clinicName, pet_name: o.pet, when }),
       input.sandbox ? "simulated" : "queued", input.sandbox ? new Date() : null],
    );
  }
  await writeAudit(db, { locationId: offer.location_id, actor: { type: "client", id: offer.client_id }, action: "waitlist.claimed", entityType: "appointment", entityId: appointmentId });
  return { status: "claimed", appointmentId, petName: offer.pet, when };
}

/** The client's open text offer, for a YES reply. */
export async function openOfferTokenForClient(db: SqlClient, locationId: string, clientId: string): Promise<string | null> {
  const { rows } = await db.query<{ claim_token: string }>(
    `SELECT o.claim_token FROM waitlist_offers o JOIN waitlist_entries w ON w.id = o.waitlist_entry_id JOIN patients p ON p.id = w.patient_id
     WHERE w.location_id = $1 AND p.client_id = $2 AND o.status = 'sent' AND o.channel = 'sms' ORDER BY o.expires_at DESC LIMIT 1`,
    [locationId, clientId],
  );
  return rows[0]?.claim_token ?? null;
}

// ---------- Every few minutes ----------

/**
 * Expires offers nobody claimed in 30 minutes and, once per freed time, has
 * the AI call the next two people (second wave).
 */
export async function waitlistFollowUps(db: SqlClient, input: { locationId: string; now: number; sandbox: boolean; values: OfferValues }): Promise<{ expired: number; calls: number }> {
  const expired = await db.query<{ source: string; entry_id: string }>(
    `UPDATE waitlist_offers o SET status = 'expired' FROM waitlist_entries w
     WHERE o.waitlist_entry_id = w.id AND w.location_id = $1 AND o.status = 'sent' AND o.expires_at < $2
     RETURNING o.source_appointment_id AS source, w.id AS entry_id`,
    [input.locationId, new Date(input.now)],
  );
  for (const e of expired.rows) await db.query(`UPDATE waitlist_entries SET status = 'waiting' WHERE id = $1 AND status = 'offered'`, [e.entry_id]);
  let calls = 0;
  for (const source of new Set(expired.rows.map((e) => e.source))) {
    const state = await db.query<{ claimed: boolean; called: boolean }>(
      `SELECT bool_or(status = 'claimed') AS claimed, bool_or(channel = 'ai_call') AS called FROM waitlist_offers WHERE source_appointment_id = $1`,
      [source],
    );
    if (state.rows[0]?.claimed || state.rows[0]?.called) continue;
    const appt = (await db.query<{ service_id: string; provider_id: string | null; start_at: Date; end_at: Date; service_name: string }>(
      `SELECT a.service_id, a.provider_id, a.start_at, a.end_at, s.name AS service_name FROM appointments a JOIN services s ON s.id = a.service_id WHERE a.id = $1`,
      [source],
    )).rows[0];
    if (!appt || appt.start_at.getTime() <= input.now) continue;
    const slot = { serviceId: appt.service_id, providerId: appt.provider_id, start: appt.start_at.getTime(), end: appt.end_at.getTime() };
    const offered = new Set((await db.query<{ id: string }>(`SELECT waitlist_entry_id AS id FROM waitlist_offers WHERE source_appointment_id = $1`, [source])).rows.map((r) => r.id));
    const candidates = await fittingCandidates(db, input.locationId, slot, input.values.timezone);
    const when = spoken(slot.start, input.values.timezone);
    for (const c of secondWave(candidates, offered)) {
      await db.query(
        `INSERT INTO waitlist_offers (waitlist_entry_id, source_appointment_id, slot_range, channel, claim_token, expires_at)
         VALUES ($1, $2, tstzrange($3, $4), 'ai_call', $5, $6)`,
        [c.id, source, new Date(slot.start), new Date(slot.end), randomBytes(18).toString("base64url"), new Date(input.now + WAITLIST.claimMinutes * 60_000)],
      );
      await db.query(`UPDATE waitlist_entries SET status = 'offered' WHERE id = $1`, [c.id]);
      await db.query(
        `INSERT INTO messages (location_id, client_id, patient_id, channel, template_key, body, status, sent_at) VALUES ($1, $2, $3, 'ai_call', 'waitlist_call', $4, $5, $6)`,
        [input.locationId, c.clientId, c.patientId,
         fillScript(WAITLIST_TEXT.call, { client_first_name: c.first_name, ai_name: input.values.aiName, clinic_name: input.values.clinicName, pet_name: c.pet, service: appt.service_name.toLowerCase(), when }),
         input.sandbox ? "simulated" : "queued", input.sandbox ? new Date() : null],
      );
      calls += 1;
    }
  }
  return { expired: expired.rows.length, calls };
}

/** Providers that can be preferred on a waitlist entry. */
export async function listBookableProviders(db: SqlClient, locationId: string): Promise<{ id: string; name: string; role: string }[]> {
  const { rows } = await db.query<{ id: string; name: string; role: string }>(
    `SELECT id, display_name AS name, role FROM providers WHERE location_id = $1 AND bookable ORDER BY role, display_name`,
    [locationId],
  );
  return rows;
}
