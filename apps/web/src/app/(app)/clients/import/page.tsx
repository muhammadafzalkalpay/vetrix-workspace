import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/patterns/page-header";
import { ImportWizard } from "@/features/import/import-wizard";
import { requireShell } from "@/lib/session";

export const metadata: Metadata = { title: "Import clients and pets · Vetrix" };

export default async function ImportPage() {
  const shell = await requireShell();
  if (!shell.permissions.has("clients.manage") || !shell.permissions.has("patients.manage")) notFound();
  return (
    <>
      <PageHeader
        title="Import clients and pets"
        description={`Bring your existing records into ${shell.location.name}. You see a preview before anything is saved.`}
      />
      <ImportWizard />
    </>
  );
}
