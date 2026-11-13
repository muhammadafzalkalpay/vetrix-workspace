import { describe, expect, it } from "vitest";
import { describeUrl, neonRegionFromUrl, resolveDatabaseRef } from "./database-ref";
import { checksumOf, loadMigrations, MigrationError, planMigrations, type Migration } from "./migrations";

const url = "postgresql://user:secret@ep-mute-night-bb4ew5ht-pooler.c-15.us-east-1.aws.neon.tech/clinic_dev?sslmode=require";

describe("database_ref", () => {
  it("reads env: refs", () => {
    expect(resolveDatabaseRef("env:CLINIC_X", { CLINIC_X: url })).toBe(url);
  });

  it("explains missing or unknown refs", () => {
    expect(() => resolveDatabaseRef("env:NOPE", {})).toThrow(/NOPE .* is not set/);
    expect(() => resolveDatabaseRef("vault:x", {})).toThrow(/must look like/);
    expect(() => resolveDatabaseRef("env:BAD", { BAD: "mysql://x" })).toThrow(/postgresql/);
  });

  it("finds the Neon region and never prints the password", () => {
    expect(neonRegionFromUrl(url)).toBe("aws-us-east-1");
    expect(describeUrl(url)).toBe("ep-mute-night-bb4ew5ht-pooler.c-15.us-east-1.aws.neon.tech/clinic_dev");
    expect(describeUrl(url)).not.toContain("secret");
  });
});

describe("migration files", () => {
  it("loads the registry and clinic files in order", () => {
    expect(loadMigrations("registry").map((m) => m.version)).toEqual(["001_registry", "003_auth", "005_phone_numbers"]);
    expect(loadMigrations("clinic").map((m) => m.version)).toEqual(["002_clinic", "004_front_desk", "006_messages", "007_jobs_and_replies"]);
  });

  it("uses version numbers only once across both folders", () => {
    const numbers = [...loadMigrations("registry"), ...loadMigrations("clinic")].map((m) => m.version.slice(0, 3));
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});

describe("planMigrations", () => {
  const m = (version: string, sql = `-- ${version}`): Migration => ({ version, sql, checksum: checksumOf(sql) });
  const files = [m("002_clinic"), m("004_next")];

  it("runs everything on an empty database", () => {
    expect(planMigrations("clinic", files, [], []).map((f) => f.version)).toEqual(["002_clinic", "004_next"]);
  });

  it("runs only what is new", () => {
    const applied = [{ version: "002_clinic", checksum: files[0]!.checksum }];
    expect(planMigrations("clinic", files, applied, ["patients"]).map((f) => f.version)).toEqual(["004_next"]);
  });

  it("refuses the wrong kind of database", () => {
    expect(() => planMigrations("clinic", files, [], ["tenant_databases"])).toThrow(/registry database/);
    expect(() => planMigrations("registry", files, [], ["patients"])).toThrow(/clinic database/);
  });

  it("refuses a half-built database with no record", () => {
    expect(() => planMigrations("clinic", files, [], ["locations", "clients"])).toThrow(MigrationError);
  });

  it("refuses a file that changed after it ran", () => {
    const applied = [{ version: "002_clinic", checksum: "old" }];
    expect(() => planMigrations("clinic", files, applied, ["patients"])).toThrow(/changed after it was applied/);
  });

  it("refuses when an applied file is missing", () => {
    const applied = [{ version: "003_gone", checksum: "x" }];
    expect(() => planMigrations("clinic", files, applied, ["patients"])).toThrow(/file is missing/);
  });
});
