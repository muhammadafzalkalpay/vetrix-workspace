# Vetrix project context

Vetrix is the AI front desk for veterinary clinics. It answers calls, books against doctors, rooms and equipment, and brings pets back when they are due. It sits in front of the clinic's PIMS and does not replace it.

Read `docs/HANDOFF.md` for the full planning history.

## Confirmed decisions
- New repo, separate from Lumière. Port useful Lumière code module by module. Never change Lumière.
- Stack: Next.js 15, TypeScript, Tailwind, shadcn/ui, Neon Postgres, Twilio, OpenAI Realtime. Hosted on Vercel.
- One database per organization, with its locations inside it. A shared registry database routes each organization to its database.
- `vertical_id` belongs to the location. Veterinary rules come from the versioned pack in `packages/pack/veterinary` (v0.2).
- The client demo uses real Neon tables with seeded data. Calls and texts are simulated and labelled.
- Live call audio will run in `apps/voice`, a separate Node service, because calls hold one connection open for minutes. Not needed for the demo.
- Business rules live in `packages/domain`, never in React components or route handlers.
- The schema is created manually from `db/migrations`. Registry: 8 tables. Clinic: 57 tables. Never run both files in one database. Add changes as new numbered files.

## Pack v0.2 rules that are easy to miss
- Triage classifies by meaning, treats pack phrases as examples, escalates when unsure, and never lowers a level within a call.
- The surgery and dental fasting check is sent at 19:00 the evening before. No reply creates a staff task to verify at drop-off.
- Booking euthanasia pauses that pet's reminders.
- A pet is marked deceased only after the death, pet name, and species are confirmed.
- No Aesthetix terms in Vetrix screens, emails, or texts.

## Build plan
Milestones: 1 Foundation, 2 Clients, pets and booking, 3 AI front desk and triage, 4 Reminders, messages and waitlist, 5 Demo experience, 6 Quality and handover.
Do not start a milestone until Muhammad approves it.

## Working style
Muhammad prefers concise, practical answers and iterative changes. Explain an unfamiliar concept simply before the implementation.

## Known open items
- The schema was once run with both files in one database. Confirm the registry and clinic databases are separate before Milestone 1.
- Some test pets have dates that are impossible, such as an exam before birth. Fix these before treating reminder tests as final.
- Not chosen yet: authentication provider, object storage provider, STOP handling for confirmations, after-hours default, final name and pricing.
