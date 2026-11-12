import { describe, expect, it, vi } from "vitest";
import { getVeterinaryPack } from "@vetrix/pack";
import { createTenantRouter, TenantNotFoundError, TenantUnavailableError } from "./router";
import { parseCsv } from "./seed/csv";
import { parseSchedule, serviceForSpecies } from "./seed/sample-clinic";
import type { TenantDatabase } from "./tenants";

const tenant = (over: Partial<TenantDatabase> = {}): TenantDatabase => ({
  id: "td1",
  organization_id: "org1",
  organization_slug: "sample",
  database_ref: "env:CLINIC_A",
  region: "aws-us-east-1",
  schema_version: "002_clinic",
  status: "active",
  ...over,
});

function setup(rows: Record<string, TenantDatabase | undefined>) {
  let clock = 0;
  const lookup = vi.fn(async (org: string) => rows[org]);
  const created: string[] = [];
  const router = createTenantRouter({
    lookup,
    createPool: (url) => {
      created.push(url);
      return { url, end: vi.fn(async () => undefined) };
    },
    env: { CLINIC_A: "postgresql://u:p@a/clinic_a", CLINIC_B: "postgresql://u:p@b/clinic_b" },
    ttlMs: 1000,
    now: () => clock,
  });
  return { router, lookup, created, tick: (ms: number) => (clock += ms) };
}

describe("tenant router", () => {
  it("routes an organization to its own database and reuses the pool", async () => {
    const { router, lookup, created } = setup({ sample: tenant() });
    const first = await router.clinicPool("sample");
    const second = await router.clinicPool("sample");
    expect(first.pool).toBe(second.pool);
    expect(created).toEqual(["postgresql://u:p@a/clinic_a"]);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("keeps two organizations on separate databases", async () => {
    const { router } = setup({
      a: tenant({ organization_slug: "a" }),
      b: tenant({ organization_slug: "b", database_ref: "env:CLINIC_B" }),
    });
    const a = await router.clinicPool("a");
    const b = await router.clinicPool("b");
    expect(a.pool).not.toBe(b.pool);
  });

  it("looks the tenant up again after the cache expires", async () => {
    const { router, lookup, tick } = setup({ sample: tenant() });
    await router.clinicPool("sample");
    tick(1001);
    await router.clinicPool("sample");
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("refuses unknown and suspended organizations", async () => {
    const { router } = setup({ paused: tenant({ status: "suspended" }) });
    await expect(router.clinicPool("nobody")).rejects.toBeInstanceOf(TenantNotFoundError);
    await expect(router.clinicPool("paused")).rejects.toBeInstanceOf(TenantUnavailableError);
  });

  it("closes every pool", async () => {
    const { router } = setup({ sample: tenant() });
    const { pool } = await router.clinicPool("sample");
    await router.close();
    expect(pool.end).toHaveBeenCalled();
  });
});

describe("sample data helpers", () => {
  it("parses CSV with quotes and CRLF", () => {
    expect(parseCsv('id,name\r\n1,"Smith, Jo"\r\n2,"say ""hi"""\r\n')).toEqual([
      { id: "1", name: "Smith, Jo" },
      { id: "2", name: 'say "hi"' },
    ]);
  });

  it("rejects rows with the wrong number of fields", () => {
    expect(() => parseCsv("a,b\n1,2,3\n")).toThrow(/row 2/);
  });

  it("turns a schedule into weekday rows (0 = Sunday)", () => {
    expect(parseSchedule("Tue-Sat 08:00-18:00").map((r) => r.weekday)).toEqual([2, 3, 4, 5, 6]);
    expect(() => parseSchedule("weekdays")).toThrow();
  });

  it("maps a canine surgery on a cat to the feline service", () => {
    const pack = getVeterinaryPack();
    expect(serviceForSpecies(pack, "spay_canine", "cat", "female")).toBe("spay_feline");
    expect(serviceForSpecies(pack, "spay_canine", "cat", "male")).toBe("neuter_feline");
    expect(serviceForSpecies(pack, "spay_canine", "dog", "female")).toBe("spay_canine");
  });
});
