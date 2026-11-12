// Shape of each pack file. Fields the platform relies on are typed and
// required. Extra fields are kept (passthrough) so a pack can carry notes and
// new optional settings without a code change.
import { z } from "zod";

const id = z.string().regex(/^[a-z0-9_]+$/, "ids use lowercase letters, digits and _");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time must be HH:MM");
const window = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/);
const nonEmpty = z.string().min(1);

export const manifestSchema = z.object({
  vertical_id: id,
  pack_version: z.string().regex(/^\d+\.\d+\.\d+$/, "pack_version must be semver"),
  schema_version: z.number().int().positive(),
  files: z.array(z.enum(["labels", "services", "resources", "intake", "triage", "retention", "faq", "brand"])),
});

// labels.json: nested strings, e.g. labels.provider_role.dvm
type LabelTree = { [key: string]: string | LabelTree };
const labelTree: z.ZodType<LabelTree> = z.lazy(() => z.record(z.union([nonEmpty, labelTree])));

export const labelsSchema = z
  .object({
    vertical_id: id,
    product_name: nonEmpty,
    locale: nonEmpty,
    labels: labelTree,
    forbidden_terms: z.array(nonEmpty).min(1),
  })
  .passthrough();

const bookableService = z
  .object({
    id,
    name: nonEmpty,
    category: id,
    type: z.undefined().optional(),
    species: z.array(id).min(1),
    duration_min: z.number().int().positive(),
    buffer_before_min: z.number().int().nonnegative().optional(),
    buffer_after_min: z.number().int().nonnegative(),
    provider_role: id,
    also_bookable_by_roles: z.array(id).optional(),
    required_skills: z.array(id),
    room_type: id.nullable(),
    equipment: z.array(id),
    requires_doctor_on_premises: z.boolean(),
    drop_off: z.boolean(),
    drop_off_window: window.optional(),
    fasting_required: z.boolean(),
    requires_preop_bloodwork: z.boolean(),
    prerequisites: z.record(z.unknown()),
    price_range_usd: z.tuple([z.number().nonnegative(), z.number().nonnegative()]),
    bookable_by_ai: z.boolean(),
    follow_up_rule: id.optional(),
    fallback_service_if_prerequisite_fails: id.optional(),
    what_to_bring: z.array(id),
  })
  .passthrough()
  .refine((s) => s.price_range_usd[0] <= s.price_range_usd[1], {
    message: "price_range_usd must be [low, high]",
  });

// Not booked on the calendar; the AI creates a staff task instead.
const taskService = z
  .object({
    id,
    name: nonEmpty,
    category: id,
    type: z.literal("task"),
    species: z.array(id).min(1),
    bookable_by_ai: z.literal(false),
    ai_action: id,
  })
  .passthrough();

export const serviceSchema = z.union([taskService, bookableService]);

export const servicesSchema = z
  .object({
    vertical_id: id,
    currency: z.string().length(3),
    categories: z.array(z.object({ id, name: nonEmpty })).min(1),
    services: z.array(serviceSchema).min(1),
  })
  .passthrough();

export const resourcesSchema = z
  .object({
    vertical_id: id,
    room_types: z.array(
      z
        .object({
          id,
          label_key: nonEmpty,
          bookable: z.boolean(),
          default_count: z.number().int().nonnegative(),
          capacity: z.number().int().positive().optional(),
        })
        .passthrough(),
    ),
    equipment_types: z.array(
      z
        .object({ id, name: nonEmpty, default_count: z.number().int().nonnegative(), exclusive: z.boolean() })
        .passthrough(),
    ),
    provider_roles: z.array(
      z
        .object({
          id,
          label_key: nonEmpty,
          bookable_default: z.boolean(),
          can_perform: z.array(id),
          counts_as_doctor_on_premises: z.boolean(),
          requires_doctor_on_premises_for: z.array(id).optional(),
        })
        .passthrough(),
    ),
    skills: z.array(z.object({ id, name: nonEmpty, roles: z.array(id).min(1) }).passthrough()),
    defaults_two_doctor_clinic: z.object({
      rooms: z.array(z.object({ type: id, name: nonEmpty })),
      equipment: z.array(z.object({ type: id, count: z.number().int().positive() })),
      team: z.array(z.object({ role: id, count: z.number().int().positive() })),
    }),
    scheduling_rules: z
      .object({
        slot_granularity_min: z.number().int().positive(),
        default_buffer_min: z.number().int().nonnegative(),
        temperament_buffer_min: z.number().int().nonnegative(),
        surgery_drop_off_window: window,
        surgery_pickup_window: window,
        preop_bloodwork_valid_days: z.number().int().positive(),
      })
      .passthrough(),
  })
  .passthrough();

