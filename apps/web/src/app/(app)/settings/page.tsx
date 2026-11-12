import { SectionPage, sectionMetadata } from "@/features/shell/section-page";

export const metadata = sectionMetadata("/settings");

export default function Page() {
  return (
    <SectionPage
      href="/settings"
      permission="settings.manage"
      description="Hours, services, rooms and how Riley answers."
      emptyTitle="Clinic settings"
      emptyDescription="Hours, services, rooms and AI settings are managed here."
    />
  );
}
