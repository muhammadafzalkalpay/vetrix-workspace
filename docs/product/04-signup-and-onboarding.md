# Signup and onboarding

## Vertical selector

First screen after account creation. "What kind of practice is this?" Five cards: Med spa (Aesthetix), Veterinary clinic (Vetrix), Dental (coming soon), Physical therapy (coming soon), Chiropractic (coming soon). Only the first two are enabled today.

Selecting a card sets `vertical_id` on the location and loads the pack. It is set once per location and is not user-editable after onboarding. Support can change it.

## Onboarding wizard

Ten steps. Steps 1, 2, 3, and 7 are mandatory. The rest can be skipped and finished later from Settings.

1. **Clinic basics.** Name, address, timezone, main phone, website, species treated (dogs, cats, small mammals, birds, reptiles, large animal), number of locations.
2. **Hours and after-hours.** Weekly hours, lunch closures, holiday list, after-hours ER partner (name, phone, address), after-hours behaviour (ER referral only, or ER referral plus book next available).
3. **Team.** For each person: name, role (doctor, technician, assistant, client service, manager), skills (surgery, dentistry, ultrasound, USDA accredited, exotics, Fear Free), working schedule, bookable toggle. Minimum one doctor.
4. **Rooms and equipment.** Prefilled from `resources.json` defaults for a two-doctor clinic. Adjust names and counts.
5. **Services.** Catalogue prefilled from `services.json`. Toggle on or off, edit duration and price range, set preferred providers. Species rules are already set.
6. **Policies.** Cancellation window and fee, surgery deposit, new-client policy, payment methods, prescription refill turnaround, records release policy, telehealth on or off.
7. **Phone.** The Vetrix number to forward to, greeting text, AI persona name (default Riley), transfer number for emergencies, transfer number for staff requests, voicemail fallback.
8. **Messaging.** SMS sender name, consent language (prefilled from `05-compliance.md`), opt-out handling, quiet hours.
9. **Import clients and pets.** CSV template with one row per pet and client columns repeated. Dedupe on mobile. Preview, then confirm. Show counts: clients created, pets created, pets with a reminder due in the next 30 days.
10. **Go-live checklist.** Test call completed, staff trained on transfer, ER partner confirmed, consent language reviewed, call forwarding live. Button: Go live.

## UI differences from Aesthetix

- Client card shows a pet list with a species icon, age, and status chips (due, overdue, deceased).
- Booking modal starts with pet selection, then service, then slot.
- Calendar is coloured by room type. Surgery and dental suites are separate lanes.
- A "Due list" view: patients due or overdue by rule, with one-click send and the outcome.
- Triage events appear as a red banner on the call log and the dashboard.
- Brand tokens from `brand.json` apply at the theme layer. No Aesthetix imagery anywhere.
- Species icons: dog, cat, rabbit, bird, reptile, other. Simple line icons, original artwork.

## CSV import template

Columns, one row per pet:

`client_first_name, client_last_name, mobile, email, address, sms_consent (yes/no), pet_name, species, breed, sex, neutered (yes/no), date_of_birth, weight_kg, microchip, last_wellness_exam, rabies_due, dapp_or_fvrcp_due, bordetella_due, leptospirosis_due, prevention_product, prevention_supply_end, status (active/deceased), notes`

Rows with the same mobile become one client with multiple pets.
