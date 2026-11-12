import { SectionPage, sectionMetadata } from "@/features/shell/section-page";

export const metadata = sectionMetadata("/calls");

export default function Page() {
  return (
    <SectionPage
      href="/calls"
      permission="calls.view"
      description="Every call Riley answered, with transcript and triage."
      emptyTitle="No calls yet"
      emptyDescription="Answered calls appear here with what was said, the triage level and what was booked."
    />
  );
}
