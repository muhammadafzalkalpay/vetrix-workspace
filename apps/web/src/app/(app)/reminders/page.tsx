import { SectionPage, sectionMetadata } from "@/features/shell/section-page";

export const metadata = sectionMetadata("/reminders");

export default function Page() {
  return (
    <SectionPage
      href="/reminders"
      permission="reminders.manage"
      description="Pets due for care, grouped by household."
      emptyTitle="No reminders running"
      emptyDescription="Vaccine, wellness and follow-up reminders appear here when pets are due."
    />
  );
}
