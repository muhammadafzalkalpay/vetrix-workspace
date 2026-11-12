// What a clinic may change for one location (stored in
// location_pack_configs.overrides). Kept deliberately small: triage, scripts,
// compliance wording and forbidden terms can never be overridden.
import { z } from "zod";
import { isTaskService, type Pack } from "./schema";

const price = z.tuple([z.number().nonnegative(), z.number().nonnegative()]);

export const locationOverridesSchema = z
  .object({
    ai_name: z.string().trim().min(1).max(40).optional(),
    services: z
      .record(
        z
          .object({
            enabled: z.boolean().optional(),
            bookable_by_ai: z.boolean().optional(),
            duration_min: z.number().int().positive().max(480).optional(),
            price_range_usd: price.optional(),
          })
          .strict(),
      )
      .optional(),
    retention_rules: z.record(z.object({ enabled: z.boolean() }).strict()).optional(),
  })
  .strict();

export type LocationOverrides = z.infer<typeof locationOverridesSchema>;

export interface ResolvedPack extends Pack {
  aiName: string;
  /** Service ids switched off by this location. */
  disabledServices: ReadonlySet<string>;
  disabledRetentionRules: ReadonlySet<string>;
}

export class InvalidOverridesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOverridesError";
  }
}

export function applyLocationOverrides(pack: Pack, rawOverrides: unknown = {}): ResolvedPack {
  const parsed = locationOverridesSchema.safeParse(rawOverrides ?? {});
  if (!parsed.success) {
    throw new InvalidOverridesError(
      parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "),
    );
  }
  const o = parsed.data;
  const serviceIds = new Set(pack.services.services.map((s) => s.id));
  const ruleIds = new Set(pack.retention.rules.map((r) => r.id));
  for (const id of Object.keys(o.services ?? {})) {
    if (!serviceIds.has(id)) throw new InvalidOverridesError(`unknown service "${id}"`);
  }
  for (const id of Object.keys(o.retention_rules ?? {})) {
    if (!ruleIds.has(id)) throw new InvalidOverridesError(`unknown retention rule "${id}"`);
  }

  const services = pack.services.services.map((s) => {
    const change = o.services?.[s.id];
    if (!change || isTaskService(s)) return s;
    const next = { ...s };
    if (change.bookable_by_ai !== undefined) next.bookable_by_ai = change.bookable_by_ai;
    if (change.duration_min !== undefined) next.duration_min = change.duration_min;
    if (change.price_range_usd) {
      const [lo, hi] = change.price_range_usd;
      if (lo > hi) throw new InvalidOverridesError(`price range for "${s.id}" must be [low, high]`);
      next.price_range_usd = change.price_range_usd;
    }
    return next;
  });

  const disabledServices = new Set(
    Object.entries(o.services ?? {})
      .filter(([, c]) => c.enabled === false)
      .map(([id]) => id),
  );
  const disabledRetentionRules = new Set(
    Object.entries(o.retention_rules ?? {})
      .filter(([, c]) => !c.enabled)
      .map(([id]) => id),
  );

  return {
    ...pack,
    services: { ...pack.services, services },
    aiName: o.ai_name ?? pack.brand.ai_persona.default_name,
    disabledServices,
    disabledRetentionRules,
  };
}
