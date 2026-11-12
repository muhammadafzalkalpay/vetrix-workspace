import { SectionPage, sectionMetadata } from "@/features/shell/section-page";

export const metadata = sectionMetadata("/schedule");

export default function Page() {
  return (
    <SectionPage
      href="/schedule"
      permission="schedule.view"
      description="Appointments by day, doctor and room."
      emptyTitle="No appointments today"
      emptyDescription="Visits booked by your team, by owners online, or by Riley on the phone appear here."
    />
  );
}
