import { loadOverview } from "@vetrix/db/runtime";
import { SectionPage, sectionMetadata } from "@/features/shell/section-page";

export const metadata = sectionMetadata("/patients");

export default function Page() {
  return (
    <SectionPage
      href="/patients"
      permission="patients.view"
      description="Pets, their history, vaccines and prevention."
      emptyTitle="No patients to show yet"
      noun={["active patient", "active patients"]}
      onFile={async (shell) => (await loadOverview(shell.clinic, shell.location.id)).counts.activePatients}
      emptyDescription="Pets appear here when they are imported or added with their owner."
    />
  );
}
