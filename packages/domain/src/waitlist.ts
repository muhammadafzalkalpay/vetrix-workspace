// Waitlist fill (pack workflow W7). Pure: which waiting pets a freed time is
// offered to, in what order and by which channel.
//
// A cancellation inside the next 72 hours is offered by text to the first
// three matching entries (oldest first); if nobody claims within 30 minutes
// the AI calls the next two. A match is the same service, a provider
// preference that allows this provider, and (checked by the caller with the
// real booking rules) a pet who can have that service at that time.
export const WAITLIST = {
  horizonHours: 72,
  firstWave: 3,
  secondWave: 2,
  claimMinutes: 30,
} as const;

export interface WaitlistEntryInput {
  id: string;
  patientId: string;
  clientId: string;
  serviceId: string;
  preferredProviderId: string | null;
  createdAt: number;
  smsConsent: boolean;
  doNotContact: boolean;
  doNotCall: boolean;
}

export interface FreedSlot {
  serviceId: string;
  providerId: string | null;
  start: number;
  end: number;
}

/** Whether a freed time is close enough to offer (and not already past). */
export function worthOffering(slot: FreedSlot, now: number): boolean {
  return slot.start > now && slot.start - now <= WAITLIST.horizonHours * 3_600_000;
}

/** Waiting entries that fit the freed time, oldest first (before the booking-rule check). */
export function matchingEntries<T extends WaitlistEntryInput>(entries: T[], slot: FreedSlot): T[] {
  return entries
    .filter((e) => e.serviceId === slot.serviceId && !e.doNotContact && (!e.preferredProviderId || e.preferredProviderId === slot.providerId))
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** The first wave: texts to those who allow them. */
export function firstWave<T extends WaitlistEntryInput>(candidates: T[]): T[] {
  return candidates.filter((c) => c.smsConsent).slice(0, WAITLIST.firstWave);
}

/** The second wave after 30 minutes unclaimed: AI calls to the next ones not yet offered. */
export function secondWave<T extends WaitlistEntryInput>(candidates: T[], alreadyOffered: ReadonlySet<string>): T[] {
  return candidates.filter((c) => !alreadyOffered.has(c.id) && !c.doNotCall).slice(0, WAITLIST.secondWave);
}

/**
 * PROVISIONAL wording: the pack has no waitlist templates (product gap,
 * flagged). Short and transactional; YES or the link claims it.
 */
export const WAITLIST_TEXT = {
  offer: "{{clinic_name}}: A time opened up for {{pet_name}}'s {{service}}: {{when}}. First to claim gets it. Reply YES or tap {{claim_link}} within 30 minutes.",
  taken: "{{clinic_name}}: Sorry, the {{when}} time for {{pet_name}} was just taken. You're still on our waitlist.",
  claimed: "{{clinic_name}}: You're booked: {{pet_name}}, {{service}}, {{when}}. Reply C to confirm or R to reschedule.",
  call: "Hi {{client_first_name}}, this is {{ai_name}} from {{clinic_name}}. A time opened up for {{pet_name}}'s {{service}}: {{when}}. Would you like it?",
} as const;
