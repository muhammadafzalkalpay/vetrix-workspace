"use client";

import Link from "next/link";
import { useActionState } from "react";
import { CLIENT_FLAGS, type ClientFlag } from "@vetrix/domain";
import { FormField } from "@/components/patterns/form-field";
import { buttonVariants } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action-result";
import { fieldError, formDefaults, FormError, FormSection, SubmitButton } from "./form-bits";
import { CHANNEL_LABEL, CLIENT_FLAG_LABEL } from "./labels";

export interface ClientFormValues {
  firstName: string;
  lastName: string;
  mobile: string;
  email: string;
  altPhone: string;
  address: string;
  preferredChannel: "sms" | "email" | "call";
  smsConsent: boolean;
  marketingConsent: boolean;
  notes: string;
  flags: ClientFlag[];
}

const FIELDS = ["firstName", "lastName", "mobile", "email", "altPhone", "address", "preferredChannel", "notes", "flags"];

export function ClientForm({
  action,
  initial,
  cancelHref,
  submitLabel,
}: {
  action: (state: ActionResult | null, form: FormData) => Promise<ActionResult>;
  initial?: Partial<ClientFormValues>;
  cancelHref: string;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const v = initial ?? {};
  const d = formDefaults(state);
  return (
    <form key={JSON.stringify(state)} action={formAction} noValidate className="grid gap-5">
      <FormError state={state} fields={FIELDS} />

      <FormSection title="Name" description="As the owner gives it.">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="First name" error={fieldError(state, "firstName")}>
            {(f) => <Input {...f} name="firstName" defaultValue={d.text("firstName", v.firstName)} autoComplete="off" required />}
          </FormField>
          <FormField label="Last name" error={fieldError(state, "lastName")}>
            {(f) => <Input {...f} name="lastName" defaultValue={d.text("lastName", v.lastName)} autoComplete="off" required />}
          </FormField>
        </div>
      </FormSection>

      <FormSection title="Contact" description="Riley texts and calls the mobile number.">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Mobile" hint="10 digits, or + and country code." error={fieldError(state, "mobile")}>
            {(f) => <Input {...f} name="mobile" type="tel" inputMode="tel" defaultValue={d.text("mobile", v.mobile)} required />}
          </FormField>
          <FormField label="Email" error={fieldError(state, "email")}>
            {(f) => <Input {...f} name="email" type="email" inputMode="email" defaultValue={d.text("email", v.email)} />}
          </FormField>
          <FormField label="Other phone" error={fieldError(state, "altPhone")}>
            {(f) => <Input {...f} name="altPhone" type="tel" inputMode="tel" defaultValue={d.text("altPhone", v.altPhone)} />}
          </FormField>
          <FormField label="Preferred way to reach them" error={fieldError(state, "preferredChannel")}>
            {(f) => (
              <Select {...f} name="preferredChannel" defaultValue={d.text("preferredChannel", v.preferredChannel ?? "sms")}>
                {(Object.keys(CHANNEL_LABEL) as (keyof typeof CHANNEL_LABEL)[]).map((c) => (
                  <option key={c} value={c}>
                    {CHANNEL_LABEL[c]}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
        </div>
        <FormField label="Address" error={fieldError(state, "address")}>
          {(f) => <Input {...f} name="address" defaultValue={d.text("address", v.address)} autoComplete="off" />}
        </FormField>
      </FormSection>

      <FormSection title="Permission to contact" description="Only tick what the owner agreed to. Changes are recorded.">
        <CheckboxField
          name="smsConsent"
          defaultChecked={d.on("smsConsent", v.smsConsent)}
          label="Agreed to text messages"
          hint="Appointment confirmations and reminders. Replying STOP turns this off."
        />
        <CheckboxField name="marketingConsent" defaultChecked={d.on("marketingConsent", v.marketingConsent)} label="Agreed to news and offers" />
      </FormSection>

      <FormSection title="Notes and flags" description="Visible to your team only.">
        <div className="grid gap-2 sm:grid-cols-2">
          {CLIENT_FLAGS.map((flag) => (
            <CheckboxField key={flag} name="flags" value={flag} defaultChecked={d.has("flags", flag, v.flags)} label={CLIENT_FLAG_LABEL[flag]} />
          ))}
        </div>
        <FormField label="Notes" error={fieldError(state, "notes")}>
          {(f) => <Textarea {...f} name="notes" defaultValue={d.text("notes", v.notes)} />}
        </FormField>
      </FormSection>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Link href={cancelHref} className={buttonVariants({ variant: "outline" })}>
          Cancel
        </Link>
        <SubmitButton pendingText="Saving">{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
