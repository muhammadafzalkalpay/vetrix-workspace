# Vetrix

The AI front desk for veterinary clinics. Every call answered. Every pet brought back.

Production application. Hosted on GCP Cloud Run with Neon Postgres.

## Structure

| Folder | Purpose |
|---|---|
| `apps/web` | Next.js app: staff screens, APIs, webhooks, and scheduled routes |
| `apps/voice` | Node service for live calls (Twilio audio to OpenAI Realtime) |
| `packages/domain` | Booking, triage, reminder, waitlist, and messaging rules |
| `packages/db` | Neon access and tenant routing |
| `packages/pack` | Pack loading and validation, plus the veterinary pack v0.2.2 |
| `db/migrations` | SQL for the registry database (8 tables) and clinic database (57 tables) |
| `docs` | Product pack documents and test data |

## Setup

1. Install Node 22 and pnpm.
2. Run `pnpm install`.
3. Copy `.env.example` to `apps/web/.env.local` and add the Neon connection strings.
4. Run `pnpm dev`, then open http://localhost:3000.

## Database

- Run `db/migrations/registry/001_registry.sql` in the registry database.
- Run `db/migrations/clinic/002_clinic.sql` in the clinic database.
- Never run both files in the same database.
- Add each later change as a new numbered SQL file. Never edit a file that has already run.

## Checks

```
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Rules

- Business rules go in `packages/domain`, not in React components or route handlers.
- Vertical wording comes from the pack. No Aesthetix terms appear in Vetrix screens or messages.
- `MESSAGING_MODE=sandbox` simulates every call and text and labels it. Production must set the mode explicitly.
