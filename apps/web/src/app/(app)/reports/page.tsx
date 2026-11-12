import { SectionPage, sectionMetadata } from "@/features/shell/section-page";

export const metadata = sectionMetadata("/reports");

export default function Page() {
  return (
    <SectionPage
      href="/reports"
      permission="reports.view"
      description="Calls, bookings and pets brought back."
      emptyTitle="No reports yet"
      emptyDescription="Reports fill in once Vetrix is answering calls and booking visits."
    />
  );
}
