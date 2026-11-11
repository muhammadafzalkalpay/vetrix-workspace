# Terminology and entity model

## Terminology

The Aesthetix term on the left never appears in Vetrix. `config/labels.json` is the source of truth. This table is for humans.

| Aesthetix | Vetrix | Notes |
|---|---|---|
| Client | Client | In a vet practice the client is the human. Keep the word. |
| (none) | Patient | The pet. New first-class entity. In speech the AI says "pet" or the pet's name. |
| Treatment | Service | |
| Practitioner, Provider | Doctor, Technician | Role-specific labels. "Team member" when the role is unknown. |
| Room | Exam room | Plus surgery suite, dental suite, and other room types. |
| Device | Equipment | |
| Consultation | Exam | |
| Package, Membership | Wellness plan | |
| Retention, Rebooking | Reminders | Clinics say "reminders", not "retention". |
| Treatment plan | Care plan | Rarely used in v1. |
| Aftercare | Discharge instructions | |
| Guest | Client | Never "guest". |
| Appointment | Appointment | Also "visit" in speech. |

## Entity model

### Client (the owner)

The human who books, pays, and receives messages.

Fields: `id`, `first_name`, `last_name`, `mobile`, `email`, `alt_phone`, `address`, `preferred_channel` (sms, email, call), `sms_consent` (bool, timestamp, source), `marketing_consent`, `notes`, `flags` (vip, payment_issue, difficult, do_not_contact, do_not_call), `household_id`, `source` (phone_ai, web, import, staff), `created_at`.

### Patient (the pet)

Belongs to exactly one client. A client has zero or many patients.

Fields: `id`, `client_id`, `name`, `species` (dog, cat, rabbit, bird, reptile, other), `breed`, `sex` (male, female), `neutered` (bool), `date_of_birth` or `approx_age_months`, `weight_kg` (last known), `color_markings`, `microchip_number`, `status` (active, deceased, transferred, inactive), `provisional` (bool), `deceased_date`, `temperament_flags` (anxious, aggressive, needs_muzzle, cat_carrier_required, fear_free), `medical_alerts` (staff-only free text), `active_prescriptions` (bool), `last_wellness_exam_at`, `last_dental_at`, `last_surgery_at`, `referring_clinic`, `created_at`.

### Household

Groups clients who share pets, for example two owners and one dog.

Fields: `id`, `primary_client_id`, `member_client_ids[]`, `address`. Reminders go to the household primary unless a pet has its own contact set.

### Appointment

Fields: `patient_id` (required), `client_id` (required), `service_id`, `provider_id`, `room_id`, `equipment_ids[]`, `start`, `end`, `status` (requested, confirmed, checked_in, in_progress, completed, no_show, cancelled), `booked_by` (ai, staff, web, client), `reason_text`, `triage_level` (routine, urgent, emergency), `drop_off` (bool), `fasting_confirmed` (bool), `preop_bloodwork_valid` (bool), `notes_for_staff`, `reminder_id` (attribution), `confirmation_sent_at`, `confirmed_at`, `late_cancel` (bool), `cancellation_reason`.

### Vaccine record

Fields: `patient_id`, `vaccine_id` (from `retention.json`), `administered_at`, `due_at`, `interval_months`, `administered_by` (this_clinic, external).

### Prevention product

Fields: `patient_id`, `product_type` (flea_tick, heartworm, combo), `product_name`, `dose_interval_days`, `doses_supplied`, `supply_start_at`, `supply_end_at`.

### Provider

Fields: `id`, `display_name`, `role` (dvm, technician, assistant, csr, manager), `skills[]`, `schedule`, `bookable` (bool), `max_concurrent` (surgery is 1).

### Room and equipment

Room: `id`, `type` (exam, cat_exam, surgery, dental, radiology, treatment, comfort, isolation, kennel), `name`, `capacity`.
Equipment: `id`, `type`, `name`, `exclusive` (bool, blocks concurrent use). Store one row per physical unit. The `default_count` values in `resources.json` tell onboarding how many rows to create.

### Workflow records

Waitlist entries and offers, staff tasks, calls, recordings and transcripts, triage events, reminders, reminder touches, messages, and replies are stored as their own records. Their fields come from the Data lists in `03-workflows.md`.

Historic visits in `visits.csv` import as completed appointments.

## Business rules that touch the schema

1. **Every appointment has a patient and a client.** No patient, no booking. The AI creates a provisional patient from the call if needed.
2. **Deceased patients.** `status = deceased` suppresses all reminders and blocks booking. The client record stays active. The AI never offers a deceased pet in a list. Staff can set the flag with a date. The AI can set it only when the client says the pet has already died, and must confirm that fact, the pet name, and the species before saving. A request to euthanize never sets deceased.
3. **Household messaging.** Reminders due within 14 days of each other for pets in the same household merge into one message.
4. **Species gates services.** Every service carries `species[]`. "Spay (feline)" is never offered for a dog.
5. **Technician appointments need a doctor on site.** Check provider schedules for a bookable or non-bookable DVM on premises, not just room availability.
6. **Surgery and dental** require fasting from midnight and valid pre-op bloodwork (within 30 days), or bloodwork booked the same morning. The AI delivers the fasting script and records `fasting_confirmed` on the confirmation text or call. `preop_bloodwork_valid` comes from the latest completed `preop_bloodwork` appointment.
7. **Vaccine boosters as a technician appointment** require a wellness exam in the last 12 months. Otherwise the AI books an exam and tells the client the vaccines happen in the same visit.
8. **New clients.** The AI asks for the previous clinic and creates a records-transfer task for staff.
9. **Temperament flags change the booking.** `aggressive` or `anxious` adds a 15-minute buffer and a staff note. `cat_carrier_required` adds a line to the confirmation. `fear_free` prefers the cat room.
10. **Prescriptions.** `active_prescriptions = true` is required before the AI books an injection or medication appointment. Otherwise it creates a staff task.
