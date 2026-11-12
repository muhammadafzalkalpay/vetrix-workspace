// Who may do what. Roles are assigned per location, so a person can be a
// doctor at one clinic and a manager at another. Screens and route handlers
// ask `requirePermission`; they never check role names themselves.
import { ForbiddenError } from "./errors";

export const PERMISSIONS = {
  "schedule.view": "See the appointment calendar",
  "schedule.manage": "Book, move and cancel appointments",
  "clients.view": "See clients and their contact details",
  "clients.manage": "Add and edit clients and households",
  "patients.view": "See pets and their history",
  "patients.manage": "Add and edit pets, vaccines and prevention",
  "calls.view": "See calls, transcripts and triage results",
  "calls.listen": "Play call recordings",
  "messages.view": "See texts and emails",
  "messages.send": "Send texts and emails to clients",
  "tasks.view": "See staff tasks",
  "tasks.manage": "Assign and complete staff tasks",
  "tasks.controlled_substances": "Approve controlled-substance refill requests",
  "reminders.manage": "Run and pause reminders and recalls",
  "reports.view": "See reports",
  "settings.manage": "Change clinic hours, services, rooms and AI settings",
  "staff.manage": "Invite staff and change their roles",
  "billing.manage": "Manage the subscription and invoices",
  "audit.view": "See the audit log",
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export type RoleKey = "owner" | "manager" | "dvm" | "technician" | "assistant" | "csr";

const ALL_BUT = (...excluded: Permission[]) => ALL_PERMISSIONS.filter((p) => !excluded.includes(p));

/** Default roles created in every clinic database. */
export const ROLES: Record<RoleKey, { label: string; permissions: readonly Permission[] }> = {
  owner: { label: "Owner", permissions: ALL_PERMISSIONS },
  manager: { label: "Practice manager", permissions: ALL_BUT("billing.manage") },
  dvm: {
    label: "Doctor",
    permissions: [
      "schedule.view", "schedule.manage", "clients.view", "clients.manage", "patients.view",
      "patients.manage", "calls.view", "calls.listen", "messages.view", "messages.send",
      "tasks.view", "tasks.manage", "tasks.controlled_substances", "reports.view",
    ],
  },
  technician: {
    label: "Technician",
    permissions: [
      "schedule.view", "schedule.manage", "clients.view", "patients.view", "patients.manage",
      "calls.view", "messages.view", "messages.send", "tasks.view", "tasks.manage",
    ],
  },
  assistant: {
    label: "Assistant",
    permissions: ["schedule.view", "clients.view", "patients.view", "messages.view", "tasks.view", "tasks.manage"],
  },
  csr: {
    label: "Client service",
    permissions: [
      "schedule.view", "schedule.manage", "clients.view", "clients.manage", "patients.view",
      "calls.view", "calls.listen", "messages.view", "messages.send", "tasks.view", "tasks.manage",
      "reminders.manage",
    ],
  },
};

export const ROLE_KEYS = Object.keys(ROLES) as RoleKey[];

export function isRoleKey(value: string): value is RoleKey {
  return value in ROLES;
}

/** What a signed-in staff member may do, per location they work at. */
export interface StaffAccess {
  platformUserId: string;
  staffUserId: string;
  displayName: string;
  /** locationId -> permissions there */
  locations: Map<string, ReadonlySet<Permission>>;
}

export function can(access: StaffAccess, permission: Permission, locationId: string): boolean {
  return access.locations.get(locationId)?.has(permission) ?? false;
}

/** Throws ForbiddenError unless the person holds the permission at that location. */
export function requirePermission(access: StaffAccess, permission: Permission, locationId: string): void {
  if (!can(access, permission, locationId)) throw new ForbiddenError();
}

/** Locations where the person holds the permission, e.g. for a location switcher. */
export function locationsWith(access: StaffAccess, permission: Permission): string[] {
  return [...access.locations].filter(([, perms]) => perms.has(permission)).map(([id]) => id);
}
