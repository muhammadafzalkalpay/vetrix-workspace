import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardCheck, ClipboardList, PhoneCall } from "lucide-react";
import { listTasks } from "@vetrix/db/runtime";
import { EmptyState } from "@/components/patterns/empty-state";
import { PageHeader } from "@/components/patterns/page-header";
import { Pagination } from "@/components/patterns/pagination";
import { Badge } from "@/components/ui/badge";
import { requirePage } from "@/features/clients/access";
import { formatWhen, TASK_TYPE_LABEL } from "@/features/front-desk/labels";
import { TaskButton } from "@/features/front-desk/task-button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Tasks · Vetrix" };
const PAGE_SIZE = 50;

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const shell = await requirePage("tasks.view");
  const sp = await searchParams;
  const status = sp.status === "done" ? "done" : "open";
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, total } = await listTasks(shell.clinic, shell.location.id, { status, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  const tz = shell.location.timezone;
  const canManage = shell.permissions.has("tasks.manage");
  const canCalls = shell.permissions.has("calls.view");
  const urgent = rows.filter((t) => t.priority === "urgent" && t.status !== "done").length;

  return (
    <>
      <PageHeader
        title="Tasks"
        description={status === "open" ? (urgent ? `${urgent} urgent · ${total} open` : `${total} open`) : "Completed follow-ups."}
      />
      <nav className="mb-4 flex gap-2" aria-label="Task status">
        {(["open", "done"] as const).map((s) => (
          <Link
            key={s}
            href={s === "open" ? "/tasks" : "/tasks?status=done"}
            aria-current={status === s ? "page" : undefined}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-small font-medium transition-colors",
              status === s ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
            )}
          >
            {s === "open" ? "Open" : "Done"}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <EmptyState
          icon={status === "open" ? ClipboardCheck : ClipboardList}
          title={status === "open" ? "No open tasks" : "Nothing completed yet"}
          description={status === "open" ? "When a call or text needs a person, Vetrix adds a task here." : "Tasks you mark done appear here."}
        />
      ) : (
        <ul className="grid gap-2">
          {rows.map((t) => (
            <li
              key={t.id}
              className={cn(
                "flex flex-col gap-3 rounded-lg border border-l-4 bg-card p-4 shadow-card sm:flex-row sm:items-start sm:justify-between",
                t.priority === "urgent" && t.status !== "done" ? "border-l-destructive" : "border-l-transparent",
              )}
            >
              <div className="grid min-w-0 gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  {t.priority === "urgent" && <Badge variant="danger">Urgent</Badge>}
                  <Badge variant="muted">{TASK_TYPE_LABEL[t.type] ?? t.type.replace(/_/g, " ")}</Badge>
                  {t.controlled_substance && <Badge variant="warning">Controlled substance</Badge>}
                </div>
                <p className={cn("font-semibold", t.status === "done" && "text-muted-foreground")}>{t.title ?? TASK_TYPE_LABEL[t.type] ?? "Task"}</p>
                {t.details && <p className="text-small text-muted-foreground">{t.details}</p>}
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
                  <span>{status === "done" && t.completed_at ? `Done ${formatWhen(t.completed_at, tz)}` : formatWhen(t.created_at, tz)}</span>
                  {t.client_id && t.client_name && (
                    <Link href={`/clients/${t.client_id}`} className="font-medium text-primary hover:underline">
                      {t.client_name}
                    </Link>
                  )}
                  {t.patient_id && t.patient_name && (
                    <Link href={`/patients/${t.patient_id}`} className="font-medium text-primary hover:underline">
                      {t.patient_name}
                    </Link>
                  )}
                  {t.call_id && canCalls && (
                    <Link href={`/calls/${t.call_id}`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                      <PhoneCall className="size-3.5" aria-hidden /> Conversation
                    </Link>
                  )}
                </p>
              </div>
              {canManage && <TaskButton taskId={t.id} done={t.status === "done"} />}
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/tasks" params={{ status: status === "done" ? "done" : undefined }} />
    </>
  );
}
