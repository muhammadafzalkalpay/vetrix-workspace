import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Mail, MessageSquare, Pencil, Phone, Plus, ShieldCheck, ShieldOff, Users, MessageSquareText } from "lucide-react";
import { ageInMonths, canContact, formatAge, formatPhone } from "@vetrix/domain";
import { getClient } from "@vetrix/db/runtime";
import { DetailList, Panel } from "@/components/patterns/detail-list";
import { EmptyState } from "@/components/patterns/empty-state";
import { PageHeader } from "@/components/patterns/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { assertId, orNotFound, requirePage } from "@/features/clients/access";
import { CHANNEL_LABEL, CLIENT_FLAG_LABEL, SPECIES_LABEL } from "@/features/clients/labels";
import { SavedNotice } from "@/features/clients/saved-notice";
import { PetAvatar } from "@/features/clients/species-icon";
import { clinicToday, formatDate } from "@/lib/clinic-date";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Client · Vetrix" };

const WHITE_BUTTON = cn(buttonVariants({ size: "sm" }), "bg-white text-primary-dark hover:bg-white/90");

export default async function ClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const shell = await requirePage("clients.view");
  const id = assertId((await params).id);
  const { saved } = await searchParams;
  const c = await orNotFound(getClient(shell.clinic, shell.location.id, id));
  const today = clinicToday(shell.location.timezone);
  const canEdit = shell.permissions.has("clients.manage");
  const canAddPet = shell.permissions.has("patients.manage");
  const contact = { smsConsent: c.sms_consent, email: c.email, flags: c.flags };

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 text-small text-muted-foreground">
        <Link href="/clients" className="hover:text-foreground hover:underline">
          Clients
        </Link>{" "}
        / <span className="text-foreground">{c.first_name} {c.last_name}</span>
      </nav>
      <SavedNotice show={saved === "1"} />
      <PageHeader
        title={`${c.first_name} ${c.last_name}`}
        description={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5 tabular-nums">
              <Phone className="size-4" aria-hidden /> {formatPhone(c.mobile)}
            </span>
            {c.email && (
              <span className="inline-flex items-center gap-1.5">
                <Mail className="size-4" aria-hidden /> {c.email}
              </span>
            )}
          </span>
        }
        actions={
          <div className="flex gap-2">
            {shell.permissions.has("messages.view") && (
              <Link href={`/messages/${c.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "border-white/30 bg-white/10 text-white hover:bg-white/20")}>
                <MessageSquareText aria-hidden /> Message
              </Link>
            )}
            {canEdit && (
              <Link href={`/clients/${c.id}/edit`} className={WHITE_BUTTON}>
                <Pencil aria-hidden /> Edit
              </Link>
            )}
          </div>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-5">
          <Panel
            title={`Pets (${c.pets.length})`}
            action={
              canAddPet && (
                <Link href={`/clients/${c.id}/pets/new`} className={buttonVariants({ size: "sm", variant: "outline" })}>
                  <Plus aria-hidden /> Add pet
                </Link>
              )
            }
          >
            {c.pets.length === 0 ? (
              <EmptyState icon={Users} title="No pets yet" description="Add the first pet for this client." className="py-8" />
            ) : (
              <ul className="grid gap-2">
                {c.pets.map((p) => {
                  const inactive = p.status !== "active";
                  return (
                    <li key={p.id}>
                      <Link
                        href={`/patients/${p.id}`}
                        className="group flex items-center gap-3 rounded-lg border p-3 transition-colors hover:border-primary/40 hover:bg-muted/40"
                      >
                        <PetAvatar species={p.species} inactive={inactive} />
                        <span className="grid min-w-0 flex-1">
                          <span className="flex items-center gap-2 font-semibold">
                            {p.name}
                            {p.status === "deceased" && <Badge variant="muted">Deceased</Badge>}
                            {p.owner_id !== c.id && <Badge variant="secondary">Shared</Badge>}
                          </span>
                          <span className="truncate text-small text-muted-foreground">
                            {[SPECIES_LABEL[p.species], p.breed, formatAge(ageInMonths({ dateOfBirth: p.date_of_birth, approxAgeMonths: p.approx_age_months }, today))]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                        <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel title="Details">
            <DetailList
              items={[
                ["Other phone", c.alt_phone ? formatPhone(c.alt_phone) : null],
                ["Preferred contact", CHANNEL_LABEL[c.preferred_channel]],
                ["Address", c.address],
                ["Client since", formatDate(c.created_at.toISOString().slice(0, 10))],
                ["Missed visits", c.no_show_count],
                ["Added by", { phone_ai: "Riley (phone)", web: "Online booking", import: "Import", staff: "Staff" }[c.source]],
              ]}
            />
            {c.notes && <p className="whitespace-pre-line rounded-md bg-muted p-3 text-small">{c.notes}</p>}
          </Panel>
        </div>

        <div className="grid content-start gap-5">
          <Panel title="Contact permissions">
            <ul className="grid gap-2 text-small">
              {(["sms", "email", "call"] as const).map((ch) => {
                const ok = canContact(contact, ch);
                return (
                  <li key={ch} className="flex items-center gap-2.5">
                    {ok ? (
                      <ShieldCheck className="size-4 text-success-text" aria-hidden />
                    ) : (
                      <ShieldOff className="size-4 text-destructive" aria-hidden />
                    )}
                    <span className="flex-1">{CHANNEL_LABEL[ch]}</span>
                    <span className={ok ? "text-success-text" : "text-destructive"}>{ok ? "Allowed" : "Blocked"}</span>
                  </li>
                );
              })}
            </ul>
            {!c.sms_consent && (
              <p className="flex gap-2 rounded-md bg-warning-soft p-3 text-small text-warning-text">
                <MessageSquare className="mt-0.5 size-4 shrink-0" aria-hidden />
                No text consent. Confirmations go by email or an AI call instead.
              </p>
            )}
            {c.flags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {c.flags.map((f) => (
                  <Badge key={f} variant={f.startsWith("do_not") ? "danger" : f === "vip" ? "success" : "warning"}>
                    {CLIENT_FLAG_LABEL[f]}
                  </Badge>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Household">
            {c.household.length === 0 ? (
              <p className="text-small text-muted-foreground">No other people in this household.</p>
            ) : (
              <ul className="grid gap-2">
                {c.household.map((m) => (
                  <li key={m.id}>
                    <Link href={`/clients/${m.id}`} className="flex items-center justify-between gap-2 rounded-md p-2 hover:bg-muted">
                      <span className="font-medium">
                        {m.first_name} {m.last_name}
                        {m.is_primary && <span className="ml-2 text-caption text-muted-foreground">Main contact</span>}
                      </span>
                      <span className="text-small text-muted-foreground tabular-nums">{formatPhone(m.mobile)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
