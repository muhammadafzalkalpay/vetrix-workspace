import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarDays, CheckCircle2, ClipboardList, PawPrint, Users } from "lucide-react";
import { loadOverview, type TodayAppointment } from "@vetrix/db/runtime";
import { EmptyState } from "@/components/patterns/empty-state";
import { BrandBackdrop, Highlight } from "@/components/vetrix/brand-backdrop";
import { requireShell } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Overview · Vetrix" };

function greeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function clinicNow(timezone: string) {
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: timezone }).format(now));
  const date = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: timezone }).format(now);
  return { hour, date };
}

function time(d: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(d);
}

const TRIAGE_STYLE: Record<TodayAppointment["triage_level"], string> = {
  routine: "bg-secondary text-secondary-foreground",
  urgent: "bg-warning-soft text-warning-text",
  emergency: "bg-danger-soft text-destructive",
};

function Stat({ label, value, icon: Icon, href }: { label: string; value: number; icon: typeof Users; href?: string }) {
  const body = (
    <>
      <span className="flex size-10 items-center justify-center rounded-lg bg-secondary text-primary">
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="grid">
        <span className="text-h2 font-semibold tabular-nums">{value.toLocaleString("en-US")}</span>
        <span className="text-small text-muted-foreground">{label}</span>
      </span>
    </>
  );
  const cls = "flex items-center gap-4 rounded-lg border bg-card p-4 shadow-card";
  return href ? (
    <Link href={href} className={cn(cls, "transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export default async function OverviewPage() {
  const shell = await requireShell();
  const tz = shell.location.timezone;
  const { hour, date } = clinicNow(tz);
  const data = await loadOverview(shell.clinic, shell.location.id);
  const can = (p: Parameters<typeof shell.permissions.has>[0]) => shell.permissions.has(p);
  const firstName = shell.access.displayName.split(" ")[0];
  const urgentTasks = data.tasks.filter((t) => t.priority === "urgent").length;

  const attention = [
    ...data.tasks.map((t) => ({
      id: t.id,
      urgent: t.priority === "urgent",
      title: t.title ?? t.details ?? t.type.replaceAll("_", " "),
      meta: t.patient_name ? `Task · ${t.patient_name}` : "Task",
      href: "/tasks",
    })),
    ...(data.counts.unconfirmedToday > 0
      ? [
          {
            id: "unconfirmed",
            urgent: false,
            title: `${data.counts.unconfirmedToday} visit${data.counts.unconfirmedToday === 1 ? "" : "s"} today not confirmed yet`,
            meta: "Schedule",
            href: "/schedule",
          },
        ]
      : []),
  ];

  return (
    <div className="grid gap-6">
      <header className="relative overflow-hidden rounded-xl px-6 pb-10 pt-6 text-white shadow-card sm:px-8 sm:pb-12 sm:pt-8">
        <BrandBackdrop waves="45%" />
        <div className="relative grid gap-2">
          <p className="text-small font-medium text-white/70">
            {date} · {shell.location.name}
          </p>
          <h2 className="vx-fade-up text-h1 sm:text-[34px] sm:leading-[42px]">
            {greeting(hour)}, <Highlight>{firstName}</Highlight>
          </h2>
          <p className="max-w-xl text-white/75">
            {data.appointments.length === 0
              ? "No visits on the books yet today."
              : `${data.appointments.length} visit${data.appointments.length === 1 ? "" : "s"} on the books today.`}{" "}
            {attention.length === 0 ? "Nothing needs your attention right now." : `${attention.length} thing${attention.length === 1 ? "" : "s"} need${attention.length === 1 ? "s" : ""} attention.`}
          </p>
        </div>
      </header>

      {urgentTasks > 0 && can("tasks.view") && (
        <Link
          href="/tasks"
          role="alert"
          className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-danger-soft px-4 py-3 font-medium text-foreground shadow-card transition-colors hover:border-destructive/60"
        >
          <AlertTriangle className="size-5 shrink-0 text-destructive" aria-hidden />
          <span className="flex-1">
            {urgentTasks} urgent task{urgentTasks === 1 ? "" : "s"} from the front desk need{urgentTasks === 1 ? "s" : ""} a person now.
          </span>
          <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
        </Link>
      )}

      <section aria-label="At a glance" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Visits today" value={data.appointments.length} icon={CalendarDays} href={can("schedule.view") ? "/schedule" : undefined} />
        <Stat label="Open tasks" value={data.counts.openTasks} icon={ClipboardList} href={can("tasks.view") ? "/tasks" : undefined} />
        <Stat label="Active patients" value={data.counts.activePatients} icon={PawPrint} href={can("patients.view") ? "/patients" : undefined} />
        <Stat label="Clients" value={data.counts.clients} icon={Users} href={can("clients.view") ? "/clients" : undefined} />
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <section aria-labelledby="attention" className="grid content-start gap-3">
          <h3 id="attention" className="text-h3">
            Needs attention
          </h3>
          {attention.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="All clear" description="No urgent tasks or unconfirmed visits right now." className="py-10" />
          ) : (
            <ul className="grid gap-2">
              {attention.map((a) => (
                <li key={a.id}>
                  <Link
                    href={a.href}
                    className="flex items-center gap-3 rounded-lg border bg-card p-3.5 shadow-card transition-colors hover:border-primary/40"
                  >
                    <span
                      className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-full",
                        a.urgent ? "bg-danger-soft text-destructive" : "bg-warning-soft text-warning-text",
                      )}
                    >
                      <AlertTriangle className="size-4" aria-hidden />
                    </span>
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate font-medium first-letter:uppercase">{a.title}</span>
                      <span className="text-small text-muted-foreground">{a.meta}</span>
                    </span>
                    <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="today" className="grid content-start gap-3">
          <h3 id="today" className="text-h3">
            Today
          </h3>
          {data.appointments.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="No visits booked for today"
              description="Appointments booked by your team, online or by Riley appear here in time order."
              className="py-10"
            />
          ) : (
            <ol className="relative grid gap-3 border-l-2 border-border pl-5">
              {data.appointments.map((a) => (
                <li key={a.id} className="relative">
                  <span className="absolute -left-[27px] top-4 size-3 rounded-full border-2 border-card bg-primary" aria-hidden />
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-card p-3.5 shadow-card">
                    <span className="w-16 text-small font-semibold tabular-nums">{time(a.start_at, tz)}</span>
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate font-medium">
                        {a.patient_name} · {a.service_name}
                      </span>
                      <span className="truncate text-small text-muted-foreground">
                        {[a.client_name, a.provider_name, a.room_name].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    {a.triage_level !== "routine" && (
                      <span className={cn("rounded-full px-2.5 py-0.5 text-caption font-semibold capitalize", TRIAGE_STYLE[a.triage_level])}>
                        {a.triage_level}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
