import { describe, expect, it } from "vitest";
import { canonicalJson, packFileChecksum } from "./checksum";
import {
  applyLocationOverrides,
  findForbiddenTerms,
  getVeterinaryPack,
  InvalidOverridesError,
  isTaskService,
  label,
  MissingLabelError,
  MissingPlaceholderError,
  PackValidationError,
  placeholdersIn,
  renderTemplate,
  validatePack,
  veterinaryRawPack,
  type RawPack,
} from "./index";

/** Deep copy of the real pack, changed by `mutate`, for negative tests. */
function brokenPack(mutate: (raw: Record<string, any>) => void): RawPack {
  const copy = structuredClone(veterinaryRawPack) as Record<string, any>;
  mutate(copy);
  return copy as RawPack;
}

function issuesOf(raw: RawPack): string[] {
  try {
    validatePack(raw);
  } catch (error) {
    if (error instanceof PackValidationError) return error.issues.map((i) => `${i.file}: ${i.path}: ${i.message}`);
    throw error;
  }
  return [];
}

describe("veterinary pack", () => {
  const pack = getVeterinaryPack();

  it("loads and validates v0.2.2", () => {
    expect(pack.manifest.vertical_id).toBe("veterinary");
    expect(pack.manifest.pack_version).toBe("0.2.2");
    expect(pack.services.services.length).toBe(33);
  });

  it("keeps the v0.2 safety rules", () => {
    expect(pack.triage.classification.when_unsure).toBe("escalate");
    expect(pack.triage.classification.never_lower_level_within_call).toBe(true);
    expect(pack.retention.pre_visit.fasting_check.send_at_local).toBe("19:00");
    expect(pack.retention.inbound_reply_handling.STOP).toBe("opt_out_all_sms");
  });

  it("separates the refill task from bookable services", () => {
    const refill = pack.services.services.find((s) => s.id === "rx_refill_request")!;
    expect(isTaskService(refill)).toBe(true);
    expect(pack.services.services.filter(isTaskService)).toHaveLength(1);
  });

  it("lets assistants and technicians share nail trims and weight checks", () => {
    const byId = Object.fromEntries(pack.services.services.map((s) => [s.id, s]));
    expect(byId.nail_trim).toMatchObject({ provider_role: "technician", also_bookable_by_roles: ["assistant"] });
    expect(byId.weight_check).toMatchObject({ provider_role: "assistant", also_bookable_by_roles: ["technician"] });
  });

  it("can render every retention template once values are supplied", () => {
    for (const [key, template] of Object.entries(pack.retention.templates)) {
      const values = Object.fromEntries(placeholdersIn(template).map((p) => [p, `<${p}>`]));
      expect(() => renderTemplate(template, values), key).not.toThrow();
    }
  });
});

describe("pack validation catches broken packs", () => {
  it("rejects a service pointing at an unknown room type", () => {
    const raw = brokenPack((p) => {
      p.services.services.find((s: any) => s.id === "wellness_exam").room_type = "ballroom";
    });
    expect(issuesOf(raw)).toContainEqual(expect.stringMatching(/wellness_exam.*unknown room type "ballroom"/));
  });

  it("rejects unknown equipment, skills and roles", () => {
    const raw = brokenPack((p) => {
      const spay = p.services.services.find((s: any) => s.id === "spay_canine");
      spay.equipment = ["laser"];
      spay.required_skills = ["juggling"];
      spay.provider_role = "receptionist";
    });
    const issues = issuesOf(raw).join("\n");
    expect(issues).toMatch(/unknown equipment type "laser"/);
    expect(issues).toMatch(/unknown skill "juggling"/);
    expect(issues).toMatch(/unknown provider role "receptionist"/);
  });

  it("rejects a reminder touch using a template that does not exist", () => {
    const raw = brokenPack((p) => {
      p.retention.rules[0].touches[0].template = "nope";
    });
    expect(issuesOf(raw)).toContainEqual(expect.stringMatching(/unknown template "nope"/));
  });

  it("rejects an intake keyword mapped to a missing service", () => {
    const raw = brokenPack((p) => {
      p.intake.reason_for_visit.keyword_to_service[0].service_id = "massage";
    });
    expect(issuesOf(raw)).toContainEqual(expect.stringMatching(/unknown service "massage"/));
  });

  it("refuses to weaken triage safety", () => {
    const raw = brokenPack((p) => {
      p.triage.classification.when_unsure = "continue";
    });
    expect(issuesOf(raw)).toContainEqual(expect.stringMatching(/triage: classification.when_unsure/));
  });

  it("rejects a bad fasting-check time", () => {
    const raw = brokenPack((p) => {
      p.retention.pre_visit.fasting_check.send_at_local = "7pm";
    });
    expect(issuesOf(raw)).toContainEqual(expect.stringMatching(/send_at_local: time must be HH:MM/));
  });

  it("rejects Aesthetix terms anywhere in the pack", () => {
    const raw = brokenPack((p) => {
      p.retention.templates.wellness_due_30 = "Your guest is due at the med spa.";
    });
    const issues = issuesOf(raw).join("\n");
    expect(issues).toMatch(/templates.wellness_due_30: forbidden term "guest"/);
    expect(issues).toMatch(/forbidden term "med spa"/);
  });

  it("requires every file listed in the manifest", () => {
    const raw = brokenPack((p) => {
      delete p.faq;
    });
    expect(issuesOf(raw)).toContainEqual("faq: : file is missing");
  });

  it("rejects files from another vertical", () => {
    const raw = brokenPack((p) => {
      p.brand.vertical_id = "dental";
    });
    expect(issuesOf(raw)).toContainEqual(expect.stringMatching(/brand: vertical_id: expected "veterinary"/));
  });
});

