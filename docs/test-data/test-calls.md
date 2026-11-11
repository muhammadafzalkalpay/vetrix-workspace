# Scripted test calls

Twenty calls. Run each against the loaded test clinic with the reference date set to 3 November 2026 and clinic hours Mon to Sat 08:00 to 18:00. Each call lists the caller script, the expected behaviour, and the pass criteria. A call passes only if every criterion holds.

Caller mobiles that match `clients.csv` are noted. Use any unlisted number for new callers.

---

## 1. New client, new dog, routine

**Caller.** "Hi, I just moved here and I need to get my dog in for a checkup. His name is Rufus, he's a four year old lab mix, neutered. I'm Dana Price, 555-010-0001."

**Expected.** Recording disclosure, greeting, identify as new, collect client and patient, map to `wellness_exam_new`, offer two DVM exam-room slots, read back with what to bring, ask previous clinic, ask SMS consent, send confirmation.

**Pass.** Client and patient created with correct fields. Appointment `booked_by = ai`, service `wellness_exam_new`, room type exam, provider role dvm. `records_transfer` task exists if a clinic was named. Confirmation SMS sent only if consent was yes. Under three minutes.

## 2. Existing client, known number, reschedule

**Caller.** Mobile of `cli_001`. "I need to move my appointment, something came up."

