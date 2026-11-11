# Workflows

Seven workflows cover the product. Each one lists the trigger, the happy path, two exceptions, the data captured, and the lines the AI must never cross. Timings are targets, not hard limits.

## W1. New caller to booking

**Trigger.** Inbound call from an unrecognised number, or a recognised client with a new pet.

**Happy path.**
1. Greet with the clinic name and the AI persona name. Ask how it can help.
2. Caller wants an appointment. Ask whether this is an emergency or something that cannot wait. Run triage on every piece of reason text, for the whole call.
3. Collect client: first and last name, mobile, email. Read the mobile back.
4. Collect patient: name, species, breed, approximate age, sex, neutered or not. Weight is optional.
5. Reason for visit. Map to a service using `intake.json`. If unclear, default to Sick visit for a problem and Wellness exam for anything routine.
6. Offer the two nearest slots that satisfy species, room, and provider role rules. Ask for a preference: morning or afternoon, a specific doctor.
7. Book. Read back date, time, doctor, and what to bring (records, stool sample, carrier or leash).
8. Ask for the previous clinic to request records. Ask for SMS consent for reminders. Send the confirmation text.

**Exceptions.**
- Caller does not know the breed or exact age. Accept "mixed" and an age band. Never block on it.
- Triage trips mid-call. Stop booking and follow W6.

**Data.** Client, patient, appointment with `booked_by = ai`, `sms_consent` with timestamp, records-transfer task, recording and transcript.

**Never.** Give medical advice, suggest a diagnosis, quote a price outside the catalogue range, or book a surgery without the fasting and bloodwork script.

## W2. Existing client reschedule or cancel

**Trigger.** Recognised number, or caller gives their name and the pet's name.

**Happy path.** Identify the client by mobile. Confirm with the pet's name, never by reading out a list. Find the appointment. Offer two alternatives. Move it, re-assign room and provider, send the updated confirmation.

**Exceptions.**
- Inside the cancellation window (default 24 hours). State the policy, record `late_cancel`, let staff decide on the fee. Still cancel.
- Surgery reschedule. Re-check fasting and bloodwork validity. Bloodwork older than 30 days on the new date means booking bloodwork the same morning.

**Data.** Status change, `cancellation_reason`, `late_cancel`.

## W3. Confirmation and pre-visit reminders

**Trigger.** A booked appointment. T-48h SMS confirmation (reply C to confirm, R to reschedule). T-24h reminder. For surgery and dental, a fasting check by SMS at 19:00 clinic time the evening before.

**Happy path.** Client replies C, status becomes confirmed. No reply by T-24h, the AI calls once.

**Exceptions.**
- Reply R. Open the reschedule flow by SMS link or call-back.
- Surgery or dental client has not confirmed fasting by 20:00. Create a staff task to verify fasting at drop-off.

**Data.** Confirmation status, `fasting_confirmed`, reply log.

## W4. No-show follow-up

**Trigger.** Staff mark the appointment `no_show`, or 20 minutes past start with no check-in. The system auto-flags, staff confirm.

**Happy path.** T+1h SMS: sorry we missed you, with two slots to rebook. T+24h call if no reply. T+7d final text. Then stop.

**Exceptions.**
- Client says the pet has died. Confirm the death has already happened, confirm the pet name and species, set deceased, express condolence, stop all messages for that pet, create a staff task for a sympathy card.
- Client says they cancelled. Apologise, flag for staff review, do not argue.

**Data.** No-show count on the client, rebook outcome.

## W5. Reminders: due and overdue

**Trigger.** Rules in `retention.json` fire against patient records: wellness, vaccines, prevention refills, dental, senior, post-op. Household merge window is 14 days.

**Happy path.** T-30d email and SMS with a booking link. T-7d SMS. T+14d overdue call by the AI with two slots offered. A booking stops the sequence. Three touches per rule, then quarterly win-back.

**Exceptions.**
- Client says the pet is seen elsewhere now. Mark the patient `transferred` and stop reminders for that pet only.
- Client replies STOP. Stop marketing and win-back. Keep confirmations for appointments already booked.

**Data.** Reminder log, `reminder_id` on any resulting appointment for attribution.

## W6. Emergency triage and transfer

**Trigger.** Any reason text or caller statement that the AI classifies as a `transfer_now` trigger in `triage.json`, at any point in any call. Phrases are examples, so classification is by meaning. If the AI is unsure, it escalates.

**Happy path, in hours.** Stop the current flow. Say the emergency script. Warm-transfer to the clinic line with a one-line summary. Log as emergency.

**Happy path, after hours.** Say the after-hours script. Give the configured ER partner name, phone, and address. Offer to text it. If the setting allows, also book the next available slot. Log for morning review.

**Exceptions.**
- Transfer fails. Read the ER details, text them, create an urgent staff alert.
- Caller says it is not that bad. Still transfer or give ER details. The AI does not downgrade.

**Urgent category.** Not a transfer. Book the first available same-day or next-day slot, set `triage_level = urgent`, tell the caller to go to the ER if it gets worse before the visit.

**Data.** `triage_level`, trigger matched, transfer outcome.

## W7. Waitlist fill

**Trigger.** A cancellation opens a slot inside the next 72 hours.

**Happy path.** Pull waitlist entries whose service, species, and provider preference match. Text the first three with a claim link. First to claim gets it, the others get a "slot taken" text. No claim in 30 minutes, the AI calls the next two.

**Exceptions.**
- Surgery slot. Only offer it to patients with valid pre-op bloodwork, and confirm fasting on the claim.
- The slot needs equipment that an overlapping procedure holds. Do not offer it.

**Data.** Waitlist entry status, time to fill, who claimed.