describe("renderTemplate", () => {
  it("fills placeholders", () => {
    expect(renderTemplate("{{clinic_name}}: {{pet_name}} is due.", { clinic_name: "Main", pet_name: "Bella" })).toBe(
      "Main: Bella is due.",
    );
  });

  it("refuses to send text with missing or blank values", () => {
    try {
      renderTemplate("Hi {{client_first_name}}, {{pet_name}} is due.", { client_first_name: " " });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MissingPlaceholderError);
      expect((error as MissingPlaceholderError).missing).toEqual(["client_first_name", "pet_name"]);
    }
  });
});

describe("forbidden terms", () => {
  const terms = getVeterinaryPack().labels.forbidden_terms;

  it("matches whole words only", () => {
    expect(findForbiddenTerms("Book a spay for Bella", terms)).toEqual([]);
    expect(findForbiddenTerms("Welcome to the spa", terms).map((m) => m.term)).toEqual(["spa"]);
  });

  it("prefers the longest phrase and ignores case", () => {
    expect(findForbiddenTerms("Our MED  SPA team", terms).map((m) => m.term)).toEqual(["med  spa"]);
  });
});

describe("labels", () => {
  const pack = getVeterinaryPack();

  it("reads nested labels", () => {
    expect(label(pack, "room_type.treatment")).toBe("Treatment area");
  });

  it("throws on a missing label instead of showing a raw key", () => {
    expect(() => label(pack, "room_type.ballroom")).toThrow(MissingLabelError);
  });
});

describe("location overrides", () => {
  const pack = getVeterinaryPack();

  it("applies allowed changes", () => {
    const resolved = applyLocationOverrides(pack, {
      ai_name: "Sam",
      services: { nail_trim: { price_range_usd: [20, 35] }, telehealth_consult: { enabled: false } },
      retention_rules: { lapsed_client: { enabled: false } },
    });
    expect(resolved.aiName).toBe("Sam");
    expect(resolved.services.services.find((s) => s.id === "nail_trim")).toMatchObject({ price_range_usd: [20, 35] });
    expect(resolved.disabledServices.has("telehealth_consult")).toBe(true);
    expect(resolved.disabledRetentionRules.has("lapsed_client")).toBe(true);
    // The shared pack is not changed.
    expect(pack.services.services.find((s) => s.id === "nail_trim")).toMatchObject({ price_range_usd: [18, 30] });
  });

  it("defaults the AI name to Riley", () => {
    expect(applyLocationOverrides(pack, {}).aiName).toBe("Riley");
  });

  it("never allows triage or script overrides", () => {
    expect(() => applyLocationOverrides(pack, { triage: { when_unsure: "continue" } })).toThrow(InvalidOverridesError);
  });

  it("rejects unknown services and backwards price ranges", () => {
    expect(() => applyLocationOverrides(pack, { services: { botox: { enabled: true } } })).toThrow(/unknown service/);
    expect(() => applyLocationOverrides(pack, { services: { nail_trim: { price_range_usd: [40, 20] } } })).toThrow(
      /low, high/,
    );
  });
});

describe("checksum", () => {
  it("ignores key order", () => {
    expect(packFileChecksum({ a: 1, b: [1, { d: 2, c: 3 }] })).toBe(packFileChecksum({ b: [1, { c: 3, d: 2 }], a: 1 }));
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("changes when content changes", () => {
    expect(packFileChecksum({ a: 1 })).not.toBe(packFileChecksum({ a: 2 }));
  });
});
