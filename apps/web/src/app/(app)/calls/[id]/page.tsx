import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ChevronLeft, ClipboardList, Info } from "lucide-react";
import { formatPhone, localParts } from "@vetrix/domain";
import { aiPersonaName, getCall } from "@vetrix/db/runtime";
import { getVeterinaryPack } from "@vetrix/pack";
import { DetailList, Panel } from "@/components/patterns/detail-list";
import { PageHeader } from "@/components/patterns/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { assertId, orNotFound, requirePage } from "@/features/clients/access";
import { formatDuration, formatWhen, SandboxBadge, TASK_TYPE_LABEL, TRIAGE_ACTION_LABEL, TriageBadge } from "@/features/front-desk/labels";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Conversation · Vetrix" };

const TRANSFER_LABEL: Record<string, string> = {
  none: "",
  transferred: "Transferred to staff",
  failed: "Transfer failed, referred to ER",
  er_referred: "Referred to ER",
};

export default async function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const shell = await requirePage("calls.view");
  const id = assertId((await params).id);
  const [call, aiName] = await Promise.all([orNotFound(getCall(shell.clinic, shell.location.id, id)), aiPersonaName(shell.clinic, shell.location.id)]);
  const tz = shell.location.timezone;
  const who = call.client_name ?? (call.caller_number ? formatPhone(call.caller_number) : "Unknown caller");
  const canClients = shell.permissions.has("clients.view");
  const canPatients = shell.permissions.has("patients.view");
  const canSchedule = shell.permissions.has("schedule.view");
  const pack = getVeterinaryPack().triage;
  const triggerName = new Map([...pack.emergency_triggers, ...pack.urgent_triggers].map((t) => [t.id, t.name]));
  const time = (d: Date) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(d);

  return (
    <>
      <PageHeader
        title={who}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {call.channel === "voice" ? "Phone call" : "Text conversation"} · {formatWhen(call.started_at, tz)}
            {call.after_hours && " · after hours"}
          </span>
        }
        actions={
          <Link href="/calls" className={cn(buttonVariants({ variant: "outline" }), "border-white/30 bg-white/10 text-white hover:bg-white/20")}>
            <ChevronLeft aria-hidden /> Calls
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel title="Transcript" action={call.sandbox ? <SandboxBadge /> : undefined}>
          <ol className="grid gap-3">
            {call.turns.map((t) =>
              t.speaker === "system" ? (
                <li key={t.seq} className="mx-auto flex max-w-[92%] items-start gap-1.5 rounded-md bg-muted px-3 py-1.5 text-caption text-muted-foreground">
                  <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  {t.body}
                </li>
              ) : (
                <li key={t.seq} className={cn("flex flex-col gap-1", t.speaker === "caller" ? "items-end" : "items-start")}>
                  <span className="text-caption text-muted-foreground">
                    {t.speaker === "caller" ? (call.client_name?.split(" ")[0] ?? "Caller") : aiName} · {time(t.created_at)}
                  </span>
                  <p
                    className={cn(
                      "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-small",
                      t.speaker === "caller" ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm border bg-muted/40",
                    )}
                  >
                    {t.body}
                  </p>
                </li>
              ),
            )}
          </ol>
        </Panel>

        <div className="grid content-start gap-6">
          <Panel title="Summary" action={<TriageBadge level={call.triage_level} />}>
            <p>
              {call.summary}
              {!call.ended_at && <span className="ml-2 text-caption font-semibold uppercase tracking-wider text-primary">Open</span>}
            </p>
            <DetailList
              className="sm:grid-cols-1"
              items={[
                ["Client", call.client_id && canClients ? <Link className="font-medium text-primary hover:underline" href={`/clients/${call.client_id}`}>{call.client_name}</Link> : call.client_name],
                ["Pet", call.patient_id && canPatients ? <Link className="font-medium text-primary hover:underline" href={`/patients/${call.patient_id}`}>{call.patient_name}</Link> : call.patient_name],
                ["Caller number", call.caller_number ? formatPhone(call.caller_number) : null],
                [
                  "Booked",
                  call.appointment_id && call.appointment_start ? (
                    canSchedule ? (
                      <Link className="font-medium text-primary hover:underline" href={`/schedule?date=${localParts(call.appointment_start.getTime(), tz).date}&visit=${call.appointment_id}`}>
                        {formatWhen(call.appointment_start, tz)}
                      </Link>
                    ) : (
                      formatWhen(call.appointment_start, tz)
                    )
                  ) : null,
                ],
                ["Transfer", TRANSFER_LABEL[call.transfer_outcome] || null],
                ["Length", call.ended_at ? formatDuration(call.duration_sec) : null],
              ]}
            />
          </Panel>

          {call.triage.length > 0 && (
            <Panel title="Triage">
              <ul className="grid gap-3">
                {call.triage.map((t, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <AlertTriangle className={cn("mt-0.5 size-4 shrink-0", t.level === "emergency" ? "text-destructive" : "text-warning-text")} aria-hidden />
                    <span className="grid gap-0.5">
                      <span className="font-medium">{triggerName.get(t.trigger_id) ?? (t.trigger_id === "unclassified_emergency" ? "Caller describes an emergency" : "Possible illness or injury")}</span>
                      <span className="text-caption text-muted-foreground">
                        {TRIAGE_ACTION_LABEL[t.action_taken] ?? t.action_taken}
                        {t.evidence ? ` · heard “${t.evidence}”` : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {call.tasks.length > 0 && (
            <Panel title="Tasks" action={<Link href="/tasks" className="text-small font-semibold text-primary hover:underline">All tasks</Link>}>
              <ul className="grid gap-2">
                {call.tasks.map((t) => (
                  <li key={t.id} className="flex items-start gap-2.5">
                    <ClipboardList className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="grid min-w-0 gap-1">
                      <span className={cn("text-small font-medium", t.status === "done" && "text-muted-foreground line-through")}>{t.title ?? TASK_TYPE_LABEL[t.type] ?? t.type}</span>
                      <span className="flex gap-1.5">
                        {t.priority === "urgent" && <Badge variant="danger">Urgent</Badge>}
                        <Badge variant={t.status === "done" ? "success" : "muted"}>{t.status === "done" ? "Done" : "Open"}</Badge>
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
