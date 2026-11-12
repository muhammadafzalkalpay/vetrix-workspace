"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Command } from "cmdk";
import * as Dialog from "@radix-ui/react-dialog";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Building2, Check, ChevronsUpDown, LogOut, MapPin, Menu as MenuIcon, Search, X } from "lucide-react";
import type { Permission } from "@vetrix/domain";
import { BrandBackdrop, LogoOnDark } from "@/components/vetrix/brand-backdrop";
import { Logo } from "@/components/vetrix/logo";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { chooseLocation } from "./actions";
import { findNavItem, MOBILE_TABS, pageFilter, visibleNav, type NavGroup } from "./nav";

export interface ShellProps {
  user: { name: string; email: string };
  organization: { id: string; name: string };
  organizationCount: number;
  location: { id: string; name: string };
  locations: { id: string; name: string }[];
  permissions: Permission[];
  sandbox: boolean;
  children: React.ReactNode;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({
  groups,
  pathname,
  onNavigate,
  dark = false,
}: {
  groups: NavGroup[];
  pathname: string;
  onNavigate?: () => void;
  /** On the navy sidebar. */
  dark?: boolean;
}) {
  return (
    <nav aria-label="Main" className="grid gap-6">
      {groups.map((group) => (
        <div key={group.label} className="grid gap-1">
          <p className={cn("px-3 pb-1 text-caption font-semibold uppercase tracking-wider", dark ? "text-white/45" : "text-muted-foreground")}>
            {group.label}
          </p>
          {group.items.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative flex h-10 items-center gap-3 rounded-md px-3 text-body font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  dark
                    ? active
                      ? "bg-white/12 text-white"
                      : "text-white/70 hover:bg-white/8 hover:text-white"
                    : active
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {active && <span className={cn("absolute inset-y-2 left-0 w-1 rounded-r-full", dark ? "bg-accent" : "bg-primary")} aria-hidden />}
                <Icon className={cn("size-[18px]", active ? (dark ? "text-accent" : "text-primary") : "")} aria-hidden />
                {label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function LocationSwitcher({ location, locations, dark = false }: Pick<ShellProps, "location" | "locations"> & { dark?: boolean }) {
  const box = dark
    ? "border-white/15 bg-white/8 text-white hover:bg-white/12"
    : "bg-background hover:bg-muted";
  if (locations.length < 2) {
    return (
      <div className={cn("flex items-center gap-2 rounded-md border px-3 py-2 text-small", box)}>
        <MapPin className={cn("size-4", dark ? "text-accent" : "text-primary")} aria-hidden />
        <span className="truncate font-medium">{location.name}</span>
      </div>
    );
  }
  return (
    <Menu.Root>
      <Menu.Trigger
        className={cn(
          "flex w-full cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-left text-small focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          box,
        )}
      >
        <MapPin className={cn("size-4", dark ? "text-accent" : "text-primary")} aria-hidden />
        <span className="flex-1 truncate font-medium">{location.name}</span>
        <ChevronsUpDown className={cn("size-4", dark ? "text-white/60" : "text-muted-foreground")} aria-hidden />
        <span className="sr-only">Switch location</span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="start" sideOffset={6} className="z-50 min-w-56 rounded-lg border bg-popover p-1 shadow-lg">
          {locations.map((l) => (
            <form key={l.id} action={chooseLocation}>
              <input type="hidden" name="locationId" value={l.id} />
              <Menu.Item asChild>
                <button type="submit" className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2.5 py-2 text-small outline-none data-[highlighted]:bg-muted">
                  <span className="flex-1 text-left">{l.name}</span>
                  {l.id === location.id && <Check className="size-4 text-primary" aria-hidden />}
                </button>
              </Menu.Item>
            </form>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

async function signOut(router: ReturnType<typeof useRouter>) {
  await authClient.signOut();
  router.replace("/sign-in?notice=signed-out");
  router.refresh();
}

function UserMenu({ user, organization, organizationCount }: Pick<ShellProps, "user" | "organization" | "organizationCount">) {
  const router = useRouter();
  return (
    <Menu.Root>
      <Menu.Trigger
        className="flex size-9 cursor-pointer items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-dark text-small font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label={`Account menu for ${user.name}`}
      >
        {initials(user.name) || "?"}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={8} className="z-50 w-64 rounded-lg border bg-popover p-1 shadow-lg">
          <div className="grid gap-0.5 px-2.5 py-2">
            <span className="truncate text-small font-semibold">{user.name}</span>
            <span className="truncate text-caption text-muted-foreground">{user.email}</span>
            <span className="mt-1 flex items-center gap-1.5 truncate text-caption text-muted-foreground">
              <Building2 className="size-3.5" aria-hidden />
              {organization.name}
            </span>
          </div>
          <Menu.Separator className="my-1 h-px bg-border" />
          {organizationCount > 1 && (
            <Menu.Item asChild>
              <Link href="/choose-organization" className="flex cursor-pointer items-center gap-2 rounded-sm px-2.5 py-2 text-small outline-none data-[highlighted]:bg-muted">
                <Building2 className="size-4" aria-hidden />
                Switch clinic
              </Link>
            </Menu.Item>
          )}
          <Menu.Item
            onSelect={() => void signOut(router)}
            className="flex cursor-pointer items-center gap-2 rounded-sm px-2.5 py-2 text-small outline-none data-[highlighted]:bg-muted"
          >
            <LogOut className="size-4" aria-hidden />
            Sign out
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function CommandMenu({ open, onOpenChange, groups }: { open: boolean; onOpenChange: (open: boolean) => void; groups: NavGroup[] }) {
  const router = useRouter();
  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };
  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Search Vetrix"
      filter={pageFilter}
      overlayClassName="fixed inset-0 z-50 bg-navy-900/40 backdrop-blur-sm"
      contentClassName="fixed left-1/2 top-[12vh] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border bg-popover shadow-2xl"
    >
      <div className="flex items-center gap-2 border-b px-4">
        <Search className="size-4 text-muted-foreground" aria-hidden />
        <Command.Input placeholder="Go to a page or search…" className="h-12 flex-1 bg-transparent text-body outline-none placeholder:text-muted-foreground" />
        <kbd className="rounded border bg-muted px-1.5 py-0.5 text-caption text-muted-foreground">Esc</kbd>
      </div>
      <Command.List className="max-h-[60vh] overflow-y-auto p-2">
        <Command.Empty className="px-3 py-8 text-center text-small text-muted-foreground">No matches.</Command.Empty>
        {groups.map((group) => (
          <Command.Group
            key={group.label}
            heading={group.label}
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground"
          >
            {group.items.map(({ href, label, icon: Icon, keywords }) => (
              <Command.Item
                key={href}
                value={label}
                keywords={keywords}
                onSelect={() => go(href)}
                className="flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2.5 text-body data-[selected=true]:bg-secondary data-[selected=true]:text-secondary-foreground"
              >
                <Icon className="size-4 text-primary" aria-hidden />
                {label}
              </Command.Item>
            ))}
          </Command.Group>
        ))}
      </Command.List>
    </Command.Dialog>
  );
}

export function AppShell({ user, organization, organizationCount, location, locations, permissions, sandbox, children }: ShellProps) {
  const pathname = usePathname();
  const [searchOpen, setSearchOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const groups = visibleNav(new Set(permissions));
  const current = findNavItem(pathname);
  const tabs = MOBILE_TABS.map((href) => groups.flatMap((g) => g.items).find((i) => i.href === href)).filter(
    (i): i is NonNullable<typeof i> => Boolean(i),
  );

  // ⌘K on Mac, Ctrl+K elsewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="min-h-dvh bg-background">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-card focus:px-4 focus:py-2 focus:shadow-lg"
      >
        Skip to content
      </a>

      {/* Sidebar: large screens */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col overflow-hidden text-white lg:flex">
        <BrandBackdrop waves="22%" glow={false} />
        <div className="relative flex h-16 items-center px-5">
          <Link href="/overview" aria-label="Vetrix overview" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <LogoOnDark />
          </Link>
        </div>
        <div className="relative px-4 pb-4">
          <LocationSwitcher location={location} locations={locations} dark />
        </div>
        <div className="relative flex-1 overflow-y-auto px-3 pb-6">
          <NavLinks groups={groups} pathname={pathname} dark />
        </div>
      </aside>

      <div className="lg:pl-64">
        {/* Header */}
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-card/85 px-4 backdrop-blur sm:px-6">
          <Link href="/overview" aria-label="Vetrix overview" className="lg:hidden">
            <Logo className="[&>span:last-child]:hidden sm:[&>span:last-child]:inline" />
          </Link>
          <h1 className="hidden text-h3 font-semibold lg:block">{current?.label ?? "Vetrix"}</h1>

          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="ml-auto flex h-10 cursor-pointer items-center gap-2 rounded-md border bg-background px-3 text-small text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-72"
          >
            <Search className="size-4" aria-hidden />
            <span className="hidden sm:inline">Search or jump to…</span>
            <span className="sr-only sm:hidden">Search</span>
            <kbd className="ml-auto hidden rounded border bg-card px-1.5 py-0.5 text-caption sm:inline">⌘K</kbd>
          </button>

          {sandbox && (
            <span
              title="Calls and texts are simulated and not sent"
              className="hidden rounded-full bg-warning-soft px-2.5 py-1 text-caption font-semibold text-warning-text ring-1 ring-warning/30 sm:inline"
            >
              Sandbox
            </span>
          )}
          <UserMenu user={user} organization={organization} organizationCount={organizationCount} />
        </header>

        <main id="main" className="mx-auto w-full max-w-7xl px-4 pb-28 pt-6 sm:px-6 lg:pb-10">
          {children}
        </main>
      </div>

      {/* Bottom tabs: phones and tablets */}
      <nav aria-label="Quick" className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <ul className="grid grid-cols-5">
          {tabs.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-16 flex-col items-center justify-center gap-1 text-caption font-medium",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  <Icon className="size-5" aria-hidden />
                  {label}
                </Link>
              </li>
            );
          })}
          <li>
            <Dialog.Root open={moreOpen} onOpenChange={setMoreOpen}>
              <Dialog.Trigger className="flex h-16 w-full cursor-pointer flex-col items-center justify-center gap-1 text-caption font-medium text-muted-foreground">
                <MenuIcon className="size-5" aria-hidden />
                More
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-40 bg-navy-900/40 backdrop-blur-sm" />
                <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl">
                  <div className="mb-4 flex items-center justify-between">
                    <Dialog.Title className="text-h3 font-semibold">All pages</Dialog.Title>
                    <Dialog.Close className="flex size-9 cursor-pointer items-center justify-center rounded-full hover:bg-muted" aria-label="Close">
                      <X className="size-5" aria-hidden />
                    </Dialog.Close>
                  </div>
                  <Dialog.Description className="sr-only">Every page you can open in Vetrix.</Dialog.Description>
                  <div className="mb-5">
                    <LocationSwitcher location={location} locations={locations} />
                  </div>
                  <NavLinks groups={groups} pathname={pathname} onNavigate={() => setMoreOpen(false)} />
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          </li>
        </ul>
      </nav>

      <CommandMenu open={searchOpen} onOpenChange={setSearchOpen} groups={groups} />
    </div>
  );
}