export const intakeSchema = z
  .object({
    vertical_id: id,
    reason_for_visit: z
      .object({
        mapping_order: z.array(id).min(1),
        default_by_type: z
          .object({
            problem_words: z.array(nonEmpty),
            problem_default: id,
            routine_default: id,
            new_patient_routine_default: id,
          })
          .passthrough(),
        keyword_to_service: z.array(
          z
            .object({
              service_id: id,
              keywords: z.array(nonEmpty).min(1),
              // Switch to another service when the caller also mentions a
              // problem, e.g. ear cleaning + "discharge" becomes a sick visit.
              override_to: z
                .object({ service_id: id, if_keywords: z.array(nonEmpty).min(1) })
                .passthrough()
                .optional(),
            })
            .passthrough(),
        ),
      })
      .passthrough(),
    slot_offer: z.object({ count: z.number().int().positive() }).passthrough(),
  })
  .passthrough();

const trigger = z.object({ id, name: nonEmpty, phrases: z.array(nonEmpty).min(1) }).passthrough();

export const triageSchema = z
  .object({
    vertical_id: id,
    evaluate_on: z.literal("every_caller_utterance"),
    classification: z
      .object({
        method: nonEmpty,
        phrases_are: nonEmpty,
        exclude_known_pet_names: z.boolean(),
        when_unsure: z.literal("escalate"),
        never_lower_level_within_call: z.literal(true),
      })
      .passthrough(),
    levels: z
      .object({
        emergency: z.object({ transfer_summary_template: nonEmpty }).passthrough(),
        urgent: z.object({ service_id: id, fallback_if_no_slot: id }).passthrough(),
        routine: z.object({}).passthrough(),
      })
      .passthrough(),
    emergency_triggers: z.array(trigger).min(1),
    urgent_triggers: z.array(trigger).min(1),
    scripts: z.record(nonEmpty),
  })
  .passthrough();

const touch = z
  .object({
    offset_days: z.number().int().optional(),
    offset_hours: z.number().int().optional(),
    channels: z.array(z.enum(["sms", "email", "ai_call"])).min(1),
    template: id,
  })
  .passthrough()
  .refine((t) => (t.offset_days === undefined) !== (t.offset_hours === undefined), {
    message: "a touch needs exactly one of offset_days or offset_hours",
  });

export const retentionSchema = z
  .object({
    vertical_id: id,
    engine: z
      .object({
        run_daily_at_local: hhmm,
        household_merge_window_days: z.number().int().positive(),
        quiet_hours_local: z.object({ start: hhmm, end: hhmm }),
        max_touches_per_rule: z.number().int().positive(),
      })
      .passthrough(),
    vaccines: z.array(
      z
        .object({
          id,
          name: nonEmpty,
          species: z.array(id).min(1),
          interval_months_options: z.array(z.number().int().positive()).min(1),
          default_interval_months: z.number().int().positive(),
          core: z.boolean(),
        })
        .passthrough(),
    ),
    rules: z.array(
      z
        .object({
          id,
          name: nonEmpty,
          species: z.array(id).optional(),
          trigger: nonEmpty,
          // null for rules that create a task instead of a booking (refills).
          books_service: id.nullable(),
          merge_into: id.optional(),
          touches: z.array(touch).min(1),
        })
        .passthrough(),
    ),
    household_merge: z.object({ applies_to_rules: z.array(id) }).passthrough(),
    templates: z.record(nonEmpty),
    inbound_reply_handling: z.record(z.unknown()),
    pre_visit: z.object({
      fasting_check: z
        .object({ send_at_local: hhmm, reply_by_local: hhmm, template: id })
        .passthrough(),
    }),
  })
  .passthrough();

export const faqSchema = z
  .object({
    vertical_id: id,
    entries: z.array(
      z
        .object({
          id,
          question_variants: z.array(nonEmpty).min(1),
          answer: nonEmpty,
          settings: z.array(id),
          ai_can_answer: z.boolean(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

export const brandSchema = z
  .object({
    vertical_id: id,
    product_name: nonEmpty,
    ai_persona: z.object({ default_name: nonEmpty, clinic_can_rename: z.boolean() }).passthrough(),
    colors: z.record(z.object({ token: z.string().startsWith("--"), hex }).passthrough()),
    room_lane_colors: z.record(hex),
  })
  .passthrough();

export const packFileSchemas = {
  labels: labelsSchema,
  services: servicesSchema,
  resources: resourcesSchema,
  intake: intakeSchema,
  triage: triageSchema,
  retention: retentionSchema,
  faq: faqSchema,
  brand: brandSchema,
} as const;

export type PackFileKey = keyof typeof packFileSchemas;
export const PACK_FILE_KEYS = Object.keys(packFileSchemas) as PackFileKey[];

export type Manifest = z.infer<typeof manifestSchema>;
export type Service = z.infer<typeof serviceSchema>;
export type BookableService = z.infer<typeof bookableService>;
export type TaskService = z.infer<typeof taskService>;

export interface Pack {
  manifest: Manifest;
  labels: z.infer<typeof labelsSchema>;
  services: z.infer<typeof servicesSchema>;
  resources: z.infer<typeof resourcesSchema>;
  intake: z.infer<typeof intakeSchema>;
  triage: z.infer<typeof triageSchema>;
  retention: z.infer<typeof retentionSchema>;
  faq: z.infer<typeof faqSchema>;
  brand: z.infer<typeof brandSchema>;
}

export function isTaskService(service: Service): service is TaskService {
  return (service as TaskService).type === "task";
}
