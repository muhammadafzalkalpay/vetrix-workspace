# Vetrix project context

Vetrix is the AI front desk for veterinary clinics. It answers calls, books against doctors, rooms and equipment, and brings pets back when they are due. It sits in front of the clinic's PIMS and does not replace it.

Read `docs/HANDOFF.md` for the full planning history.

## Confirmed decisions
- New repo, separate from Lumière. Port useful Lumière code module by module. Never change Lumière.
- Stack: Next.js 15, TypeScript, Tailwind, shadcn/ui, Neon Postgres, Twilio (voice, SMS, recordings in V1), SendGrid (email), OpenAI (Realtime for calls; added later, not Azure), Better Auth. Hosted on GCP Cloud Run (`web` and `voice` services), Cloud Scheduler for the every-minute job dispatcher, Secret Manager for secrets.
- One database per organization, with its locations inside it. A shared registry database routes each organization to its database.
- `vertical_id` belongs to the location. Veterinary rules come from the versioned pack in `packages/pack/veterinary` (v0.2). Pack v0.2 is the approved baseline (12 Nov 2026); it replaces the v0.1 docs where they disagree.
- This is a production application. Do not use the word "demo" in code, screens, config or docs. Use "sandbox" for simulated messaging and "sample clinic" for seeded data.
- `MESSAGING_MODE=sandbox` simulates every call and text, saves it and labels it "Sandbox". `live` sends through Twilio and SendGrid. Production must set it explicitly.
- Sample clinic data is seeded only into non-production databases.
- AI provider: OpenAI directly, added later. Do not set up or use Azure (decided 13 Nov 2026). The `AZURE_OPENAI_*` variables in `apps/web/src/lib/env.ts` are to be replaced with OpenAI ones when the key arrives.
- Sandbox AI: when the OpenAI key is not set, calls and texts are answered by a scripted sandbox AI (pack triage phrases, real booking rules) labelled "Sandbox". Never call it "mock" or "demo". Adding the key switches to Azure with no code change. Live phone calls and final AI quality tests need the real key.
- Twilio webhooks (no SDK): `/api/twilio/sms`, `/api/twilio/voice` (+ `/turn`, `/dial`, `/status`). Signature-checked with `TWILIO_AUTH_TOKEN`; unsigned requests only outside production. Numbers route to a location through the registry `phone_numbers` table (`pnpm db:phone:add`). In sandbox mode texts are recorded but never replied to; calls are still answered by voice (Twilio speech recognition), and texts during calls are only recorded.
- Live call audio will run in `apps/voice`, a separate Node service, because calls hold one connection open for minutes. Built after the web app works end to end in sandbox mode.
- Sign-in: Better Auth, users and sessions in the registry. Public sign-up is off; staff are added (`pnpm db:staff:add` until onboarding) and set a password via "Forgot password". Roles are per location; permissions come from `packages/domain/src/access.ts`. Web code imports `@vetrix/db/runtime`, never `@vetrix/db`.
- Business rules live in `packages/domain`, never in React components or route handlers.
- New clinic databases are created automatically at signup through the Neon API. A CLI script covers manual creation.
- The schema is created manually from `db/migrations`. Registry: 13 tables (001_registry + 003_auth + 005_phone_numbers). Clinic: 59 tables (002_clinic + 004_front_desk + 006_messages + 007_jobs_and_replies). Never run both files in one database. Add changes as new numbered files.

## Pack v0.2 rules that are easy to miss
- Triage classifies by meaning, treats pack phrases as examples, escalates when unsure, and never lowers a level within a call.
- The surgery and dental fasting check is sent at 19:00 the evening before. No reply creates a staff task to verify at drop-off.
- Booking euthanasia pauses that pet's reminders.
- A pet is marked deceased only after the death, pet name, and species are confirmed.
- No Aesthetix terms in Vetrix screens, emails, or texts.

## Build plan
Milestones: 1 Foundation, 2 Clients, pets and booking, 3 AI front desk and triage, 4 Reminders, messages and waitlist, 5 Launch readiness (onboarding, reports, sample clinic data for staging, marketing site), 6 Quality and handover.
Do not start a milestone until Muhammad approves it.

## Working style
Muhammad prefers concise, practical answers and iterative changes. Explain an unfamiliar concept simply before the implementation.

## Known open items
- Some test pets have dates that are impossible, such as an exam before birth. Fix these before treating reminder tests as final.
- STOP blocks all texts. Opted-out clients get confirmations by email or AI call instead. Needs legal review before launch.
- After-hours default: the pack default (emergency clinic referral, then book the next slot).
- Med spa shows as "Coming soon" in the vertical selector.
- Not chosen yet: final name and pricing.
