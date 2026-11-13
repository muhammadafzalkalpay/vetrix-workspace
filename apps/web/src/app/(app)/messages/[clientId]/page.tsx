import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, Mail, MessageSquareText, Phone, User } from "lucide-react";
import { canContact, formatPhone, MESSAGE_KIND_LABEL } from "@vetrix/domain";
import { getClientThread } from "@vetrix/db/runtime";
import { Panel } from "@/components/patterns/detail-list";
import { PageHeader } from "@/components/patterns/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { assertId, orNotFound, requirePage } from "@/features/clients/access";
import { formatWhen, SandboxBadge } from "@/features/front-desk/labels";
import { Compose } from "@/features/messages/compose";
import { MessageStatusBadge } from "@/features/messages/status";
import { getMessagingMode } from "@/lib/env";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Messages · Vetrix" };

export default async function ClientMessagesPage({ params }: { params: Promise<{ clientId: string }> }) {
  const shell = await requirePage("messages.view");
  const clientId = assertId((await params).clientId);
  const { client, items, conversations } = await orNotFound(getClientThread(shell.clinic, shell.location.id, clientId));
  const tz = shell.location.timezone;
  const canSend = shell.permissions.has("messages.send");
  const contact = { smsConsent: client.sms_consent, email: client.email, flags: client.flags };
  const doNotContact = client.flags.includes("do_not_contact");
  const ghost = cn(buttonVariants({ variant: "outline", size: "sm" }), "border-white/30 bg-white/10 text-white hover:bg-white/20");

  return (
    <>
      <PageHeader
        title={`${client.first_name} ${client.last_name}`}
        description={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5 tabular-nums">
              <Phone className="size-4" aria-hidden /> {formatPhone(client.mobile)}
            </span>
            {client.email && (
              <span className="inline-flex items-center gap-1.5">
                <Mail className="size-4" aria-hidden /> {client.email}
              </span>
            )}
          </span>
        }
        actions={
          <div className="flex gap-2">
            <Link href="/messages" className={ghost}>
              <ChevronLeft aria-hidden /> Messages
            </Link>
            {shell.permissions.has("clients.view") && (
              <Link href={`/clients/${client.id}`} className={ghost}>
                <User aria-hidden /> Client
              </Link>
            )}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel title="History">
          {items.length === 0 ? (
            <p className="text-small text-muted-foreground">No texts or emails with {client.first_name} yet.</p>
          ) : (
            <ol className="grid gap-4">
              {items.map((it) =>
                it.kind === "in" ? (
                  <li key={`in-${it.id}`} className="flex flex-col items-start gap-1">
                    <span className="text-caption text-muted-foreground">
                      {client.first_name} · {formatWhen(it.at, tz)}
                    </span>
                    <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm border bg-muted/40 px-4 py-2.5 text-small">{it.body}</p>
                  </li>
                ) : (
                  <li key={`out-${it.id}`} className="flex flex-col items-end gap-1">
                    <span className="flex flex-wrap items-center justify-end gap-1.5 text-caption text-muted-foreground">
                      {it.channel === "email" ? <Mail className="size-3.5" aria-label="Email" /> : <MessageSquareText className="size-3.5" aria-label="Text" />}
                      {MESSAGE_KIND_LABEL[it.template_key] ?? it.template_key.replace(/_/g, " ")}
                      {it.sent_by_name ? ` by ${it.sent_by_name}` : ""} · {formatWhen(it.at, tz)}
                      <MessageStatusBadge status={it.status} />
                    </span>
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-small text-primary-foreground">
                      {it.subject && <p className="mb-1 font-semibold">{it.subject}</p>}
                      {it.body}
                    </div>
                    {it.error && <span className="text-caption text-destructive">{it.error}</span>}
                  </li>
                ),
              )}
            </ol>
          )}
        </Panel>

        <div className="grid content-start gap-6">
          <Panel title="New message">
            {canSend ? (
              <Compose
                clientId={client.id}
                firstName={client.first_name}
                canText={canContact(contact, "sms")}
                textBlockedReason={doNotContact ? `${client.first_name} is marked do not contact.` : `${client.first_name} has opted out of texts (STOP). Send an email or call instead.`}
                canEmail={canContact(contact, "email")}
                emailBlockedReason={doNotContact ? `${client.first_name} is marked do not contact.` : `There is no email address on file for ${client.first_name}.`}
                sandbox={getMessagingMode() === "sandbox"}
              />
            ) : (
              <p className="text-small text-muted-foreground">You can read messages but not send them.</p>
            )}
          </Panel>

          {conversations.length > 0 && shell.permissions.has("calls.view") && (
            <Panel title="Text conversations with the front desk">
              <ul className="grid gap-2">
                {conversations.map((c) => (
                  <li key={c.id}>
                    <Link href={`/calls/${c.id}`} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 transition-colors hover:bg-muted">
                      <span className="grid min-w-0">
                        <span className="truncate text-small font-medium">{c.summary ?? "Conversation"}</span>
                        <span className="text-caption text-muted-foreground">{formatWhen(c.started_at, tz)}</span>
                      </span>
                      {c.sandbox ? <SandboxBadge /> : <Badge variant="muted">Live</Badge>}
                    </Link>
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
