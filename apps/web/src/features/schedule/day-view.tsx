// Day calendar: one column per provider, visits placed by time and coloured
// by room type (pack brand lane colours). On small screens it becomes a list.
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { localParts } from "@vetrix/domain";
import type { CalendarAppointment } from "@vetrix/db/runtime";
import { SpeciesIcon } from "@/features/clients/species-icon";
import { cn } from "@/lib/utils";
import { formatTime } from "./format";

const PX_PER_15 = 18;

export interface Column {
  id: string;
  name: string;
  role: string;
}

const ROLE_LABEL: Record<string, string> = { dvm: "Doctor", technician: "Technician", assistant: "Assistant" };

function statusStyle(status: string) {
  if (status === "requested") return "border-dashed";
  if (status === "completed") return "opacity-60";
  if (status === "no_show") return "opacity-50 line-through";
  return "";
}

export function DayView({
  date,
  timezone,
  open,
  close,
  columns,
  appointments,
  laneColors,
  selectedId,
}: {
  date: string;
  timezone: string;
  open: number;
  close: number;
  columns: Column[];
  appointments: CalendarAppointment[];
  laneColors: Record<string, string>;
  selectedId?: string;
}) {
  const startHour = Math.floor(open / 60);
  const endHour = Math.ceil(close / 60);
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const height = ((endHour - startHour) * 60 * PX_PER_15) / 15;
  const href = (id: string) => `/schedule?date=${date}&visit=${id}`;
  const color = (a: CalendarAppointment) => laneColors[a.room_type ?? ""] ?? "#0F766E";

  return (
    <>
      {/* Grid: medium screens and up */}
      <div className="hidden overflow-x-auto rounded-xl border bg-card shadow-card md:block">
        <div className="grid min-w-[640px]" style={{ gridTemplateColumns: `64px repeat(${Math.max(columns.length, 1)}, minmax(160px, 1fr))` }}>
          <div className="sticky top-0 z-10 border-b bg-card" />
          {columns.map((c) => (
            <div key={c.id} className="sticky top-0 z-10 border-b border-l bg-card px-3 py-2.5">
              <p className="truncate text-small font-semibold">{c.name}</p>
              <p className="text-caption text-muted-foreground">{ROLE_LABEL[c.role] ?? c.role}</p>
            </div>
          ))}

          <div className="relative" style={{ height }}>
            {hours.map((h, i) => (
              <span key={h} className="absolute right-2 -translate-y-1/2 text-caption text-muted-foreground tabular-nums" style={{ top: i * 4 * PX_PER_15 }}>
                {i === 0 ? "" : `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`}
              </span>
            ))}
          </div>
          {columns.map((c) => (
            <div key={c.id} className="relative border-l" style={{ height }}>
              {hours.map((h, i) => (
                <div key={h} className="absolute inset-x-0 border-t border-border/70" style={{ top: i * 4 * PX_PER_15 }} />
              ))}
              {appointments
                .filter((a) => (a.provider_id ?? "none") === c.id)
                .map((a) => {
                  const s = localParts(a.start_at.getTime(), timezone).minutes;
                  const minutes = (a.end_at.getTime() - a.start_at.getTime()) / 60_000;
                  const top = ((s - startHour * 60) / 15) * PX_PER_15;
                  const h = Math.max((minutes / 15) * PX_PER_15 - 2, 30);
                  return (
                    <Link
                      key={a.id}
                      href={href(a.id)}
                      scroll={false}
                      style={{ top, height: h, borderLeftColor: color(a), backgroundColor: `${color(a)}14` }}
                      className={cn(
                        "absolute inset-x-1.5 overflow-hidden rounded-md border border-l-4 bg-card px-2 py-1 text-left shadow-card transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        statusStyle(a.status),
                        a.triage_level === "emergency" && "ring-2 ring-destructive",
                        a.triage_level === "urgent" && "ring-2 ring-warning",
                        selectedId === a.id && "ring-2 ring-primary",
                      )}
                    >
                      <span className="flex items-center gap-1 text-caption font-semibold">
                        <SpeciesIcon species={a.species} className="size-3.5" />
                        <span className="truncate">{a.patient_name}</span>
                        {a.triage_level !== "routine" && <AlertTriangle className="size-3.5 shrink-0 text-destructive" aria-label={a.triage_level} />}
                      </span>
                      <span className="block truncate text-caption text-muted-foreground">
                        {formatTime(a.start_at, timezone)} · {a.service_name}
                      </span>
                      {h > 48 && a.room_name && <span className="block truncate text-caption text-muted-foreground">{a.room_name}</span>}
                    </Link>
                  );
                })}
            </div>
          ))}
        </div>
      </div>

      {/* List: phones */}
      <ol className="grid gap-2 md:hidden">
        {appointments.map((a) => (
          <li key={a.id}>
            <Link
              href={href(a.id)}
              scroll={false}
              style={{ borderLeftColor: color(a) }}
              className={cn("flex gap-3 rounded-lg border border-l-4 bg-card p-3 shadow-card", statusStyle(a.status), selectedId === a.id && "ring-2 ring-primary")}
            >
              <span className="w-16 shrink-0 text-small font-semibold tabular-nums">{formatTime(a.start_at, timezone)}</span>
              <span className="grid min-w-0">
                <span className="truncate font-medium">
                  {a.patient_name} · {a.service_name}
                </span>
                <span className="truncate text-small text-muted-foreground">{[a.provider_name, a.room_name].filter(Boolean).join(" · ")}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </>
  );
}
