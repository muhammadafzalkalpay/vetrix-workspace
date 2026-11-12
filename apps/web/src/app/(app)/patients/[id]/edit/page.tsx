import type { Metadata } from "next";
import { getPatient } from "@vetrix/db/runtime";
import { PageHeader } from "@/components/patterns/page-header";
import { updatePatientAction } from "@/features/clients/actions";
import { assertId, orNotFound, requirePage } from "@/features/clients/access";
import { PatientForm } from "@/features/clients/patient-form";
import { clinicToday } from "@/lib/clinic-date";

export const metadata: Metadata = { title: "Edit pet · Vetrix" };

export default async function EditPatientPage({ params }: { params: Promise<{ id: string }> }) {
  const shell = await requirePage("patients.manage");
  const id = assertId((await params).id);
  const p = await orNotFound(getPatient(shell.clinic, shell.location.id, id));
  return (
    <>
      <PageHeader title={`Edit ${p.name}`} description={`Owner: ${p.owner_name}`} />
      <PatientForm
        action={updatePatientAction.bind(null, id)}
        cancelHref={`/patients/${id}`}
        submitLabel="Save changes"
        today={clinicToday(shell.location.timezone)}
        initial={{
          name: p.name,
          species: p.species,
          breed: p.breed ?? "",
          sex: p.sex ?? "",
          neutered: p.neutered == null ? "" : p.neutered ? "yes" : "no",
          dateOfBirth: p.date_of_birth ?? "",
          approxAgeMonths: p.approx_age_months,
          weightKg: p.weight_kg ?? "",
          colorMarkings: p.color_markings ?? "",
          microchipNumber: p.microchip_number ?? "",
          medicalAlerts: p.medical_alerts ?? "",
          temperamentFlags: p.temperament_flags,
        }}
      />
    </>
  );
}
