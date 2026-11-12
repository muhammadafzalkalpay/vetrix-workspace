import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CalendarPlus, Pencil, Syringe } from "lucide-react";
import { ageInMonths, formatAge, formatPhone } from "@vetrix/domain";
import { getPatient } from "@vetrix/db/runtime";
import { DetailList, Panel } from "@/components/patterns/detail-list";
import { PageHeader } from "@/components/patterns/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { markDeceasedAction } from "@/features/clients/actions";
import { assertId, orNotFound, requirePage } from "@/features/clients/access";
import { DeceasedDialog } from "@/features/clients/deceased-dialog";
import { SPECIES_LABEL, TEMPERAMENT_LABEL } from "@/features/clients/labels";
import { SavedNotice } from "@/features/clients/saved-notice";
import { PetAvatar } from "@/features/clients/species-icon";
import { clinicToday, formatDate } from "@/lib/clinic-date";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Patient · Vetrix" };

export default async function PatientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; deceased?: string; stopped?: string; upcoming?: string }>;
}) {
  const shell = await requirePage("patients.view");
  const id = assertId((await params).id);
  const { saved, deceased: justMarked, stopped, upcoming } = await searchParams;
  const stoppedN = Number(stopped) || 0;
  const upcomingN = Number(upcoming) || 0;
  const p = await orNotFound(getPatient(shell.clinic, shell.location.id, id));
  const today = clinicToday(shell.location.timezone);
  const canEdit = shell.permissions.has("patients.manage");
  const canBook = shell.permissions.has("schedule.manage");
  const deceased = p.status === "deceased";
  const age = formatAge(ageInMonths({ dateOfBirth: p.date_of_birth, approxAgeMonths: p.approx_age_months }, today));

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 text-small text-muted-foreground">
        <Link href="/patients" className="hover:text-foreground hover:underline">
          Patients
        </Link>{" "}
        / <span className="text-foreground">{p.name}</span>
      </nav>
      <SavedNotice show={saved === "1"} />
      <SavedNotice show={justMarked === "1"}>
        {p.name} is marked as deceased. {stoppedN} reminder{stoppedN === 1 ? "" : "s"} stopped.
        {upcomingN > 0 && ` ${upcomingN} future visit${upcomingN === 1 ? " is" : "s are"} still booked. Review ${upcomingN === 1 ? "it" : "them"} in the schedule.`}
      </SavedNotice>
      <PageHeader
        title={p.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {[SPECIES_LABEL[p.species], p.breed, deceased ? null : age].filter(Boolean).join(" · ")}
            {deceased && <Badge className="bg-white/15 text-white">Deceased {p.deceased_date ? formatDate(p.deceased_date) : ""}</Badge>}
          </span>
        }
        actions={
          <>
            {canBook && !deceased && (
              <Link href={`/schedule/book?patient=${p.id}`} className={cn(buttonVariants({ size: "sm" }), "bg-white text-primary-dark hover:bg-white/90")}>
                <CalendarPlus aria-hidden /> Book visit
              </Link>
            )}
            {canEdit && (
              <Link href={`/patients/${p.id}/edit`} className={cn(buttonVariants({ size: "sm", variant: "outline" }), "border-white/30 bg-white/10 text-white hover:bg-white/20")}>
                <Pencil aria-hidden /> Edit
              </Link>
            )}
          </>
        }
      />

      {p.medical_alerts && (
        <div role="note" className="mb-5 flex gap-3 rounded-lg border border-destructive/30 bg-danger-soft p-4">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
          <div>
            <p className="font-semibold text-destructive">Medical alert</p>
            <p className="whitespace-pre-line text-small">{p.medical_alerts}</p>
          </div>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-5">
          <Panel title="Details">
            <div className="flex items-center gap-3">
              <PetAvatar species={p.species} inactive={deceased} className="size-12" />
              {p.temperament_flags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {p.temperament_flags.map((f) => (
                    <Badge key={f} variant="warning">
                      {TEMPERAMENT_LABEL[f]}
                    </Badge>
                  ))}
                </div>
              ) : (
                <span className="text-small text-muted-foreground">No handling notes</span>
              )}
            </div>
            <DetailList
              items={[
                ["Date of birth", p.date_of_birth ? formatDate(p.date_of_birth) : p.approx_age_months != null ? `About ${age}` : null],
                ["Sex", p.sex ? `${p.sex === "male" ? "Male" : "Female"}${p.neutered == null ? "" : p.neutered ? ", neutered" : ", intact"}` : null],
                ["Weight", p.weight_kg ? `${Number(p.weight_kg)} kg` : null],
                ["Colour and markings", p.color_markings],
                ["Microchip", p.microchip_number],
                ["Last wellness exam", p.last_wellness_exam_at ? formatDate(p.last_wellness_exam_at) : null],
                ["Last dental", p.last_dental_at ? formatDate(p.last_dental_at) : null],
                ["Last surgery", p.last_surgery_at ? formatDate(p.last_surgery_at) : null],
              ]}
            />
          </Panel>

          <Panel title="Vaccines">
            {p.vaccines.length === 0 ? (
              <p className="text-small text-muted-foreground">No vaccines on record.</p>
            ) : (
              <div className="-mx-1 overflow-x-auto">
                <table className="w-full min-w-[420px] text-small">
                  <thead>
                    <tr className="border-b text-left text-caption uppercase tracking-wider text-muted-foreground">
                      <th className="px-1 py-2 font-medium">Vaccine</th>
                      <th className="px-1 py-2 font-medium">Given</th>
                      <th className="px-1 py-2 font-medium">Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.vaccines.map((v) => {
                      const overdue = !deceased && v.due_at !== null && v.due_at < today;
                      return (
                        <tr key={`${v.vaccine}-${v.administered_at}`} className="border-b last:border-0">
                          <td className="px-1 py-2.5">
                            <span className="inline-flex items-center gap-2 font-medium">
                              <Syringe className="size-4 text-primary" aria-hidden />
                              {v.vaccine}
                            </span>
                          </td>
                          <td className="px-1 py-2.5 tabular-nums">{formatDate(v.administered_at)}</td>
                          <td className="px-1 py-2.5 tabular-nums">
                            {formatDate(v.due_at)} {overdue && <Badge variant="warning">Overdue</Badge>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>

        <div className="grid content-start gap-5">
          <Panel title="Owners and contacts">
            <ul className="grid gap-2">
              {p.contacts.map((c) => (
                <li key={c.client_id}>
                  <Link href={`/clients/${c.client_id}`} className="grid gap-0.5 rounded-md p-2 hover:bg-muted">
                    <span className="flex items-center gap-2 font-medium">
                      {c.name}
                      {c.client_id === p.owner_id && <Badge variant="secondary">Owner</Badge>}
                    </span>
                    <span className="text-small text-muted-foreground tabular-nums">
                      {formatPhone(c.mobile)} · {c.receives_reminders ? "Gets reminders" : "No reminders"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>

          {canEdit && !deceased && (
            <Panel title="End of life">
              <p className="text-small text-muted-foreground">
                If the family tells you {p.name} has died, mark it here so they stop getting reminders.
              </p>
              <DeceasedDialog petName={p.name} action={markDeceasedAction.bind(null, p.id)} today={today} />
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
