import type { Metadata } from "next";
import { getClient } from "@vetrix/db/runtime";
import { PageHeader } from "@/components/patterns/page-header";
import { createPatientAction } from "@/features/clients/actions";
import { assertId, orNotFound, requirePage } from "@/features/clients/access";
import { PatientForm } from "@/features/clients/patient-form";
import { clinicToday } from "@/lib/clinic-date";

export const metadata: Metadata = { title: "Add pet · Vetrix" };

export default async function NewPetPage({ params }: { params: Promise<{ id: string }> }) {
  const shell = await requirePage("patients.manage");
  const id = assertId((await params).id);
  const c = await orNotFound(getClient(shell.clinic, shell.location.id, id));
  return (
    <>
      <PageHeader title="Add pet" description={`Owner: ${c.first_name} ${c.last_name}`} />
      <PatientForm
        action={createPatientAction.bind(null, id)}
        cancelHref={`/clients/${id}`}
        submitLabel="Add pet"
        today={clinicToday(shell.location.timezone)}
      />
    </>
  );
}
