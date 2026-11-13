// The staff navigation. Each item shows only when the person holds its
// permission at the location they are working in.
import {
  BarChart3,
  BellRing,
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  MessageSquareText,
  PawPrint,
  PhoneCall,
  Settings,
  UserRoundCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@vetrix/domain";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Omitted: every staff member sees it. */
  permission?: Permission;
  /** Words people may type in ⌘K to find this page. */
  keywords?: string[];
  /** Not shown in the menu or ⌘K for now (the page still works by its address). */
  hidden?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: "Today",
    items: [
      { href: "/overview", label: "Overview", icon: LayoutDashboard, keywords: ["home", "dashboard", "today"] },
      { href: "/schedule", label: "Schedule", icon: CalendarDays, permission: "schedule.view", keywords: ["calendar", "appointments", "book"] },
      { href: "/tasks", label: "Tasks", icon: ClipboardList, permission: "tasks.view", keywords: ["to do", "follow up"] },
    ],
  },
  {
    label: "Clients & pets",
    items: [
      { href: "/clients", label: "Clients", icon: Users, permission: "clients.view", keywords: ["owners", "households"] },
      { href: "/patients", label: "Patients", icon: PawPrint, permission: "patients.view", keywords: ["pets", "animals", "dogs", "cats"] },
    ],
  },
  {
    label: "Communication",
    items: [
      { href: "/calls", label: "Calls", icon: PhoneCall, permission: "calls.view", keywords: ["phone", "triage", "recordings"] },
      { href: "/messages", label: "Messages", icon: MessageSquareText, permission: "messages.view", keywords: ["texts", "sms", "email"] },
      { href: "/reminders", label: "Reminders", icon: BellRing, permission: "reminders.manage", keywords: ["due", "recalls", "vaccines"] },
    ],
  },
  {
    label: "Clinic",
    items: [
      { href: "/reports", label: "Reports", icon: BarChart3, permission: "reports.view", keywords: ["numbers", "analytics"] },
      { href: "/team", label: "Team", icon: UserRoundCog, permission: "staff.manage", keywords: ["staff", "roles", "invite"] },
      { href: "/settings", label: "Settings", icon: Settings, permission: "settings.manage", keywords: ["hours", "services", "holidays", "policies", "quiet hours"] },
    ],
  },
];

/** Bottom tabs on phones: the four most used places, then "More". */
export const MOBILE_TABS = ["/overview", "/schedule", "/clients", "/messages"];

export function visibleNav(permissions: ReadonlySet<Permission>): NavGroup[] {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.hidden && (!i.permission || permissions.has(i.permission))) })).filter(
    (g) => g.items.length > 0,
  );
}

export function findNavItem(pathname: string): NavItem | undefined {
  return NAV.flatMap((g) => g.items).find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
}

/**
 * Matches words, not scattered letters: "pets" finds Patients (keyword "pets")
 * but not Schedule. Page names that start with the search rank first.
 */
export function pageFilter(value: string, search: string, keywords: string[] = []): number {
  const q = search.trim().toLowerCase();
  if (!q) return 1;
  const name = value.toLowerCase();
  if (name.startsWith(q)) return 1;
  const words = [name, ...keywords.map((k) => k.toLowerCase())].join(" ").split(/\s+/);
  if (words.some((w) => w.startsWith(q))) return 0.8;
  return [name, ...keywords].join(" ").toLowerCase().includes(q) ? 0.4 : 0;
}
