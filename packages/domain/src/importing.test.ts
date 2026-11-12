import { describe, expect, it } from "vitest";
import { missingColumns, normalizeRows, parseDate, parseSpecies, petKey, planImport, type CsvRow } from "./index";

const TODAY = "2026-11-12";
const vaccineTypes = new Map([
  ["rabies_dog", { species: "dog", intervalMonths: 36 }],
  ["fvrcp", { species: "cat", intervalMonths: 12 }],
]);
const client = (over: CsvRow = {}): CsvRow => ({ id: "c1", first_name: "Maria", last_name: "Lopez", mobile: "555-291-3352", ...over });
const pet = (over: CsvRow = {}): CsvRow => ({ id: "p1", client_id: "c1", name: "Penny", species: "dog", ...over });
const plan = (clients: CsvRow[], patients: CsvRow[], vaccines: CsvRow[] = [], existingMobiles = new Map<string, string>(), existingPets = new Map<string, string>()) =>
  planImport({ clients, patients, vaccines, today: TODAY, existingMobiles, existingPets, vaccineTypes });

describe("reading other systems' files", () => {
  it("understands common column names", () => {
    const [row] = normalizeRows([{ "First Name": "Maria", Surname: "Lopez", "Cell Phone": "555", "Client ID": "c1" }], "clients");
    expect(row).toEqual({ first_name: "Maria", last_name: "Lopez", mobile: "555", id: "c1" });
    const [p] = normalizeRows([{ "Pet ID": "p1", "Client ID": "c1", "Pet Name": "Penny", Species: "Canine", DOB: "1/2/20" }], "patients");
    expect(p).toMatchObject({ id: "p1", client_id: "c1", name: "Penny", date_of_birth: "1/2/20" });
    expect(missingColumns([{ id: "1", first_name: "a" }], "clients")).toEqual(["last_name", "mobile"]);
  });

  it("reads US and ISO dates and species words", () => {
    expect(parseDate("2021-04-30")).toBe("2021-04-30");
    expect(parseDate("4/30/2021")).toBe("2021-04-30");
    expect(parseDate("1/2/20")).toBe("2020-01-02");
    expect(() => parseDate("2/30/2021")).toThrow(/not a real date/);
    expect(parseSpecies("Canine")).toBe("dog");
    expect(parseSpecies("Feline")).toBe("cat");
    expect(parseSpecies("dragon")).toBeNull();
  });
});

describe("planning an import", () => {
  it("creates clients and pets, grouping households", () => {
    const p = plan(
      [client({ household_id: "h1" }), client({ id: "c2", first_name: "Luis", mobile: "555-291-3353", household_id: "h1" })],
      [pet(), pet({ id: "p2", client_id: "c2", name: "Milo", species: "Feline" })],
    );
    expect(p.summary).toMatchObject({ clientsNew: 2, patients: 2, errors: 0, skipped: 0 });
    expect(new Set(p.clients.map((c) => c.householdKey)).size).toBe(1);
    expect(p.patients[1]!.patient.species).toBe("cat");
  });

  it("explains each bad row and skips pets whose owner failed", () => {
    const p = plan([client({ mobile: "123" })], [pet()]);
    expect(p.rows).toEqual([
      expect.objectContaining({ file: "clients", rowNumber: 2, outcome: "error", message: expect.stringMatching(/phone/) }),
      expect.objectContaining({ file: "patients", rowNumber: 2, outcome: "skip", message: expect.stringMatching(/Owner "c1"/) }),
    ]);
  });

  it("refuses two clients with the same mobile in one file", () => {
    const p = plan([client(), client({ id: "c2", first_name: "Other" })], []);
    expect(p.rows[1]).toMatchObject({ outcome: "error", message: expect.stringMatching(/Same mobile number as client "c1"/) });
  });

  it("catches impossible pet data", () => {
    const p = plan([client()], [
      pet({ date_of_birth: "2027-01-01" }),
      pet({ id: "p2", species: "dragon" }),
      pet({ id: "p3", date_of_birth: "2022-01-01", last_wellness_exam_at: "2021-06-01" }),
    ]);
    expect(p.rows.filter((r) => r.file === "patients").map((r) => r.message)).toEqual([
      expect.stringMatching(/future/),
      expect.stringMatching(/not a species/),
      expect.stringMatching(/before the date of birth/),
    ]);
  });

  it("matches existing clients and pets so a second import adds nothing twice", () => {
    const existingMobiles = new Map([["+15552913352", "db-c1"]]);
    const existingPets = new Map([[petKey("db-c1", "penny", "dog"), "db-p1"]]);
    const p = plan([client()], [pet(), pet({ id: "p2", name: "Rex" })], [], existingMobiles, existingPets);
    expect(p.summary).toMatchObject({ clientsNew: 0, clientsMatched: 1, patients: 1, patientsMatched: 1 });
    expect(p.patients[0]!.existingId).toBe("db-p1");
  });

  it("checks vaccines against the clinic's list and the pet's species", () => {
    const p = plan([client()], [pet()], [
      { patient_id: "p1", vaccine_id: "rabies_dog", administered_at: "2024-01-10", due_at: "2027-01-10" },
      { patient_id: "p1", vaccine_id: "fvrcp", administered_at: "2024-01-10", due_at: "2025-01-10" },
      { patient_id: "p1", vaccine_id: "made_up", administered_at: "2024-01-10", due_at: "2025-01-10" },
      { patient_id: "p9", vaccine_id: "rabies_dog", administered_at: "2024-01-10", due_at: "2027-01-10" },
    ]);
    const v = p.rows.filter((r) => r.file === "vaccines");
    expect(v.map((r) => r.outcome)).toEqual(["create", "error", "error", "skip"]);
    expect(v[1]!.message).toMatch(/cat vaccine but Penny is a dog/);
    expect(p.vaccines[0]!.intervalMonths).toBe(36);
  });
});
