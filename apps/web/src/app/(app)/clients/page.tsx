import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Plus, Users } from "lucide-react";
import { formatPhone } from "@vetrix/domain";
import { searchClients } from "@vetrix/db/runtime";
import { EmptyState } from "@/components/patterns/empty-state";
import { PageHeader } from "@/components/patterns/page-header";
import { Pagination } from "@/components/patterns/pagination";
import { SearchBox } from "@/components/patterns/search-box";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { requirePage } from "@/features/clients/access";
import { CLIENT_FLAG_LABEL } from "@/features/clients/labels";
import { SpeciesIcon } from "@/features/clients/species-icon";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Clients · Vetrix" };
const PAGE_SIZE = 25;

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const shell = await requirePage("clients.view");
  const { q, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const { rows, total } = await searchClients(shell.clinic, shell.location.id, { q, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  const canAdd = shell.permissions.has("clients.manage");

  return (
    <>
      <PageHeader
        title="Clients"
        description="Owners and households."
        actions={
          canAdd && (
            <Link href="/clients/new" className={cn(buttonVariants(), "bg-white text-primary-dark hover:bg-white/90")}>
              <Plus aria-hidden /> Add client
            </Link>
          )
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchBox label="Search clients" placeholder="Name, phone, email or pet name" />
        <p className="text-small text-muted-foreground" aria-live="polite">
          {total.toLocaleString("en-US")} {total === 1 ? "client" : "clients"}
          {q ? ` matching “${q}”` : ""}
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title={q ? "No clients match that search" : "No clients yet"}
          description={q ? "Try part of the name, the last 4 digits of the phone, or the pet's name." : "Add a client or import them from your practice system."}
        />
      ) : (
        <ul className="grid gap-2">
          {rows.map((c) => (
            <li key={c.id}>
              <Link
                href={`/clients/${c.id}`}
                className="group flex items-center gap-4 rounded-lg border bg-card p-4 shadow-card transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-small font-semibold text-secondary-foreground">
                  {c.first_name[0]}
                  {c.last_name[0]}
                </span>
                <span className="grid min-w-0 flex-1 gap-1 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.4fr)] sm:items-center sm:gap-4">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">
                      {c.first_name} {c.last_name}
                    </span>
                    {c.flags.length > 0 && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {c.flags.map((f) => (
                          <Badge key={f} variant={f.startsWith("do_not") ? "danger" : f === "vip" ? "success" : "warning"}>
                            {CLIENT_FLAG_LABEL[f]}
                          </Badge>
                        ))}
                      </span>
                    )}
                  </span>
                  <span className="truncate text-small text-muted-foreground tabular-nums">{formatPhone(c.mobile)}</span>
                  <span className="flex min-w-0 flex-wrap gap-1.5">
                    {c.pets.slice(0, 4).map((p) => (
                      <span
                        key={p.id}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption font-medium",
                          p.status === "active" ? "bg-muted text-foreground" : "bg-muted text-muted-foreground line-through",
                        )}
                      >
                        <SpeciesIcon species={p.species} className="size-3.5 text-primary" />
                        {p.name}
                      </span>
                    ))}
                    {c.pets.length > 4 && <span className="text-caption text-muted-foreground">+{c.pets.length - 4}</span>}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/clients" params={{ q }} />
    </>
  );
}
