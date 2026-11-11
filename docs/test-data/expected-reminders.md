# Expected reminder counts

Reference date for the retention run: **2026-11-03**. Load every CSV in this folder, run the engine as of that date, and compare.

These counts are computed by `gen_testdata.py` from the same data, so they are exact for the rules as written in `config/retention.json`. If your engine disagrees, the first place to look is the day arithmetic (12 months = 365 days, 6 months = 183 days in the generator).

## Population

- Clients: 50 (3 shared households: hh_006, hh_018, hh_034)
- Patients: 67 total, 64 active, 2 deceased, 1 transferred
- Clients flagged do_not_contact: 1 (their 2 active pet(s) must receive nothing)
- Households with more than one active pet: 17 (merge candidates)

## Counts the engine must produce on the reference date

| Rule | Touch | Expected patients |
|---|---|---|
| annual_wellness | T-30 (due in 0 to 30 days) | 11 |
| annual_wellness | T-7 (due in 0 to 7 days) | 3 |
| annual_wellness | T+14 overdue call (14 or more days overdue) | 23 |
| senior_recheck | T-21 (due in 0 to 21 days) | 1 |
| senior_recheck | T+14 overdue call | 15 |
| vaccine_due | T-30 (any vaccine due in 0 to 30 days, one per patient) | 25 |
| vaccine_due | T+7 overdue call (any vaccine 7 or more days overdue, one per patient) | 25 |
| parasite_prevention_refill | supply ends within 10 days | 13 |
| no_show_recovery | open sequences | 2 |
| post_surgery_recheck | active sequences | 2 |

## Suppression checks

- Deceased patients (pat_009, pat_031): zero outbound messages of any kind.
- Transferred patient (pat_040): zero reminders.
- do_not_contact client pets (pat_037, pat_038): zero outbound.
- Clients with sms_consent = false: no SMS touches; email touches still fire where email exists.

## Household merge check

Household hh_006 has three active pets. If two or more have a reminder inside the 14-day merge window, the client receives one message naming all of them. Verify this by inspecting the send log, not the count table.

## Vaccine note

Vaccine due dates in `vaccine_records.csv` are set per patient, so a patient's rabies and core vaccine fall due on the same day. The engine must group them into one message ("rabies and DAPP"), which is why the vaccine counts above are per patient, not per record.