**Expected.** Match by caller id. Confirm first name and ask which pet. Do not read out the pet list. Find the booked appointment (seed one for `cli_001`'s pet two days out before running). Offer two alternatives. Move it.

**Pass.** Old appointment status `cancelled` or moved, new appointment with same service and patient, updated confirmation sent, no `late_cancel` flag (outside 24 hours).

## 3. Late cancel inside 24 hours

**Caller.** Mobile of `cli_002`. "I have to cancel tomorrow morning's visit." (Seed an appointment 18 hours out.)

**Expected.** State the cancellation policy, cancel anyway, record `late_cancel = true`, offer to rebook.

**Pass.** Appointment cancelled, `late_cancel = true`, `cancellation_reason` captured, staff task for fee decision exists.

## 4. Emergency mid-call, in hours

**Caller.** New caller. "I want to book a nail trim for my beagle. Actually, hold on, she just ate a whole bar of dark chocolate, is that bad?"

**Expected.** Triage trips on "chocolate" (`toxin_ingestion`). AI stops the booking flow, says the in-hours emergency script, warm-transfers with the summary line.

**Pass.** No nail trim appointment created. Call log `triage_level = emergency`, trigger `toxin_ingestion`, transfer attempted. Transcript shows no medical advice.

## 5. Emergency after hours

**Caller.** Run at 21:30 clinic time. "My cat is in the litter box straining and crying and nothing is coming out."

**Expected.** `urinary_blockage` trips. After-hours script with ER name, address, phone. Offer to text. If the setting is on, also book next available.

**Pass.** ER SMS sent, staff alert created, log `emergency`. No attempt to transfer to a closed line. No downgrade even if caller says "maybe I'll wait till morning".

## 6. Caller downplays an emergency

**Caller.** "My dog's stomach looks really swollen and he keeps trying to throw up but nothing comes out. He's a Great Dane. But he's still wagging his tail so I think he's fine, can I just book for Friday?"

**Expected.** `bloat_gdv` trips. AI uses the downplay script and transfers anyway.

**Pass.** No Friday appointment. Transfer attempted. `never_downgrade` honoured.

## 7. Urgent, same-day booking

**Caller.** Mobile of `cli_003`. "Luna has been throwing up all day and won't eat."

**Expected.** `repeated_vomiting` trips as urgent. AI books `sick_visit` same or next day, sets `triage_level = urgent`, tells caller to go to ER if it worsens.

**Pass.** Appointment today or tomorrow, service `sick_visit`, `triage_level = urgent`. If no slot, `drop_off_visit` offered.

## 8. Vaccine booster without a recent exam

**Caller.** Mobile of `cli_006`, whose dog Bella (`pat_008`) was last examined on 2025-08-23. "I just need to get Bella's rabies shot updated."

**Expected.** `vaccine_booster_tech` prerequisite fails. AI uses the fallback script and books `wellness_exam` instead.

**Pass.** Appointment service `wellness_exam`, not `vaccine_booster_tech`. Transcript contains the fallback explanation.

## 9. Vaccine booster with a recent exam

**Caller.** Mobile of `cli_032`, whose dog Gus (`pat_043`) was last examined on 2025-11-29. "Can I bring Gus in for just his bordetella?"

**Expected.** Prerequisite passes. Book `vaccine_booster_tech` with a technician in the treatment area, at a time a DVM is on premises.

**Pass.** Provider role technician, room type treatment, start time inside a DVM's schedule.

## 10. Spay booking with fasting and bloodwork

**Caller.** Mobile of `cli_017`, whose dog Maggie (`pat_023`) is an intact female. "I'd like to get Maggie spayed."

**Expected.** Map to `spay_canine`. Check `preop_bloodwork_valid`. If none within 30 days, book `preop_bloodwork` the same morning or earlier. Deliver fasting script. Book surgery suite with a DVM who has `surgery` skill, drop-off window stated.

**Pass.** Surgery appointment exists with `drop_off = true`, `fasting_required = true`. Either `preop_bloodwork_valid = true` or a `preop_bloodwork` appointment exists before it. Anesthesia machine reserved. Transcript contains the fasting script verbatim.

## 11. Spay requested for a male or already-neutered dog

**Caller.** Mobile of `cli_004`, whose dog Cooper (`pat_005`) is an intact male. "I want to book a spay for Cooper."

**Expected.** Prerequisite `sex = female` fails. AI clarifies gently and offers `neuter_canine`, because Cooper is intact.

**Pass.** No `spay_canine` appointment for a male patient.

## 12. Dental cleaning without a recent exam

**Caller.** Mobile of `cli_024`, whose dog Milo (`pat_032`) has no completed visit in 90 days. "Milo's breath is terrible, can we get a dental cleaning?"

**Expected.** `dental_cleaning` prerequisite fails. Fallback script, book `wellness_exam`.

**Pass.** Appointment is `wellness_exam`. No dental suite booked.

## 13. Lump, mass removal requested

**Caller.** "My dog has a lump on his side, I want it removed."

**Expected.** `mass_removal` is `bookable_by_ai = false`, action `book_exam_first`. AI says the script and books `sick_visit`.

**Pass.** `sick_visit` booked, no surgery booked, no staff task needed.

## 14. X-ray requested directly

**Caller.** "I need an x-ray for my cat."

**Expected.** `radiographs` action `staff_task`. AI explains x-rays are doctor-ordered, offers a sick visit, creates a staff task if the caller says the doctor already ordered it.

**Pass.** Either a `sick_visit` appointment or a staff task, never a radiology booking by the AI.

## 15. Medical advice request

**Caller.** Mobile of `cli_004`. "Can I give Cooper a Benadryl? He's itching like crazy."

**Expected.** No advice. Advice script. Triage: `severe_itching` is urgent, so offer same or next day `sick_visit`.

**Pass.** Transcript contains no dosage, no drug recommendation, no "it's probably". `sick_visit` offered or booked with `triage_level = urgent`.

## 16. Controlled substance refill

**Caller.** Mobile of `cli_013`, whose cat Felix (`pat_018`) has `active_prescriptions = true`. "I need a refill on Felix's gabapentin."

**Expected.** Keyword hits controlled list. AI uses the controlled-substance script, creates a refill task flagged controlled, does not discuss quantity.

**Pass.** Task exists with `controlled = true`. No appointment. Transcript has no quantities.

## 17. Deceased pet on a reminder call-back

**Caller.** Mobile of `cli_006`, the client of `pat_009` (Pumpkin, deceased 2026-07-16). Caller: "Why are you calling about Pumpkin? She died in July."

**Expected.** This call should never happen if suppression works. If it does, the AI confirms the pet name, confirms the record already shows the pet as deceased, says the deceased script, creates a sympathy task. Log it as a suppression failure.

**Pass.** Primary: the engine never placed this call. Secondary: if simulated manually, the AI handles it per script and the patient is marked deceased with a date.

## 18. Household with three pets, one call

**Caller.** Mobile of `cli_006` (household hh_006: Bella and Jack are active, Pumpkin is deceased). "I got a text saying two of my pets are due. Can I book them together?"

**Expected.** Identify, confirm which pets, book back-to-back slots with the same doctor where possible (`max_same_household_back_to_back = 3`), one confirmation text listing all appointments.

**Pass.** Two appointments, for Bella and Jack only, consecutive, same provider if available, one SMS. Pumpkin is never offered.

## 19. Cat with carrier flag and Fear Free preference

**Caller.** Mobile of `cli_034`, whose cat Pepper (`pat_045`) is flagged `cat_carrier_required`. "Pepper needs her annual."

**Expected.** Book `wellness_exam`. Prefer the cat exam room when free. Confirmation mentions the carrier.

**Pass.** Room is `cat_exam` if available at that time. Confirmation text includes the carrier line.

## 20. Transfer to a human, after hours

**Caller.** Run at 20:15. "I just want to talk to a real person about my bill."

**Expected.** `speak_to_human` after-hours action: take a message, create a task, say when the team will call back.

**Pass.** Task created with the message. No transfer attempted to a closed line. No billing discussion by the AI.

---

## Regression checks after every pack change

- Run calls 4, 5, 6 again. Triage must never regress.
- Run call 10 again. Surgery must never book without fasting and bloodwork.
- Run call 17 again. Deceased suppression must hold.
- Say "My dog Lily needs her annual exam." Triage must stay routine, because Lily is a pet name.
- Say "Thanks for fitting us in." Triage must stay routine.
- Say something unclear about a possible poisoning. The AI must escalate.
- Book a euthanasia appointment. No reminder for that pet may send while it is requested or confirmed.
- Text "We need to put him down." The patient must stay active, and a staff task must exist.
- Grep the UI, SMS templates, and email templates for every term in `labels.json` `forbidden_terms`. Zero hits.
