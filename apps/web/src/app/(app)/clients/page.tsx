import { loadOverview } from "@vetrix/db/runtime";
import { SectionPage, sectionMetadata } from "@/features/shell/section-page";

export const metadata = sectionMetadata("/clients");

export default function Page() {
  return (
    <SectionPage
      href="/clients"
      permission="clients.view"
      description="Owners and households."
      emptyTitle="No clients to show yet"
      noun={["client", "clients"]}
      onFile={async (shell) => (await loadOverview(shell.clinic, shell.location.id)).counts.clients}
      emptyDescription="Clients appear here when they are imported from your practice system or added by your team."
    />
  );
}
