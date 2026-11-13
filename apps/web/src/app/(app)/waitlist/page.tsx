import type { Metadata } from "next";
import Link from "next/link";
import { Hourglass } from "lucide-react";
import type { Species } from "@vetrix/domain";
import { listBookableProviders, listServices, listWaitlist } from "@vetrix/db/runtime";
import { Panel } from "@/components/patterns/detail-list";
import { EmptyState } from "@/components/patterns/empty-state";
import { PageHeader } from "@/components/patterns/page-header";
import { Badge } from "@/components/ui/badge";
import { requirePage } from "@/features/clients/access";
import { SpeciesIcon } from "@/features/clients/species-icon";
import { formatWhen } from "@/features/front-desk/labels";
import { AddToWaitlist, RemoveEntry } from "@/features/waitlist/add-form";

export const metadata: Metadata = { title: "Waitlist · Vetrix" };

const OFFER_LABEL: Record<string, string> = { sent: "Offered", claimed: "Claimed", slot_taken: "Taken by someone else", expired: "No reply" };

export default async function WaitlistPage() {
  const shell = await requirePage("schedule.view");
  const canManage = shell.permissions.has("schedule.manage");
  const [rows, services, providers] = await Promise.all([
    listWaitlist(shell.clinic, shell.location.id),
    canManage ? listServices(shell.clinic, shell.location.id) : Promise.resolve([]),
    canManage ? listBookableProviders(shell.clinic, shell.location.id) : Promise.resolve([]),
  ]);
  const tz = shell.location.timezone;

  return (
    <>
      <PageHeader
        title="Waitlist"
        description="When a visit in the next 72 hours is cancelled, the time is offered by text to the first three matching pets. First to claim gets it; after 30 minutes the AI calls the next two."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section className="grid content-start gap-2" aria-label="Waiting">
          {rows.length === 0 ? (
            <EmptyState icon={Hourglass} title="No one is waiting" description="Add pets who want an earlier time. They'll be offered cancellations automatically." />
          ) : (
            rows.map((r) => {
              const last = r.offers.at(-1);
              return (
                <div key={r.id} className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-card sm:flex-row sm:items-center">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
                    <SpeciesIcon species={r.species as Species} className="size-5" />
                  </span>
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <p className="font-semibold">
                      <Link href={`/patients/${r.patient_id}`} className="hover:underline">{r.pet_name}</Link>
                      <span className="text-small font-normal text-muted-foreground"> · {r.client_name}</span>
                    </p>
                    <p className="text-small">
                      {r.service_name}
                      <span className="text-muted-foreground"> · {r.provider_name ? `prefers ${r.provider_name}` : "any provider"}</span>
                    </p>
                    <p className="text-caption text-muted-foreground">
                      Waiting since {formatWhen(r.created_at, tz)}
                      {last ? ` · last offer: ${formatWhen(new Date(last.start), tz)} (${OFFER_LABEL[last.status] ?? last.status})` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={r.status === "offered" ? "warning" : "muted"}>{r.status === "offered" ? "Offer open" : "Waiting"}</Badge>
                    {canManage && <RemoveEntry entryId={r.id} />}
                  </div>
                </div>
              );
            })
          )}
        </section>
        {canManage && (
          <Panel title="Add to the waitlist">
            <AddToWaitlist services={services.map((s) => ({ id: s.id, name: s.name }))} providers={providers.map((p) => ({ id: p.id, name: p.name }))} />
          </Panel>
        )}
      </div>
    </>
  );
}
