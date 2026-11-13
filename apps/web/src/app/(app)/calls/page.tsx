import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Moon, PhoneCall, Sparkles } from "lucide-react";
import { formatPhone, type TriageLevel } from "@vetrix/domain";
import { aiPersonaName, listCalls } from "@vetrix/db/runtime";
import { EmptyState } from "@/components/patterns/empty-state";
import { PageHeader } from "@/components/patterns/page-header";
import { Pagination } from "@/components/patterns/pagination";
import { buttonVariants } from "@/components/ui/button";
import { requirePage } from "@/features/clients/access";
import { ChannelIcon, formatWhen, SandboxBadge, TriageBadge } from "@/features/front-desk/labels";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Calls · Vetrix" };
const PAGE_SIZE = 25;
const FILTERS: { value: TriageLevel | undefined; label: string }[] = [
  { value: undefined, label: "All" },
  { value: "emergency", label: "Emergency" },
  { value: "urgent", label: "Urgent" },
];

export default async function CallsPage({ searchParams }: { searchParams: Promise<{ level?: string; page?: string }> }) {
  const shell = await requirePage("calls.view");
  const sp = await searchParams;
  const level = sp.level === "emergency" || sp.level === "urgent" ? sp.level : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const [aiName, { rows, total }] = await Promise.all([
    aiPersonaName(shell.clinic, shell.location.id),
    listCalls(shell.clinic, shell.location.id, { level, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
  ]);
  const tz = shell.location.timezone;
  const canTry = shell.permissions.has("schedule.manage");

  return (
    <>
      <PageHeader
        title="Calls"
        description={`Every call and text ${aiName} answered, with transcript and triage.`}
        actions={
          canTry && (
            <Link href="/calls/sandbox" className={cn(buttonVariants(), "bg-white text-primary-dark hover:bg-white/90")}>
              <Sparkles aria-hidden /> Talk to {aiName}
            </Link>
          )
        }
      />
      <nav className="mb-4 flex flex-wrap items-center gap-2" aria-label="Filter by triage">
        {FILTERS.map((f) => (
          <Link
            key={f.label}
            href={f.value ? `/calls?level=${f.value}` : "/calls"}
            aria-current={level === f.value ? "page" : undefined}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-small font-medium transition-colors",
              level === f.value ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
            )}
          >
            {f.label}
          </Link>
        ))}
        <span className="ml-auto text-small text-muted-foreground" aria-live="polite">
          {total.toLocaleString("en-US")} {total === 1 ? "conversation" : "conversations"}
        </span>
      </nav>

      {rows.length === 0 ? (
        <EmptyState
          icon={PhoneCall}
          title={level ? `No ${level} conversations` : "No calls yet"}
          description={canTry ? `Answered calls and texts appear here. Try ${aiName} in the sandbox console to see one.` : "Answered calls and texts appear here."}
          action={
            canTry && (
              <Link href="/calls/sandbox" className={buttonVariants()}>
                <Sparkles aria-hidden /> Talk to {aiName}
              </Link>
            )
          }
        />
      ) : (
        <ul className="grid gap-2">
          {rows.map((c) => (
            <li key={c.id}>
              <Link
                href={`/calls/${c.id}`}
                className={cn(
                  "group flex items-center gap-4 rounded-lg border border-l-4 bg-card p-4 shadow-card transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  c.triage_level === "emergency" ? "border-l-destructive" : c.triage_level === "urgent" ? "border-l-warning" : "border-l-transparent",
                )}
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
                  <ChannelIcon channel={c.channel} />
                </span>
                <span className="grid min-w-0 flex-1 gap-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_auto] sm:items-center sm:gap-4">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{c.client_name ?? (c.caller_number ? formatPhone(c.caller_number) : "Unknown caller")}</span>
                    <span className="block truncate text-caption text-muted-foreground">
                      {[c.patient_name, formatWhen(c.started_at, tz)].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="truncate text-small text-muted-foreground">
                    {!c.ended_at && <span className="mr-1.5 text-caption font-semibold uppercase tracking-wider text-primary">Open</span>}
                    {c.summary}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                    {c.after_hours && (
                      <span className="inline-flex items-center gap-1 text-caption text-muted-foreground" title="After hours">
                        <Moon className="size-3.5" aria-hidden /> After hours
                      </span>
                    )}
                    {c.triage_level !== "routine" && <TriageBadge level={c.triage_level} />}
                    {c.sandbox && <SandboxBadge />}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/calls" params={{ level }} />
    </>
  );
}
