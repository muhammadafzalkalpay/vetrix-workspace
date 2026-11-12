import { SectionPage, sectionMetadata } from "@/features/shell/section-page";

export const metadata = sectionMetadata("/messages");

export default function Page() {
  return (
    <SectionPage
      href="/messages"
      permission="messages.view"
      description="Texts and emails with clients."
      emptyTitle="No messages yet"
      emptyDescription="Confirmations, reminders and replies appear here as conversations."
    />
  );
}
