import type { Metadata } from "next";
import { PageHeader } from "@/components/patterns/page-header";
import { createClientAction } from "@/features/clients/actions";
import { requirePage } from "@/features/clients/access";
import { ClientForm } from "@/features/clients/client-form";

export const metadata: Metadata = { title: "Add client · Vetrix" };

export default async function NewClientPage() {
  await requirePage("clients.manage");
  return (
    <>
      <PageHeader title="Add client" description="You can add their pets on the next screen." />
      <ClientForm action={createClientAction} cancelHref="/clients" submitLabel="Add client" />
    </>
  );
}
