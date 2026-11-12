import type { Metadata } from "next";
import { getClient } from "@vetrix/db/runtime";
import { formatPhone } from "@vetrix/domain";
import { PageHeader } from "@/components/patterns/page-header";
import { updateClientAction } from "@/features/clients/actions";
import { assertId, orNotFound, requirePage } from "@/features/clients/access";
import { ClientForm } from "@/features/clients/client-form";

export const metadata: Metadata = { title: "Edit client · Vetrix" };

export default async function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  const shell = await requirePage("clients.manage");
  const id = assertId((await params).id);
  const c = await orNotFound(getClient(shell.clinic, shell.location.id, id));
  return (
    <>
      <PageHeader title={`Edit ${c.first_name} ${c.last_name}`} />
      <ClientForm
        action={updateClientAction.bind(null, id)}
        cancelHref={`/clients/${id}`}
        submitLabel="Save changes"
        initial={{
          firstName: c.first_name,
          lastName: c.last_name,
          mobile: formatPhone(c.mobile),
          email: c.email ?? "",
          altPhone: c.alt_phone ? formatPhone(c.alt_phone) : "",
          address: c.address ?? "",
          preferredChannel: c.preferred_channel,
          smsConsent: c.sms_consent,
          marketingConsent: c.marketing_consent,
          notes: c.notes ?? "",
          flags: c.flags,
        }}
      />
    </>
  );
}
