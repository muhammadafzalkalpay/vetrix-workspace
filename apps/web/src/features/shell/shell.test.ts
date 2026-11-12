import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, ROLES, type Permission } from "@vetrix/domain";
import { findNavItem, MOBILE_TABS, NAV, pageFilter, visibleNav } from "./nav";

const labels = (perms: readonly Permission[]) =>
  visibleNav(new Set(perms)).flatMap((g) => g.items.map((i) => i.label));

describe("navigation", () => {
  it("shows the owner every page", () => {
    expect(labels(ALL_PERMISSIONS)).toHaveLength(NAV.flatMap((g) => g.items).length);
  });

  it("hides clinic admin pages from front-line roles", () => {
    for (const role of ["dvm", "technician", "assistant", "csr"] as const) {
      const seen = labels(ROLES[role].permissions);
      expect(seen).toContain("Overview");
      expect(seen).not.toContain("Settings");
      expect(seen).not.toContain("Team");
    }
  });

  it("drops a group when none of its pages are allowed", () => {
    const groups = visibleNav(new Set(ROLES.assistant.permissions)).map((g) => g.label);
    expect(groups).not.toContain("Clinic");
  });

  it("only uses real pages for the phone tabs", () => {
    for (const href of MOBILE_TABS) expect(findNavItem(href)?.href).toBe(href);
    expect(findNavItem("/clients/123")?.label).toBe("Clients");
  });
});

describe("search matching", () => {
  it("matches words and keywords, not scattered letters", () => {
    expect(pageFilter("Patients", "pets", ["pets", "animals"])).toBeGreaterThan(0);
    expect(pageFilter("Schedule", "pets", ["calendar", "appointments", "book"])).toBe(0);
    expect(pageFilter("Calls", "pets", ["phone", "triage", "recordings"])).toBe(0);
  });

  it("ranks names that start with the search first", () => {
    expect(pageFilter("Clients", "cli", ["owners"])).toBeGreaterThan(pageFilter("Calls", "rec", ["recordings"]));
  });
});
