import Link from "next/link";
import { CalendarClock, DoorOpen, PawPrint, Stethoscope, User, X } from "lucide-react";
import type { CalendarAppointment } from "@vetrix/db/runtime";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cancelAction } from "./actions";
import { CancelForm } from "./cancel-form";
import { formatTime } from "./format";

const STATUS: Record<string, { label: string; variant: "secondary" | "success" | "warning" | "muted" | "danger" }> = {
  requested: { label: "Not confirmed yet", variant: "warning" },
  confirmed: { label: "Confirmed", variant: "success" },
  checked_in: { label: "Checked in", variant: "secondary" },
  in_progress: { label: "In progress", variant: "secondary" },
  completed: { label: "Completed", variant: "muted" },
  no_show: { label: "No-show", variant: "danger" },
};
const BOOKED_BY: Record<string, string> = { ai: "Riley (phone)", staff: "Staff", web: "Online booking", client: "Client" };

export function VisitPanel({ appt, date, timezone, canManage }: { appt: CalendarAppointment; date: string; timezone: string; canManage: boolean }) {
  const status = STATUS[appt.status] ?? { label: appt.status, variant: "muted" as const };
  const open = appt.status === "requested" || appt.status === "confirmed";
  return (
    <aside aria-label="Visit details" className="grid content-start gap-4 rounded-xl border bg-card p-5 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <div className="grid gap-1">
          <h3 className="text-h3 font-semibold">
            {appt.patient_name} · {appt.service_name}
          </h3>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant={status.variant}>{status.label}</Badge>
            {appt.triage_level !== "routine" && <Badge variant="danger">{appt.triage_level === "emergency" ? "Emergency" : "Urgent"}</Badge>}
          </div>
        </div>
        <Link href={`/schedule?date=${date}`} scroll={false} aria-label="Close" className="rounded-full p-1.5 hover:bg-muted">
          <X className="size-4" aria-hidden />
        </Link>
      </div>
      <ul className="grid gap-2.5 text-small">
        <li className="flex items-center gap-2.5">
          <CalendarClock className="size-4 text-primary" aria-hidden />
          {formatTime(appt.start_at, timezone)} – {formatTime(appt.end_at, timezone)}
        </li>
        <li className="flex items-center gap-2.5">
          <Stethoscope className="size-4 text-primary" aria-hidden />
          {appt.provider_name ?? "No provider assigned"}
        </li>
        <li className="flex items-center gap-2.5">
          <DoorOpen className="size-4 text-primary" aria-hidden />
          {appt.room_name ?? "No room"}
        </li>
        <li className="flex items-center gap-2.5">
          <PawPrint className="size-4 text-primary" aria-hidden />
          <Link href={`/patients/${appt.patient_id}`} className="text-primary hover:underline">
            {appt.patient_name}
          </Link>
        </li>
        <li className="flex items-center gap-2.5">
          <User className="size-4 text-primary" aria-hidden />
          <Link href={`/clients/${appt.client_id}`} className="text-primary hover:underline">
            {appt.client_name}
          </Link>
        </li>
      </ul>
      <p className="text-caption text-muted-foreground">Booked by {BOOKED_BY[appt.booked_by] ?? appt.booked_by}</p>
      {canManage && open && (
        <div className="grid gap-2 border-t pt-4">
          <Link href={`/schedule/book?reschedule=${appt.id}`} className={buttonVariants({ size: "sm" })}>
            Move to another time
          </Link>
          <CancelForm action={cancelAction.bind(null, appt.id, date)} />
        </div>
      )}
    </aside>
  );
}
