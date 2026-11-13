import type { Metadata } from "next";
import { Stethoscope, UserRoundCog } from "lucide-react";
import { ROLE_KEYS, ROLES } from "@vetrix/domain";
import { listTeam, platformUserEmails } from "@vetrix/db/runtime";
import { Panel } from "@/components/patterns/detail-list";
import { EmptyState } from "@/components/patterns/empty-state";
import { PageHeader } from "@/components/patterns/page-header";
import { Badge } from "@/components/ui/badge";
import { requirePage } from "@/features/clients/access";
import { AddStaffForm, RoleSelect, StatusButton, type RoleOption } from "@/features/team/team-forms";
import { tenancy } from "@/lib/tenancy";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Team · Vetrix" };

export default async function TeamPage() {
  const shell = await requirePage("staff.manage");
  const team = await listTeam(shell.clinic);
  const emails = await platformUserEmails(tenancy().registry, team.map((m) => m.platform_user_ref));
  const isOwner = shell.permissions.has("billing.manage");
  // Only owners may hand out the owner role.
  const roles: RoleOption[] = ROLE_KEYS.filter((k) => isOwner || k !== "owner").map((k) => ({ value: k, label: ROLES[k].label }));
  const here = team.filter((m) => m.roles.some((r) => r.location_id === shell.location.id));
  const active = here.filter((m) => m.status === "active").length;

  return (
    <>
      <PageHeader title="Team" description={`${active} ${active === 1 ? "person has" : "people have"} access to ${shell.location.name}.`} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <section className="grid content-start gap-2" aria-label="Team members">
          {here.length === 0 ? (
            <EmptyState icon={UserRoundCog} title="No one yet" description="Add your team so they can sign in." />
          ) : (
            here.map((m) => {
              const role = m.roles.find((r) => r.location_id === shell.location.id)!.role;
              const self = m.staff_user_id === shell.access.staffUserId;
              const ownerOnly = role === "owner" && !isOwner;
              const others = m.roles.filter((r) => r.location_id !== shell.location.id);
              return (
                <div
                  key={m.staff_user_id}
                  className={cn("flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-card sm:flex-row sm:items-center", m.status === "disabled" && "opacity-70")}
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-small font-semibold text-secondary-foreground">
                    {m.display_name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                  </span>
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <p className="flex flex-wrap items-center gap-2 font-semibold">
                      {m.display_name}
                      {self && <Badge variant="muted">You</Badge>}
                      {m.status === "disabled" && <Badge variant="danger">Access off</Badge>}
                      {m.is_provider && (
                        <span className="inline-flex items-center gap-1 text-caption font-normal text-muted-foreground">
                          <Stethoscope className="size-3.5" aria-hidden /> On the schedule
                        </span>
                      )}
                    </p>
                    <p className="truncate text-small text-muted-foreground">{emails.get(m.platform_user_ref) ?? "Email unavailable"}</p>
                    {others.length > 0 && (
                      <p className="text-caption text-muted-foreground">Also: {others.map((o) => `${ROLES[o.role]?.label ?? o.role} at ${o.location_name}`).join("; ")}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-start gap-2 sm:justify-end">
                    {self || ownerOnly ? (
                      <Badge variant="secondary" className="h-9 px-3">{ROLES[role]?.label ?? role}</Badge>
                    ) : (
                      <RoleSelect staffUserId={m.staff_user_id} current={role} roles={roles} disabled={m.status === "disabled"} />
                    )}
                    {!self && !ownerOnly && <StatusButton staffUserId={m.staff_user_id} active={m.status === "active"} />}
                  </div>
                </div>
              );
            })
          )}
        </section>

        <div className="grid content-start gap-6">
          <Panel title="Add someone">
            <AddStaffForm roles={roles} />
            <p className="text-caption text-muted-foreground">They get an email to set their password, then sign in with their email.</p>
          </Panel>
          <Panel title="What each role can do">
            <ul className="grid gap-2 text-small">
              {ROLE_KEYS.map((k) => (
                <li key={k}>
                  <span className="font-medium">{ROLES[k].label}:</span>{" "}
                  <span className="text-muted-foreground">{ROLE_SUMMARY[k]}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}

const ROLE_SUMMARY: Record<string, string> = {
  owner: "everything, including billing and adding owners.",
  manager: "everything except billing.",
  dvm: "schedule, clients, pets, calls, messages, tasks and reports.",
  technician: "schedule, pets, calls, messages and tasks; views clients.",
  assistant: "views the schedule, clients, pets and messages; works on tasks.",
  csr: "front desk: booking, clients, calls, messages, tasks and reminders.",
};
