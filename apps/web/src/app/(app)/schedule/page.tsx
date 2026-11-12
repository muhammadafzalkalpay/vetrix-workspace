import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { localParts, weekdayOf } from "@vetrix/domain";
import { listAppointmentsForDay, loadSchedulingData } from "@vetrix/db/runtime";
import { getVeterinaryPack } from "@vetrix/pack";
import { EmptyState } from "@/components/patterns/empty-state";
import { PageHeader } from "@/components/patterns/page-header";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { requirePage } from "@/features/clients/access";
import { DayView, type Column } from "@/features/schedule/day-view";
import { addDays, formatDayLong, formatTime } from "@/features/schedule/format";
import { VisitPanel } from "@/features/schedule/visit-panel";
import { clinicToday } from "@/lib/clinic-date";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Schedule · Vetrix" };

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; visit?: string; booked?: string; moved?: string; cancelled?: string }>;
}) {
  const shell = await requirePage("schedule.view");
  const sp = await searchParams;
  const tz = shell.location.timezone;
  const today = clinicToday(tz);
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const [data, appointments] = await Promise.all([
    loadSchedulingData(shell.clinic, shell.location.id, date, 1),
    listAppointmentsForDay(shell.clinic, shell.location.id, date),
  ]);
  const weekday = weekdayOf(date);
  const hours = data.calendar.hours.get(weekday);
  const closed = !hours || data.calendar.holidays.has(date);
  const withVisits = new Set(appointments.map((a) => a.provider_id ?? "none"));
  const columns: Column[] = data.providers
    .filter((p) => (p.bookable && (p.schedule.get(weekday)?.length ?? 0) > 0) || withVisits.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, role: p.role }));
  if (withVisits.has("none")) columns.push({ id: "none", name: "Unassigned", role: "" });
  // Show the whole working day, widened if a visit falls outside it.
  const visitMinutes = appointments.map((a) => ({
    s: localParts(a.start_at.getTime(), tz).minutes,
    e: localParts(a.end_at.getTime(), tz).minutes,
  }));
  const open = Math.min(hours?.open ?? 8 * 60, ...visitMinutes.map((v) => v.s));
  const close = Math.max(hours?.close ?? 18 * 60, ...visitMinutes.map((v) => v.e));
  const selected = appointments.find((a) => a.id === sp.visit);
  const canManage = shell.permissions.has("schedule.manage");
  const lanes = getVeterinaryPack().brand.room_lane_colors as Record<string, string>;
  const navBtn = cn(buttonVariants({ variant: "outline", size: "sm" }), "border-white/30 bg-white/10 text-white hover:bg-white/20");

  return (
    <>
      <PageHeader
        title={formatDayLong(date)}
        description={date === today ? "Today" : `${appointments.length} visit${appointments.length === 1 ? "" : "s"}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href={`/schedule?date=${addDays(date, -1)}`} className={navBtn} aria-label="Previous day">
              <ChevronLeft aria-hidden />
            </Link>
            {date !== today && (
              <Link href="/schedule" className={navBtn}>
                Today
              </Link>
            )}
            <Link href={`/schedule?date=${addDays(date, 1)}`} className={navBtn} aria-label="Next day">
              <ChevronRight aria-hidden />
            </Link>
            {canManage && (
              <Link href="/schedule/book" className={cn(buttonVariants({ size: "sm" }), "bg-white text-primary-dark hover:bg-white/90")}>
                <Plus aria-hidden /> Book visit
              </Link>
            )}
          </div>
        }
      />
      {sp.moved === "1" && selected && (
        <Alert variant="success" className="mb-4">
          <CheckCircle2 aria-hidden />
          <p>
            Moved: {selected.patient_name} is now at {formatTime(selected.start_at, tz)} with {selected.provider_name}. The old time is free again.
          </p>
        </Alert>
      )}
      {sp.booked === "1" && selected && (
        <Alert variant="success" className="mb-4">
          <CheckCircle2 aria-hidden />
          <p>
            Booked: {selected.patient_name}, {selected.service_name} with {selected.provider_name}.
          </p>
        </Alert>
      )}
      {sp.cancelled === "1" && (
        <Alert variant="success" className="mb-4">
          <CheckCircle2 aria-hidden />
          <p>The visit was cancelled and its time is free again.</p>
        </Alert>
      )}

      <div className={cn("grid gap-5", selected && "xl:grid-cols-[minmax(0,1fr)_320px]")}>
        <div className="min-w-0">
          {closed && appointments.length === 0 ? (
            <EmptyState icon={CalendarDays} title="The clinic is closed this day" description="Choose another day to see or book visits." />
          ) : columns.length === 0 ? (
            <EmptyState icon={CalendarDays} title="No one is scheduled to work this day" description="Add working hours for your team in Settings." />
          ) : (
            <>
              <DayView date={date} timezone={tz} open={open} close={close} columns={columns} appointments={appointments} laneColors={lanes} selectedId={selected?.id} />
              {appointments.length === 0 && <p className="mt-3 text-center text-small text-muted-foreground">No visits booked yet for this day.</p>}
            </>
          )}
        </div>
        {selected && <VisitPanel appt={selected} date={date} timezone={tz} canManage={canManage} />}
      </div>
    </>
  );
}
