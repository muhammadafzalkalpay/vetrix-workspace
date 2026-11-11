import csv, random, datetime as dt, os, json

random.seed(20261103)
OUT = "/home/claude/vetrix-pack/test-data"
os.makedirs(OUT, exist_ok=True)
REF = dt.date(2026, 11, 3)

def d(days):
    return REF - dt.timedelta(days=days)

# Providers
providers = [
    ["prov_001", "Dr. Elena Marsh", "dvm", "surgery;dentistry;ultrasound;usda_accredited;euthanasia", "Mon-Fri 08:00-18:00", "true", "1"],
    ["prov_002", "Dr. Samuel Okafor", "dvm", "surgery;euthanasia;fear_free", "Tue-Sat 08:00-18:00", "true", "1"],
    ["prov_003", "Priya Nair", "technician", "fear_free", "Mon-Fri 07:00-16:00", "true", "2"],
    ["prov_004", "Marcus Bell", "technician", "", "Mon-Sat 09:00-18:00", "true", "2"],
    ["prov_005", "Dana Whitfield", "csr", "", "Mon-Fri 07:30-18:00", "false", "0"],
]
with open(f"{OUT}/providers.csv", "w", newline="") as f:
    w = csv.writer(f); w.writerow(["id", "display_name", "role", "skills", "schedule", "bookable", "max_concurrent"]); w.writerows(providers)

rooms = [
    ["room_001", "exam", "Exam 1", "1"], ["room_002", "exam", "Exam 2", "1"], ["room_003", "exam", "Exam 3", "1"],
    ["room_004", "cat_exam", "Cat room", "1"], ["room_005", "surgery", "Surgery", "1"], ["room_006", "dental", "Dental", "1"],
    ["room_007", "radiology", "X-ray", "1"], ["room_008", "treatment", "Treatment", "4"], ["room_009", "comfort", "Comfort room", "1"],
    ["room_010", "isolation", "Isolation", "1"], ["room_011", "kennel", "Kennels", "8"],
]
with open(f"{OUT}/rooms.csv", "w", newline="") as f:
    w = csv.writer(f); w.writerow(["id", "type", "name", "capacity"]); w.writerows(rooms)

equipment = [
    ["eq_001", "anesthesia_machine", "Anesthesia 1", "true"], ["eq_002", "anesthesia_machine", "Anesthesia 2", "true"],
    ["eq_003", "xray_digital", "Digital x-ray", "true"], ["eq_004", "dental_xray", "Dental x-ray", "true"],
    ["eq_005", "dental_station", "Dental station", "true"], ["eq_006", "ultrasound", "Ultrasound", "true"],
    ["eq_007", "lab_analyzer", "Lab analyzer", "false"], ["eq_008", "microchip_scanner", "Scanner 1", "false"], ["eq_009", "microchip_scanner", "Scanner 2", "false"],
]
with open(f"{OUT}/equipment.csv", "w", newline="") as f:
    w = csv.writer(f); w.writerow(["id", "type", "name", "exclusive"]); w.writerows(equipment)

first = ["Maria", "James", "Aisha", "Daniel", "Chloe", "Omar", "Hannah", "Lucas", "Grace", "Ethan", "Nora", "Ravi", "Sofia", "Ben", "Leah", "Tom", "Isabel", "Kwame", "Julia", "Noah", "Amira", "Caleb", "Zoe", "Victor", "Mia", "Liam", "Rosa", "Theo", "Ivy", "Mateo", "Elise", "Jonah", "Tara", "Felix", "Nadia", "Oscar", "Lena", "Hugo", "Keira", "Adam", "Yara", "Sean", "Freya", "Diego", "Anna", "Wes", "Priya", "Cole", "Jade", "Ali"]
last = ["Lopez", "Whitaker", "Rahman", "Kim", "Brooks", "Haddad", "Fischer", "Moreno", "Chen", "Patel", "Nguyen", "Baker", "Russo", "Adeyemi", "Clark", "Silva", "Dubois", "Mensah", "Ortega", "Sato", "Hughes", "Castillo", "Walsh", "Iqbal", "Novak", "Reyes", "Foster", "Lindqvist", "Park", "Garcia", "Bennett", "Osei", "Marino", "Dawson", "Khan", "Perry", "Costa", "Hale", "Singh", "Bauer", "Ellis", "Vargas", "Quinn", "Ibrahim", "Wolfe", "Ramos", "Dunn", "Yilmaz", "Hart", "Byrne"]
dog_names = ["Max", "Luna", "Charlie", "Bella", "Cooper", "Daisy", "Milo", "Sadie", "Rocky", "Lola", "Buddy", "Maggie", "Tucker", "Rosie", "Bear", "Zoey", "Duke", "Ruby", "Oliver", "Penny", "Finn", "Hazel", "Jack", "Nala", "Gus"]
cat_names = ["Oliver", "Chloe", "Leo", "Lucy", "Simba", "Willow", "Jasper", "Mochi", "Felix", "Cleo", "Loki", "Pepper", "Oscar", "Nova", "Toby", "Ginger", "Smokey", "Pumpkin", "Binx", "Mittens"]
dog_breeds = ["Labrador Retriever", "Golden Retriever", "French Bulldog", "German Shepherd", "Mixed", "Beagle", "Poodle (Miniature)", "Dachshund", "Shih Tzu", "Australian Shepherd", "Boxer", "Mixed", "Husky", "Corgi", "Chihuahua"]
cat_breeds = ["Domestic Shorthair", "Domestic Shorthair", "Maine Coon", "Siamese", "Domestic Longhair", "Ragdoll", "Bengal", "Persian", "Domestic Shorthair"]

