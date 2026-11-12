import { SectionPage, sectionMetadata } from "@/features/shell/section-page";

export const metadata = sectionMetadata("/team");

export default function Page() {
  return (
    <SectionPage
      href="/team"
      permission="staff.manage"
      description="Who works here and what they can do."
      emptyTitle="Team management"
      emptyDescription="Invite staff and set their roles here."
    />
  );
}
