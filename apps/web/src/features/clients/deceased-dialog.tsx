"use client";

// Marking a pet deceased is sensitive and stops all its reminders, so it asks
// the person to confirm the death and retype the pet's name and species
// (pack v0.2). The server checks the same things again.
import { useActionState, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertCircle, HeartCrack, X } from "lucide-react";
import { SPECIES } from "@vetrix/domain";
import { FormField } from "@/components/patterns/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { ActionResult } from "@/lib/action-result";
import { fieldError, SubmitButton } from "./form-bits";
import { SPECIES_LABEL } from "./labels";

export function DeceasedDialog({
  petName,
  action,
  today,
}: {
  petName: string;
  action: (state: ActionResult | null, form: FormData) => Promise<ActionResult>;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(action, null);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="outline" size="sm">
          <HeartCrack aria-hidden /> Mark as deceased
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-navy-900/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 grid max-h-[90dvh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-5 overflow-y-auto rounded-xl bg-card p-6 shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <div className="grid gap-1">
              <Dialog.Title className="text-h3 font-semibold">Mark {petName} as deceased</Dialog.Title>
              <Dialog.Description className="text-small text-muted-foreground">
                This stops every reminder and scheduled message about {petName}. Please confirm the details with the family first.
              </Dialog.Description>
            </div>
            <Dialog.Close className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-muted" aria-label="Close">
              <X className="size-4" aria-hidden />
            </Dialog.Close>
          </div>

            <form action={formAction} className="grid gap-4">
              {state && !state.ok && !["confirmedName", "confirmedSpecies", "deceasedDate"].includes(state.field ?? "") && (
                <Alert variant="error">
                  <AlertCircle aria-hidden />
                  <p>{state.error}</p>
                </Alert>
              )}
              <CheckboxField name="deathConfirmed" label={`The family has confirmed ${petName} has died`} required />
              <FormField label="Type the pet's name to confirm" error={fieldError(state, "confirmedName")}>
                {(f) => <Input {...f} name="confirmedName" autoComplete="off" required />}
              </FormField>
              <div className="grid grid-cols-2 gap-4">
                <FormField label="Species" error={fieldError(state, "confirmedSpecies")}>
                  {(f) => (
                    <Select {...f} name="confirmedSpecies" defaultValue="" required>
                      <option value="" disabled>
                        Choose…
                      </option>
                      {SPECIES.map((s) => (
                        <option key={s} value={s}>
                          {SPECIES_LABEL[s]}
                        </option>
                      ))}
                    </Select>
                  )}
                </FormField>
                <FormField label="Date of death" error={fieldError(state, "deceasedDate")}>
                  {(f) => <Input {...f} name="deceasedDate" type="date" max={today} defaultValue={today} required />}
                </FormField>
              </div>
              <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
                <Dialog.Close asChild>
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </Dialog.Close>
                <SubmitButton pendingText="Saving">Mark as deceased</SubmitButton>
              </div>
            </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
