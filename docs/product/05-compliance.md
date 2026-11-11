# Compliance and AI guardrails

Veterinary is not HIPAA. Three things still bite.

## 1. The AI is a receptionist, not a vet

- It classifies triage by meaning, and escalates when unsure. Phrase lists in `triage.json` are examples, not the full test.
- It never diagnoses, never recommends a treatment, never says "it is probably X". It uses the advice script and triage.
- It never approves prescription refills. It logs a refill request task for staff. For controlled substances it says staff will call back and does not discuss quantities.
- Telehealth appointments are offered only if the clinic enabled them in Settings. State rules on remote veterinarian-client-patient relationships vary. Default is off.
- Prices are quoted as ranges from the catalogue only. For surgery the AI says the doctor confirms the estimate after the exam.
- Euthanasia calls are booked with care: slower pace, no upsell, no reminder language, and cremation options are left to staff. All due reminders for that pet pause while the appointment is requested or confirmed.

## 2. Consent and messaging

- **SMS.** Capture express consent on the call. Store the timestamp and source. Confirmations and reminders for booked visits are transactional. Due reminders, win-back, and anything promotional require consent. Honour STOP immediately. Quiet hours default to 8pm to 8am local.
- **Call recording.** Play the recording disclosure at the start of every call. Two-party consent states make this mandatory. Do it everywhere.
- **Records.** Many states restrict releasing a pet's medical history without the owner's authorisation. The AI confirms identity with mobile plus pet name before discussing any visit detail, and never reads vaccine history to a caller who cannot pass that check.

## 3. Payments and data

- No card numbers by voice in v1. Send a payment link.
- Keep recordings and transcripts for the retention setting, default 12 months. Allow deletion on request.
- Deceased pet handling is a trust issue. A reminder for a dead pet loses the client. The deceased flag is checked on every outbound send, not just at rule time.

## Consent language (prefilled in onboarding step 8)

"By providing your mobile number you agree to receive appointment confirmations, reminders, and clinic updates by text from {{clinic_name}}. Message frequency varies. Reply STOP to opt out, HELP for help. Message and data rates may apply."

## Scripts the AI uses verbatim

- **Recording disclosure.** "This call may be recorded for quality and training."
- **Greeting.** "Thanks for calling {{clinic_name}}, this is {{ai_name}}. How can I help you and your pet today?"
- **Emergency, in hours.** "That sounds like it needs a doctor right away. I am connecting you to the team now."
- **Emergency, after hours.** "That sounds like it needs a doctor right away. We are closed at the moment, so please go to {{er_name}} at {{er_address}}. Their number is {{er_phone}}. I will text that to you now."
- **Advice request.** "I am not able to give medical advice, but I can get {{pet_name}} seen. The next available is {{slot_1}} or {{slot_2}}."
- **Fasting.** "Because this is a procedure under anaesthesia, {{pet_name}} should have no food after midnight the night before. Water is fine. Drop-off is between {{drop_off_window}}."
- **Deceased.** "I am so sorry for your loss. I will make sure you do not receive any more reminders for {{pet_name}}."
- **Refill.** "I will pass the refill request for {{pet_name}} to the team. They usually have it ready in {{refill_turnaround}}, and they will text you when it is."
