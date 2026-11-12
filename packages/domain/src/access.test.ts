import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSIONS,
  can,
  ForbiddenError,
  locationsWith,
  PERMISSIONS,
  requirePermission,
  ROLES,
  type Permission,
  type StaffAccess,
} from "./index";

const access = (locations: Record<string, Permission[]>): StaffAccess => ({
  platformUserId: "u1",
  staffUserId: "s1",
  displayName: "Jo",
  locations: new Map(Object.entries(locations).map(([id, perms]) => [id, new Set(perms)])),
});

describe("roles and permissions", () => {
  it("only grants permissions that exist", () => {
    for (const role of Object.values(ROLES)) {
      for (const p of role.permissions) expect(PERMISSIONS).toHaveProperty(p);
    }
  });

  it("gives the owner everything and keeps billing from the manager", () => {
    expect([...ROLES.owner.permissions].sort()).toEqual([...ALL_PERMISSIONS].sort());
    expect(ROLES.manager.permissions).not.toContain("billing.manage");
    expect(ROLES.manager.permissions).toContain("staff.manage");
  });

  it("lets only doctors (and owners, managers) approve controlled-substance refills", () => {
    const holders = Object.entries(ROLES)
      .filter(([, r]) => r.permissions.includes("tasks.controlled_substances"))
      .map(([k]) => k)
      .sort();
    expect(holders).toEqual(["dvm", "manager", "owner"]);
  });

  it("keeps settings, staff and billing away from front-line roles", () => {
    for (const key of ["dvm", "technician", "assistant", "csr"] as const) {
      expect(ROLES[key].permissions).not.toContain("settings.manage");
      expect(ROLES[key].permissions).not.toContain("staff.manage");
      expect(ROLES[key].permissions).not.toContain("billing.manage");
    }
  });

  it("checks permissions per location", () => {
    const a = access({ loc1: ["schedule.manage"], loc2: ["schedule.view"] });
    expect(can(a, "schedule.manage", "loc1")).toBe(true);
    expect(can(a, "schedule.manage", "loc2")).toBe(false);
    expect(can(a, "schedule.view", "loc3")).toBe(false);
    expect(() => requirePermission(a, "schedule.manage", "loc2")).toThrow(ForbiddenError);
    expect(locationsWith(a, "schedule.view")).toEqual(["loc2"]);
  });
});