clients, patients, visits, vaccines, prevention = [], [], [], [], []
cid = pid = vid = 0
households = {}

def mobile():
    return f"555-{random.randint(200,999)}-{random.randint(1000,9999)}"

# Three shared households (two clients, same pets)
shared_pairs = [(5, 6), (17, 18), (33, 34)]
shared_lookup = {b: a for a, b in shared_pairs}

for i in range(50):
    cid += 1
    c_id = f"cli_{cid:03d}"
    fn, ln = first[i], last[i]
    hh = f"hh_{shared_lookup[i]+1:03d}" if i in shared_lookup else f"hh_{cid:03d}"
    flags = ""
    if i in (12, 41): flags = "vip"
    if i == 27: flags = "do_not_contact"
    sms = "false" if i in (8, 27, 44) else "true"
    email = f"{fn.lower()}.{ln.lower()}@example.com" if i % 7 != 3 else ""
    clients.append([c_id, fn, ln, mobile(), email, f"{random.randint(10,999)} {random.choice(['Oak','Maple','Cedar','Elm','Pine','Lake'])} {random.choice(['St','Ave','Dr','Ln'])}", "sms" if sms == "true" else "email", sms, "2026-01-15" if sms == "true" else "", "phone_ai" if sms == "true" else "", "true" if i % 5 != 0 else "false", flags, hh, "import", "2025-06-01"])

    if i in shared_lookup:
        continue  # second member of household owns no pets directly

    n_pets = 1 if i % 3 else 2
    if i in (5, 17, 33): n_pets = 3
    for k in range(n_pets):
        pid += 1
        p_id = f"pat_{pid:03d}"
        species = "cat" if (pid % 3 == 0) else "dog"
        name = random.choice(cat_names if species == "cat" else dog_names)
        breed = random.choice(cat_breeds if species == "cat" else dog_breeds)
        sex = random.choice(["male", "female"])
        age_years = random.choice([0.3, 0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
        dob = REF - dt.timedelta(days=int(age_years * 365))
        neutered = "false" if age_years < 1 else random.choice(["true", "true", "true", "false"])
        weight = round(random.uniform(3.5, 6.0), 1) if species == "cat" else round(random.uniform(4, 38), 1)
        status = "active"
        deceased_date = ""
        temperament = ""
        if species == "cat": temperament = "cat_carrier_required"
        if pid in (7, 22): temperament = (temperament + ";" if temperament else "") + "anxious"
        if pid == 14: temperament = "aggressive;needs_muzzle"
        if pid in (9, 31):
            status = "deceased"; deceased_date = str(d(random.randint(40, 200)))
        if pid == 40:
            status = "transferred"
        # last wellness exam: spread so the reference date yields a known due list
        bucket = pid % 10
        if bucket in (0, 1): last_wellness = d(random.randint(30, 300))          # recent, not due
        elif bucket in (2, 3): last_wellness = d(random.randint(335, 365))       # due within 30 days (annual)
        elif bucket in (4, 5): last_wellness = d(random.randint(366, 395))       # overdue 1 to 30 days
        elif bucket in (6, 7): last_wellness = d(random.randint(396, 420))       # overdue 31 to 55 days
        else: last_wellness = d(random.randint(430, 500))                        # long overdue
        last_dental = str(d(random.randint(340, 380))) if pid % 11 == 0 else ""
        last_surgery = str(d(random.randint(5, 12))) if pid in (3, 18) else ""
        active_rx = "true" if pid % 9 == 0 else "false"
        patients.append([p_id, c_id, name, species, breed, sex, neutered, str(dob), weight, "", f"98510000{pid:05d}" if pid % 4 else "", status, deceased_date, temperament, "", active_rx, str(last_wellness), last_dental, last_surgery, "", "2025-06-01"])

        # vaccines: rabies + core, due dates relative to reference
        core = "dapp" if species == "dog" else "fvrcp"
        rab = "rabies_dog" if species == "dog" else "rabies_cat"
        vac_offset = random.choice([-200, -60, -25, -10, 5, 20, 45])  # negative = overdue days? define due_at = REF - offset... keep clear:
        # due_at relative to REF: positive = due in future
        due_in = random.choice([-45, -20, -5, 7, 21, 60, 200])
        for v, interval in ((rab, 36 if species == "dog" else 12), (core, 36)):
            due_at = REF + dt.timedelta(days=due_in)
            adm = due_at - dt.timedelta(days=int(interval * 30.4))
            vaccines.append([p_id, v, str(adm), str(due_at), interval, "this_clinic"])
        if species == "dog" and pid % 2 == 0:
            due_at = REF + dt.timedelta(days=random.choice([-10, 15, 90]))
            vaccines.append([p_id, "bordetella", str(due_at - dt.timedelta(days=365)), str(due_at), 12, "this_clinic"])

        # prevention product
        if pid % 2 == 1 and status == "active":
            supply_end = REF + dt.timedelta(days=random.choice([3, 8, 30, 120]))
            prevention.append([p_id, "combo" if species == "dog" else "flea_tick", "Simparica Trio" if species == "dog" else "Revolution Plus", 30, 6, str(supply_end - dt.timedelta(days=180)), str(supply_end)])

        # visits
        vid += 1
        visits.append([f"vis_{vid:03d}", p_id, c_id, "wellness_exam", "prov_001" if vid % 2 else "prov_002", "room_001", str(last_wellness), "completed"])
        if last_surgery:
            vid += 1
            visits.append([f"vis_{vid:03d}", p_id, c_id, "neuter_canine" if sex == "male" else "spay_canine", "prov_001", "room_005", last_surgery, "completed"])
        if pid in (11, 26):
            vid += 1
            visits.append([f"vis_{vid:03d}", p_id, c_id, "sick_visit", "prov_002", "room_002", str(d(1)), "no_show"])

with open(f"{OUT}/clients.csv", "w", newline="") as f:
    w = csv.writer(f); w.writerow(["id", "first_name", "last_name", "mobile", "email", "address", "preferred_channel", "sms_consent", "sms_consent_at", "sms_consent_source", "marketing_consent", "flags", "household_id", "source", "created_at"]); w.writerows(clients)
with open(f"{OUT}/patients.csv", "w", newline="") as f:
    w = csv.writer(f); w.writerow(["id", "client_id", "name", "species", "breed", "sex", "neutered", "date_of_birth", "weight_kg", "color_markings", "microchip_number", "status", "deceased_date", "temperament_flags", "medical_alerts", "active_prescriptions", "last_wellness_exam_at", "last_dental_at", "last_surgery_at", "referring_clinic", "created_at"]); w.writerows(patients)
with open(f"{OUT}/visits.csv", "w", newline="") as f:
    w = csv.writer(f); w.writerow(["id", "patient_id", "client_id", "service_id", "provider_id", "room_id", "date", "status"]); w.writerows(visits)
with open(f"{OUT}/vaccine_records.csv", "w", newline="") as f:
    w = csv.writer(f); w.writerow(["patient_id", "vaccine_id", "administered_at", "due_at", "interval_months", "administered_by"]); w.writerows(vaccines)
with open(f"{OUT}/prevention_products.csv", "w", newline="") as f:
    w = csv.writer(f); w.writerow(["patient_id", "product_type", "product_name", "dose_interval_days", "doses_supplied", "supply_start_at", "supply_end_at"]); w.writerows(prevention)

# Expected reminder counts on REF date
client_by_id = {c[0]: c for c in clients}
def age_years(p):
    dob = dt.date.fromisoformat(p[7]); return (REF - dob).days / 365.25
active = [p for p in patients if p[11] == "active"]
suppressed_deceased = [p for p in patients if p[11] == "deceased"]
suppressed_transferred = [p for p in patients if p[11] == "transferred"]
do_not_contact = [p for p in active if "do_not_contact" in client_by_id[p[1]][11]]
def senior(p): return (p[3] == "dog" and age_years(p) >= 7) or (p[3] == "cat" and age_years(p) >= 10)

annual_window = []  # -30 touch fires: due within next 30 days -> last_wellness between 335 and 365 days ago; +14 call: overdue by 14+ days
annual_t30 = annual_t7 = annual_overdue = 0
senior_t21 = senior_overdue = 0
for p in active:
    if "do_not_contact" in client_by_id[p[1]][11]: continue
    days = (REF - dt.date.fromisoformat(p[16])).days
    if senior(p):
        # due at +6 months = ~183 days
        due_in = 183 - days
        if 0 <= due_in <= 21: senior_t21 += 1
        if due_in <= -14: senior_overdue += 1
    else:
        due_in = 365 - days
        if 0 <= due_in <= 30: annual_t30 += 1
        if 0 <= due_in <= 7: annual_t7 += 1
        if due_in <= -14: annual_overdue += 1

vac_t30 = vac_overdue = 0
active_ids = {p[0] for p in active if "do_not_contact" not in client_by_id[p[1]][11]}
seen = set()
for v in vaccines:
    if v[0] not in active_ids: continue
    due_in = (dt.date.fromisoformat(v[3]) - REF).days
    key = (v[0], "t30")
    if 0 <= due_in <= 30 and key not in seen: vac_t30 += 1; seen.add(key)
    key = (v[0], "over")
    if due_in <= -7 and key not in seen: vac_overdue += 1; seen.add(key)

prev_due = sum(1 for pr in prevention if pr[0] in active_ids and (dt.date.fromisoformat(pr[6]) - REF).days <= 10)
noshow = sum(1 for v in visits if v[7] == "no_show")
postop = [p for p in active if p[18]]

# households with >1 active pet and at least two reminders in window -> merge candidates
from collections import defaultdict
hh_pets = defaultdict(list)
for p in active: hh_pets[client_by_id[p[1]][12]].append(p)
multi_hh = sum(1 for k, v in hh_pets.items() if len(v) > 1)

md = f"""# Expected reminder counts

Reference date for the retention run: **{REF.isoformat()}**. Load every CSV in this folder, run the engine as of that date, and compare.

These counts are computed by `gen_testdata.py` from the same data, so they are exact for the rules as written in `config/retention.json`. If your engine disagrees, the first place to look is the day arithmetic (12 months = 365 days, 6 months = 183 days in the generator).

## Population

- Clients: {len(clients)} (3 shared households: hh_006, hh_018, hh_034)
- Patients: {len(patients)} total, {len(active)} active, {len(suppressed_deceased)} deceased, {len(suppressed_transferred)} transferred
- Clients flagged do_not_contact: 1 (their {len(do_not_contact)} active pet(s) must receive nothing)
- Households with more than one active pet: {multi_hh} (merge candidates)

## Counts the engine must produce on the reference date

| Rule | Touch | Expected patients |
|---|---|---|
| annual_wellness | T-30 (due in 0 to 30 days) | {annual_t30} |
| annual_wellness | T-7 (due in 0 to 7 days) | {annual_t7} |
| annual_wellness | T+14 overdue call (14 or more days overdue) | {annual_overdue} |
| senior_recheck | T-21 (due in 0 to 21 days) | {senior_t21} |
| senior_recheck | T+14 overdue call | {senior_overdue} |
| vaccine_due | T-30 (any vaccine due in 0 to 30 days, one per patient) | {vac_t30} |
| vaccine_due | T+7 overdue call (any vaccine 7 or more days overdue, one per patient) | {vac_overdue} |
| parasite_prevention_refill | supply ends within 10 days | {prev_due} |
| no_show_recovery | open sequences | {noshow} |
| post_surgery_recheck | active sequences | {len(postop)} |

## Suppression checks

- Deceased patients ({', '.join(p[0] for p in suppressed_deceased)}): zero outbound messages of any kind.
- Transferred patient ({', '.join(p[0] for p in suppressed_transferred)}): zero reminders.
- do_not_contact client pets ({', '.join(p[0] for p in do_not_contact)}): zero outbound.
- Clients with sms_consent = false: no SMS touches; email touches still fire where email exists.

## Household merge check

Household hh_006 has three active pets. If two or more have a reminder inside the 14-day merge window, the client receives one message naming all of them. Verify this by inspecting the send log, not the count table.

## Vaccine note

Vaccine due dates in `vaccine_records.csv` are set per patient, so a patient's rabies and core vaccine fall due on the same day. The engine must group them into one message ("rabies and DAPP"), which is why the vaccine counts above are per patient, not per record.
"""
with open(f"{OUT}/expected-reminders.md", "w") as f:
    f.write(md)

print(json.dumps({"clients": len(clients), "patients": len(patients), "active": len(active), "visits": len(visits), "vaccines": len(vaccines), "prevention": len(prevention),
                  "annual_t30": annual_t30, "annual_t7": annual_t7, "annual_overdue": annual_overdue, "senior_t21": senior_t21, "senior_overdue": senior_overdue,
                  "vac_t30": vac_t30, "vac_overdue": vac_overdue, "prev_due": prev_due, "noshow": noshow, "postop": len(postop), "multi_hh": multi_hh}, indent=1))
