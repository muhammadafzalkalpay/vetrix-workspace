import { SectionPage, sectionMetadata } from "@/features/shell/section-page";

export const metadata = sectionMetadata("/tasks");

export default function Page() {
  return (
    <SectionPage
      href="/tasks"
      permission="tasks.view"
      description="Follow-ups for your team, such as callbacks and drop-off checks."
      emptyTitle="No open tasks"
      emptyDescription="When a call or reminder needs a person, Vetrix adds a task here."
    />
  );
}
