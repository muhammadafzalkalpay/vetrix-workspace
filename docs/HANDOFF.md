# Vetrix handoff

Summary of the planning conversation on claude.ai, 4 to 12 November 2026. Read this with `CLAUDE.md` before starting work.

## What Vetrix is
- The AI front desk for small-animal veterinary clinics in the US, for single clinics and groups of 2 to 10 locations.
- It answers calls and texts as "Riley", books against doctors, rooms and equipment, sends confirmations and reminders, recovers no-shows, and fills cancellations from a waitlist.
- It sits in front of the clinic's PIMS. Out of scope for V1: medical records, clinical notes, invoicing, inventory, prescriptions, lab results, and live PIMS sync.
- It is the veterinary vertical of the Aesthetix idea. The core must stay general so dental, physical therapy and chiropractic packs can follow.

## Source documents
- `docs/product/`: pack v0.2 product brief, terminology and entities, seven workflows, signup and onboarding, compliance, README.
- `docs/test-data/`: synthetic clinic CSVs, `expected-reminders.md`, `test-calls.md` with 20 scripted calls and regression checks.
- `packages/pack/veterinary/`: the eight config files plus `manifest.json`.
- If the brief and the pack disagree, the pack wins for product behaviour.

## Why a new repo
- The Lumière repo (`muhammadafzal-io/lumiere-flow-workspace`) is a single-clinic med spa app. It has no tenancy, no vertical config, no pet model and no inbound phone flow, and stores appointments in Google Calendar event descriptions.
- Decision: build Vetrix as a new repo and port proven Lumière code module by module. Lumière stays untouched.
- Worth porting: UI components, agent tool loop, booking guards, resource scheduling, waitlist, voice guards, RBAC, tests.
- Use as reference only: reminders, rules engine, dashboards, calendar.
- Leave behind: Google Calendar storage, Discord delivery, hardcoded spa content, the public `/api/voice/tool` route as written.
- Security note for Lumière: `/api/voice/tool` has no auth check and runs whatever tool name it receives. Fix it in Lumière separately.

## Architecture
- Next.js on GCP Cloud Run for staff screens, APIs, webhooks and scheduled routes (decision of 12 Nov 2026, replacing Vercel). Cloud Scheduler calls the job dispatcher every minute.
- `apps/voice`: separate Node service for live Twilio audio to Azure OpenAI Realtime, also on Cloud Run (connections up to 60 minutes). Built after the web app works end to end in sandbox mode, where calls are simulated.
- Business rules in `packages/domain`, database access and tenant routing in `packages/db`, pack loading in `packages/pack`.
- Appointments live in Postgres, not Google Calendar. Each held provider, room or equipment unit is a row in `appointment_resources`. Exclusion constraints block double-booking of exclusive resources. Shared-capacity rooms need a locked count check in the booking service.
- The messaging gate re-checks pet status, do-not-contact, consent and quiet hours at send time for every outbound message.

## Database
- Neon. One shared registry database plus one clinic database per organization, with all its locations inside.
- Registry, 8 tables: `db/migrations/registry/001_registry.sql`. Clinic, 57 tables: `db/migrations/clinic/002_clinic.sql`. Total 65.
- Both files were tested on a Postgres engine. All columns match the ERD, every foreign key has an index, and overlap tests were rejected as expected.
- Neon project `vetrix`, development branch `schema-dev`, databases `vetrix_registry` and the first clinic database (created as `vetrix_demo_clinic`; rename to `clinic_dev`). Keep `production` empty until `schema-dev` is reviewed.
- Status on 11 November: both scripts appear to have been run in the same database. Confirm the registry tables are only in `vetrix_registry`, then drop them from the clinic database.
- `messages` and `audit_logs` start as normal tables. Partition by month later if volume requires it.

## Confirmed schema decisions
- Waitlist, staff tasks, calls, messages and reminder logs are inferred from the workflow data lists.
- `do_not_call` is a client flag. `cancellation_reason` is an appointment field. `provisional` is a patient field.
- Equipment is one row per physical unit, with no `count` column.
- Bloodwork validity comes from the latest completed bloodwork visit and is saved as `preop_bloodwork_valid`.
- `visits.csv` imports as completed appointments.

## Pack v0.2 fixes
- Triage classifies by meaning, treats pack phrases as examples, masks pet names, escalates when unsure, and never lowers a level within a call.
- Seven test calls were rewritten to match the test data. Call 18 now names Pumpkin as the deceased pet.
- The surgery and dental fasting check moved from T-2h to 19:00 the evening before. No reply by 20:00 creates a staff task to verify at drop-off.
- Booking euthanasia pauses that pet's reminders.
- A pet is marked deceased only after the death has happened and the pet name and species are confirmed. "We need to put him down" never sets deceased.

## Pack issues still open
- Some test pets have impossible dates, such as an exam or vaccine before birth.
- Plain substring matching in `intake.json` misroutes some phrases. Use longest-keyword matching with word boundaries.
- `resources.json` says assistants can do nail trims, but `services.json` books a technician. Weight checks need an assistant, and the test clinic has none.
- STOP handling for confirmations needs a provider check and legal review.

## Product flows
- W1 new caller to booking, W2 reschedule or cancel, W3 confirmations, W4 no-show follow-up, W5 due reminders, W6 emergency triage, W7 waitlist fill.
- Emergency triage overrides every call. Open: warm transfer with a summary. Closed: ER details by voice and text, plus a staff alert. Never transfer to a closed line.

## Sample clinic (staging data)
- Sample clinic: Vetrix Veterinary Center, Main Veterinary Clinic, Asia/Karachi time zone, AI persona Riley. Seeded only into non-production databases.
- Staff: Dr. Ahmed and Dr. Sarah (vets), John (technician), Ali (client service).
- Clients: Sara Khan, Muhammad Ali, John Smith. Pets: Rufus (dog), Tommy (cat), Max (dog), Bella (rabbit).
- 13 navigation areas: Overview, Calendar, Appointments, Clients, Patients, Due list, Waitlist, Calls and AI front desk, Staff and providers, Services and resources, Reports, Settings, Architecture and ERD.
- Show all seven workflows, the vertical selector, ten-step onboarding, and an `/architecture` page with an interactive ERD.
- In sandbox mode, label every simulated call or text. Never send real messages.

## Artifacts on claude.ai
- Vetrix Visual PRD: scope, flows, data, guardrails, decisions.
- Vetrix Scalable ERD: all 65 tables with plain-language column notes.
- Vetrix Architecture Walkthrough: five interactive scenarios.
- Vetrix Build Plan: milestones and the manual schema order.

## Decisions of 12 November 2026
- Pack v0.2 is the baseline over the v0.1 docs.
- Hosting: GCP Cloud Run. Auth: Better Auth. Email: SendGrid. Recordings stay in Twilio for V1.
- Clinic databases are provisioned automatically through the Neon API.
- Database split confirmed: registry and clinic tables are in separate databases.
- Milestone 1 approved.
- Production application: the word "demo" is not used. Simulated messaging is "sandbox" (`MESSAGING_MODE`), seeded data is the "sample clinic". Milestone 5 is "Launch readiness".

## Next steps
1. Fix the database split and confirm 8 registry and 57 clinic tables.
2. Push this repo to GitHub.
3. Muhammad approves Milestone 1: pack loader, tenant routing, Neon connection, seeded sample clinic, brand and app shell.

## Working style
- Muhammad prefers concise, practical answers and iterative changes.
- Explain unfamiliar concepts simply before implementation details.
- Do not write code for a milestone until Muhammad approves it.
