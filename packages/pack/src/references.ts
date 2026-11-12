// Checks links between pack files. A typo such as a service pointing at a
// room type that does not exist would otherwise only show up as a booking
// that can never be made.
import { findLabel } from "./labels";
import { scanForForbiddenTerms } from "./forbidden";
import { placeholdersIn } from "./render";
import { isTaskService, type Pack } from "./schema";

/** Special books_service values resolved at run time instead of a service id. */
export const DYNAMIC_SERVICE_REFS = new Set(["same_as_missed_appointment"]);

export interface PackIssue {
  file: string;
  path: string;
  message: string;
}

export function checkReferences(pack: Pack): PackIssue[] {
  const issues: PackIssue[] = [];
  const add = (file: string, path: string, message: string) => issues.push({ file, path, message });

  const ids = <T extends { id: string }>(items: T[]) => new Set(items.map((i) => i.id));
  const dupes = (file: string, path: string, items: { id: string }[]) => {
    const seen = new Set<string>();
    for (const { id } of items) {
      if (seen.has(id)) add(file, path, `duplicate id "${id}"`);
      seen.add(id);
    }
  };
  const mustExist = (file: string, path: string, value: string, set: Set<string>, what: string) => {
    if (!set.has(value)) add(file, path, `unknown ${what} "${value}"`);
  };

  const { labels, services, resources, intake, triage, retention, faq, brand, manifest } = pack;

  // Every file belongs to the same vertical.
  for (const key of manifest.files) {
    if (pack[key].vertical_id !== manifest.vertical_id) {
      add(key, "vertical_id", `expected "${manifest.vertical_id}", found "${pack[key].vertical_id}"`);
    }
  }

  const species = new Set(Object.keys((labels.labels.species as Record<string, string>) ?? {}));
  const serviceIds = ids(services.services);
  const categoryIds = ids(services.categories);
  const roomTypes = ids(resources.room_types);
  const equipmentTypes = ids(resources.equipment_types);
  const roles = ids(resources.provider_roles);
  const skills = ids(resources.skills);
  const ruleIds = ids(retention.rules);
  const templates = new Set(Object.keys(retention.templates));

  dupes("services", "services", services.services);
  dupes("resources", "room_types", resources.room_types);
  dupes("resources", "equipment_types", resources.equipment_types);
  dupes("resources", "provider_roles", resources.provider_roles);
  dupes("resources", "skills", resources.skills);
  dupes("retention", "rules", retention.rules);
  dupes("retention", "vaccines", retention.vaccines);
  dupes("faq", "entries", faq.entries);
  dupes("triage", "triggers", [...triage.emergency_triggers, ...triage.urgent_triggers]);

  // services.json
  services.services.forEach((s, i) => {
    const p = `services.${i}(${s.id})`;
    mustExist("services", `${p}.category`, s.category, categoryIds, "category");
    s.species.forEach((sp) => mustExist("services", `${p}.species`, sp, species, "species"));
    if (isTaskService(s)) return;
    mustExist("services", `${p}.provider_role`, s.provider_role, roles, "provider role");
    s.also_bookable_by_roles?.forEach((r) =>
      mustExist("services", `${p}.also_bookable_by_roles`, r, roles, "provider role"),
    );
    if (s.room_type !== null) mustExist("services", `${p}.room_type`, s.room_type, roomTypes, "room type");
    s.equipment.forEach((e) => mustExist("services", `${p}.equipment`, e, equipmentTypes, "equipment type"));
    s.required_skills.forEach((k) => mustExist("services", `${p}.required_skills`, k, skills, "skill"));
    if (s.follow_up_rule) mustExist("services", `${p}.follow_up_rule`, s.follow_up_rule, ruleIds, "retention rule");
    if (s.fallback_service_if_prerequisite_fails) {
      mustExist("services", `${p}.fallback_service_if_prerequisite_fails`, s.fallback_service_if_prerequisite_fails, serviceIds, "service");
    }
    if (s.fasting_required && s.room_type === null) add("services", p, "fasting service needs a room");
  });

  // resources.json
  for (const [list, items] of [
    ["room_types", resources.room_types],
    ["provider_roles", resources.provider_roles],
  ] as const) {
    items.forEach((item, i) => {
      if (findLabel(labels.labels, item.label_key) === undefined) {
        add("resources", `${list}.${i}.label_key`, `label "${item.label_key}" not found in labels.json`);
      }
    });
  }
  resources.skills.forEach((k, i) =>
    k.roles.forEach((r) => mustExist("resources", `skills.${i}.roles`, r, roles, "provider role")),
  );
  const d = resources.defaults_two_doctor_clinic;
  d.rooms.forEach((r, i) => mustExist("resources", `defaults.rooms.${i}`, r.type, roomTypes, "room type"));
  d.equipment.forEach((e, i) => mustExist("resources", `defaults.equipment.${i}`, e.type, equipmentTypes, "equipment type"));
  d.team.forEach((t, i) => mustExist("resources", `defaults.team.${i}`, t.role, roles, "provider role"));

  // intake.json
  const rfv = intake.reason_for_visit;
  rfv.keyword_to_service.forEach((k, i) => {
    mustExist("intake", `keyword_to_service.${i}.service_id`, k.service_id, serviceIds, "service");
    if (k.override_to) {
      mustExist("intake", `keyword_to_service.${i}.override_to.service_id`, k.override_to.service_id, serviceIds, "service");
    }
  });
  for (const key of ["problem_default", "routine_default", "new_patient_routine_default"] as const) {
    mustExist("intake", `default_by_type.${key}`, rfv.default_by_type[key], serviceIds, "service");
  }

  // triage.json
  mustExist("triage", "levels.urgent.service_id", triage.levels.urgent.service_id, serviceIds, "service");
  mustExist("triage", "levels.urgent.fallback_if_no_slot", triage.levels.urgent.fallback_if_no_slot, serviceIds, "service");

  // retention.json
  retention.rules.forEach((r, i) => {
    const p = `rules.${i}(${r.id})`;
    if (r.books_service !== null && !DYNAMIC_SERVICE_REFS.has(r.books_service)) mustExist("retention", `${p}.books_service`, r.books_service, serviceIds, "service");
    if (r.merge_into) mustExist("retention", `${p}.merge_into`, r.merge_into, ruleIds, "retention rule");
    r.species?.forEach((sp) => mustExist("retention", `${p}.species`, sp, species, "species"));
    r.touches.forEach((t, j) => mustExist("retention", `${p}.touches.${j}.template`, t.template, templates, "template"));
  });
  retention.household_merge.applies_to_rules.forEach((r, i) =>
    mustExist("retention", `household_merge.applies_to_rules.${i}`, r, ruleIds, "retention rule"),
  );
  retention.vaccines.forEach((v, i) =>
    v.species.forEach((sp) => mustExist("retention", `vaccines.${i}.species`, sp, species, "species")),
  );
  mustExist("retention", "pre_visit.fasting_check.template", retention.pre_visit.fasting_check.template, templates, "template");
  for (const [key, text] of Object.entries(retention.templates)) {
    if (/\{\{(?![\s\w]+\}\})/.test(text)) add("retention", `templates.${key}`, "malformed {{placeholder}}");
    if (placeholdersIn(text).length === 0 && text.includes("{{")) add("retention", `templates.${key}`, "unparsed placeholder");
  }

  // brand.json: every bookable room type has a calendar lane colour.
  for (const room of resources.room_types) {
    if (room.bookable && !brand.room_lane_colors[room.id]) {
      add("brand", `room_lane_colors.${room.id}`, "missing lane colour for room type");
    }
  }

  // No Aesthetix terms anywhere in the pack.
  const files = Object.fromEntries(manifest.files.map((k) => [k, pack[k]]));
  for (const v of scanForForbiddenTerms(files, labels.forbidden_terms)) {
    add(v.file, v.path, `forbidden term "${v.term}"`);
  }

  return issues;
}
