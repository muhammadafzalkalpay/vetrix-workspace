import type { Metadata } from "next";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { BellRing, CalendarCheck, ClipboardList, MessageSquareText, Moon, PhoneCall, Siren, UserPlus } from "lucide-react";
import { loadReport } from "@vetrix/db/runtime";
import { Panel } from "@/components/patterns/detail-list";
import { PageHeader } from "@/components/patterns/page-header";
import { requirePage } from "@/features/clients/access";
import { DailyBars, RankedBars } from "@/features/reports/charts";
import { clinicToday } from "@/lib/clinic-date";
import { getMessagingMode } from "@/lib/env";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Reports · Vetrix" };
const PERIODS = [7, 30, 90] as const;

const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "–");

function Stat({ label, value, note, icon: Icon }: { label: string; value: string | number; note?: string; icon: LucideIcon }) {
  return (
    <div className="grid content-start gap-1 rounded-xl border bg-card p-4 shadow-card">
      <span className="flex items-center gap-2 text-small text-muted-foreground">
        <Icon className="size-4 text-primary" aria-hidden /> {label}
      </span>
      <span className="text-h1 font-semibold tabular-nums">{value}</span>
      {note && <span className="text-caption text-muted-foreground">{note}</span>}
    </div>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const shell = await requirePage("reports.view");
  const sp = await searchParams;
  const days = PERIODS.find((d) => String(d) === sp.days) ?? 30;
  const today = clinicToday(shell.location.timezone);
  const start = new Date(`${today}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const from = start.toISOString().slice(0, 10);
  const r = await loadReport(shell.clinic, shell.location.id, from, today);
  const handled = r.calls.total;

  return (
    <>
      <PageHeader title="Reports" description={`${shell.location.name}, the last ${days} days.`} />
      <nav className="mb-5 flex flex-wrap items-center gap-2" aria-label="Period">
        {PERIODS.map((d) => (
          <Link
            key={d}
            href={`/reports?days=${d}`}
            aria-current={d === days ? "page" : undefined}
            className={cn("rounded-full border px-3.5 py-1.5 text-small font-medium transition-colors", d === days ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}
          >
            Last {d} days
          </Link>
        ))}
        {getMessagingMode() === "sandbox" && r.calls.sandbox > 0 && (
          <span className="ml-auto text-caption text-muted-foreground">Includes {r.calls.sandbox} Sandbox conversation{r.calls.sandbox === 1 ? "" : "s"}.</span>
        )}
      </nav>

      <section className="mb-6 grid gap-3" aria-labelledby="front-desk">
        <h2 id="front-desk" className="text-h3">Front desk</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat icon={PhoneCall} label="Calls and texts answered" value={handled} note={`${r.calls.voice} calls · ${r.calls.sms} texts`} />
          <Stat icon={CalendarCheck} label="Ended in a booking" value={pct(r.calls.booked, handled)} note={`${r.calls.booked} of ${handled}`} />
          <Stat icon={Moon} label="After hours" value={pct(r.calls.afterHours, handled)} note={`${r.calls.afterHours} answered while closed`} />
          <Stat icon={Siren} label="Emergencies" value={r.calls.emergency} note={`${r.calls.transferred} transferred · ${r.calls.erReferred} sent to ER · ${r.calls.urgent} urgent`} />
        </div>
        <Panel title="Conversations per day">
          <DailyBars days={r.callsByDay} label={`Calls and texts, last ${days} days`} />
        </Panel>
      </section>

      <section className="mb-6 grid gap-3" aria-labelledby="visits">
        <h2 id="visits" className="text-h3">Visits</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat icon={CalendarCheck} label="Visits" value={r.visits.total} note={`${pct(r.visits.byAi, r.visits.total)} booked by Riley · ${r.visits.byStaff} by staff`} />
          <Stat icon={CalendarCheck} label="Completed" value={r.visits.completed} note={`${r.visits.urgent} urgent or emergency`} />
          <Stat icon={CalendarCheck} label="No-shows" value={r.visits.noShow} note={pct(r.visits.noShow, r.visits.total) + " of visits"} />
          <Stat icon={CalendarCheck} label="Cancelled" value={r.visits.cancelled} note={`${r.visits.lateCancel} late cancellations`} />
        </div>
        <Panel title="Most booked services">
          <RankedBars rows={r.topServices.map((s) => ({ name: s.name, value: s.visits }))} empty="No visits in this period." />
        </Panel>
      </section>

      <section className="grid gap-3" aria-labelledby="follow-up">
        <h2 id="follow-up" className="text-h3">Follow-up</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat icon={MessageSquareText} label="Messages" value={r.messages.sms + r.messages.email} note={`${r.messages.sms} texts · ${r.messages.email} emails${r.messages.failed ? ` · ${r.messages.failed} not sent` : ""}`} />
          <Stat icon={BellRing} label="Reminders sent" value={r.reminders.touchesSent} note={`${r.reminders.open} open · ${r.reminders.booked} visits booked from reminders`} />
          <Stat icon={ClipboardList} label="Tasks" value={r.tasks.created} note={`${r.tasks.done} done · ${r.tasks.openUrgent} urgent still open`} />
          <Stat icon={UserPlus} label="New clients" value={r.newClients.total} note={`${r.newClients.byAi} added by Riley`} />
        </div>
      </section>
    </>
  );
}
