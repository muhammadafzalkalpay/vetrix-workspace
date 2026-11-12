import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, PawPrint } from "lucide-react";
import { ageInMonths, formatAge, SPECIES, type PatientStatus, type Species } from "@vetrix/domain";
import { searchPatients } from "@vetrix/db/runtime";
import { EmptyState } from "@/components/patterns/empty-state";
import { PageHeader } from "@/components/patterns/page-header";
import { Pagination } from "@/components/patterns/pagination";
import { SearchBox } from "@/components/patterns/search-box";
import { Badge } from "@/components/ui/badge";
import { requirePage } from "@/features/clients/access";
import { SPECIES_LABEL, TEMPERAMENT_LABEL } from "@/features/clients/labels";
import { PetAvatar } from "@/features/clients/species-icon";
import { clinicToday } from "@/lib/clinic-date";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Patients · Vetrix" };
const PAGE_SIZE = 25;
const STATUSES: { value: PatientStatus | "all"; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "deceased", label: "Deceased" },
  { value: "all", label: "All" },
];

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; status?: string; species?: string }>;
}) {
  const shell = await requirePage("patients.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const status = (STATUSES.find((s) => s.value === sp.status)?.value ?? "active") as PatientStatus | "all";
  const species = (SPECIES as readonly string[]).includes(sp.species ?? "") ? (sp.species as Species) : undefined;
  const { rows, total } = await searchPatients(shell.clinic, shell.location.id, {
    q: sp.q,
    status,
    species,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const today = clinicToday(shell.location.timezone);
  const filterHref = (next: Record<string, string | undefined>) => {
    const q = new URLSearchParams(Object.entries({ q: sp.q, status, species, ...next }).filter((e): e is [string, string] => Boolean(e[1])));
    if (q.get("status") === "active") q.delete("status");
    return `/patients${q.toString() ? `?${q}` : ""}`;
  };
  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1.5 text-small font-medium transition-colors",
      active ? "border-primary bg-secondary text-secondary-foreground" : "bg-card text-muted-foreground hover:bg-muted",
    );

  return (
    <>
      <PageHeader title="Patients" description="Pets, their history, vaccines and prevention." />
      <div className="mb-4 grid gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SearchBox label="Search patients" placeholder="Pet name, owner or microchip" />
          <p className="text-small text-muted-foreground" aria-live="polite">
            {total.toLocaleString("en-US")} {total === 1 ? "patient" : "patients"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2" aria-label="Filters">
          {STATUSES.map((s) => (
            <Link key={s.value} href={filterHref({ status: s.value, page: undefined })} className={chip(status === s.value)} aria-current={status === s.value}>
              {s.label}
            </Link>
          ))}
          <span className="mx-1 w-px self-stretch bg-border" aria-hidden />
          <Link href={filterHref({ species: undefined, page: undefined })} className={chip(!species)} aria-current={!species}>
            All species
          </Link>
          {(["dog", "cat", "rabbit", "bird", "reptile", "other"] as const).map((s) => (
            <Link key={s} href={filterHref({ species: s, page: undefined })} className={chip(species === s)} aria-current={species === s}>
              {SPECIES_LABEL[s]}
            </Link>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={PawPrint} title="No patients match" description="Try another name or clear the filters." />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((p) => (
            <li key={p.id}>
              <Link
                href={`/patients/${p.id}`}
                className="group flex h-full items-center gap-3 rounded-lg border bg-card p-4 shadow-card transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <PetAvatar species={p.species} inactive={p.status !== "active"} />
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="flex items-center gap-2 font-semibold">
                    <span className="truncate">{p.name}</span>
                    {p.status === "deceased" && <Badge variant="muted">Deceased</Badge>}
                  </span>
                  <span className="truncate text-small text-muted-foreground">
                    {[p.breed ?? SPECIES_LABEL[p.species], formatAge(ageInMonths({ dateOfBirth: p.date_of_birth, approxAgeMonths: p.approx_age_months }, today))].join(" · ")}
                  </span>
                  <span className="truncate text-caption text-muted-foreground">Owner: {p.owner_name}</span>
                  {p.temperament_flags.length > 0 && (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {p.temperament_flags.map((f) => (
                        <Badge key={f} variant="warning">
                          {TEMPERAMENT_LABEL[f]}
                        </Badge>
                      ))}
                    </span>
                  )}
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/patients" params={{ q: sp.q, status: status === "active" ? undefined : status, species }} />
    </>
  );
}
