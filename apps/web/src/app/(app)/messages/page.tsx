import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Mail, MessageSquareText, Phone } from "lucide-react";
import { formatPhone, MESSAGE_KIND_LABEL } from "@vetrix/domain";
import { listMessages } from "@vetrix/db/runtime";
import { EmptyState } from "@/components/patterns/empty-state";
import { PageHeader } from "@/components/patterns/page-header";
import { Pagination } from "@/components/patterns/pagination";
import { SearchBox } from "@/components/patterns/search-box";
import { requirePage } from "@/features/clients/access";
import { formatWhen } from "@/features/front-desk/labels";
import { MessageStatusBadge } from "@/features/messages/status";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Messages · Vetrix" };
const PAGE_SIZE = 30;
const FILTERS = [
  { value: undefined, label: "All" },
  { value: "sms", label: "Texts" },
  { value: "email", label: "Emails" },
] as const;

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ channel?: string; q?: string; page?: string }> }) {
  const shell = await requirePage("messages.view");
  const sp = await searchParams;
  const channel = sp.channel === "sms" || sp.channel === "email" ? sp.channel : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, total } = await listMessages(shell.clinic, shell.location.id, { channel, q: sp.q, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  const tz = shell.location.timezone;

  return (
    <>
      <PageHeader title="Messages" description="Texts and emails with clients: confirmations, emergency details and messages from your team." />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav className="flex flex-wrap gap-2" aria-label="Filter by channel">
          {FILTERS.map((f) => (
            <Link
              key={f.label}
              href={{ pathname: "/messages", query: { ...(f.value ? { channel: f.value } : {}), ...(sp.q ? { q: sp.q } : {}) } }}
              aria-current={channel === f.value ? "page" : undefined}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-small font-medium transition-colors",
                channel === f.value ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
              )}
            >
              {f.label}
            </Link>
          ))}
        </nav>
        <SearchBox label="Search messages" placeholder="Client name or phone" />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={MessageSquareText}
          title={sp.q || channel ? "No messages match" : "No messages yet"}
          description="Booking confirmations, emergency details and messages your team sends appear here. To write to a client, open them and choose Message."
        />
      ) : (
        <ul className="grid gap-2">
          {rows.map((m) => {
            const Icon = m.channel === "email" ? Mail : m.channel === "ai_call" ? Phone : MessageSquareText;
            return (
              <li key={m.id}>
                <Link
                  href={`/messages/${m.client_id}`}
                  className="group flex items-start gap-4 rounded-lg border bg-card p-4 shadow-card transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
                    <Icon className="size-4" aria-label={m.channel === "email" ? "Email" : "Text"} />
                  </span>
                  <span className="grid min-w-0 flex-1 gap-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-semibold">{m.client_name}</span>
                      <span className="text-caption text-muted-foreground tabular-nums">{formatPhone(m.mobile)}</span>
                      <span className="text-caption text-muted-foreground">· {MESSAGE_KIND_LABEL[m.template_key] ?? m.template_key.replace(/_/g, " ")}{m.sent_by_name ? ` by ${m.sent_by_name}` : ""}</span>
                    </span>
                    <span className="line-clamp-2 text-small text-muted-foreground">{m.subject ? <strong className="font-medium text-foreground">{m.subject}: </strong> : null}{m.body}</span>
                  </span>
                  <span className="grid shrink-0 justify-items-end gap-1.5">
                    <span className="text-caption text-muted-foreground">{formatWhen(m.created_at, tz)}</span>
                    <MessageStatusBadge status={m.status} />
                  </span>
                  <ChevronRight className="mt-3 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/messages" params={{ channel, q: sp.q }} />
    </>
  );
}
