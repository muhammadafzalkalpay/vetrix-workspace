# Vetrix vertical pack (v0.2)

Vetrix is the veterinary edition of the Aesthetix core. Same engine: AI front desk, resource-aware scheduling, retention flows. Different vocabulary, entity model, service catalogue, intake, triage, and reminder rules.

This pack is the complete handover for the vertical. Nothing in here needs to be invented by the dev. If something is missing, it is a product gap, so flag it rather than guess.

## Read in this order

1. `01-product-brief.md` what Vetrix is, who buys it, what is out of scope.
2. `02-terminology-and-entities.md` label map and the owner-plus-pet data model. Read before touching the schema.
3. `03-workflows.md` the seven workflows the product must handle, each with exceptions.
4. `04-signup-and-onboarding.md` the vertical selector, the clinic onboarding wizard, and the UI differences.
5. `05-compliance.md` what the AI must never do, consent capture, call recording, verbatim scripts.
6. `packages/pack/veterinary/` the machine-readable pack. Map these to the config schema you built.
7. `docs/test-data/` a synthetic clinic to load for QA, expected reminder counts, and 20 scripted test calls.

## How the config maps

Each JSON file covers one concern. Keys are stable `snake_case` ids. Display strings live in `labels.json` only. If your schema differs in shape, keep the ids and rewrite the shape. Do not fork the ids: the dental and PT packs will reuse the same ids and the same file layout.

| File | Concern | Loaded at |
|---|---|---|
| `labels.json` | Every user-facing term, singular and plural, plus forbidden Aesthetix terms | Theme and i18n layer |
| `resources.json` | Room types, equipment, provider roles, skills, defaults for a two-doctor clinic | Onboarding step 3 and 4 |
| `services.json` | Service catalogue template with duration, resources, rules, price ranges | Onboarding step 5 |
| `intake.json` | What the AI asks a new or existing caller, in order, and how reason text maps to a service | Front desk |
| `triage.json` | Emergency and urgent triggers, actions in and out of hours, scripts | Front desk, every call |
| `retention.json` | Reminder rules, cadences, templates, vaccine catalogue, suppression | Retention engine |
| `faq.json` | Policy questions the AI can answer, with setting placeholders | Front desk |
| `brand.json` | Name, colours, type, AI persona, voice rules | Theme layer |

## Definition of done

- Signup with vertical = veterinary loads this pack end to end and no Aesthetix term appears in the UI, emails, or SMS. The vertical selector screen itself is exempt, since it names every product.
- A new caller can book a wellness exam for a new pet in under three minutes, and the call creates a client, a patient, and an appointment.
- Every `transfer_now` trigger in `triage.json` interrupts booking and transfers, in hours, or gives ER details after hours.
- All 20 calls in `docs/test-data/test-calls.md` pass.
- Loading `docs/test-data/` and running the retention engine on the reference date produces the counts in `docs/test-data/expected-reminders.md`.
- The deceased flag suppresses every reminder for that patient while the household message still goes out for the other pets.
- Surgery bookings cannot be created without the fasting script and a pre-op bloodwork check.

## Assumptions

- US market, English, US spelling, US date and phone formats.
- Standalone v1. No practice management system integration. Clients and pets import via CSV.
- Small-animal general practice, dogs and cats. Other species are accepted as values but the catalogue is not tuned for them.
- No card capture by the AI. Payment links only.

## Open items for the product owner

- Final name, trademark and domain check. Vetrix is the working name.
- Pricing and plan tiers.
- Default after-hours behaviour: ER referral only, or ER referral plus booking the next available slot. Pack default is ER referral plus booking.
- STOP handling for booked-visit confirmations. Check SMS provider behaviour and get legal review.

## Change log

- v0.2, 6 Nov 2026. Triage classifies by meaning and escalates when unsure. Seven test calls now match the test data, and call 18 now states the deceased pet. The surgery fasting check moved to 19:00 the evening before. Euthanasia bookings pause reminders, and deceased status requires confirmation that the death has happened. Entity model updated for confirmed schema decisions.
- v0.1, 3 Nov 2026. Initial pack.
