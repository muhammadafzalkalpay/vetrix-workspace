"use client";

import { useActionState, useState } from "react";
import { AlertCircle, CalendarX } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { Select } from "@/components/ui/select";
import type { ActionResult } from "@/lib/action-result";
import { SubmitButton } from "@/features/clients/form-bits";

const REASONS = ["Owner asked to cancel", "Pet is better", "Booked elsewhere", "Clinic needs to cancel", "Booked by mistake", "Other"];

export function CancelForm({ action }: { action: (state: ActionResult | null, f: FormData) => Promise<ActionResult> }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(action, null);
  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <CalendarX aria-hidden /> Cancel visit
      </Button>
    );
  }
  return (
    <form action={formAction} className="grid gap-3 rounded-lg border bg-muted/40 p-3">
      {state && !state.ok && (
        <Alert variant="error">
          <AlertCircle aria-hidden />
          <p>{state.error}</p>
        </Alert>
      )}
      <label className="grid gap-1.5 text-small font-medium">
        Reason
        <Select name="reason" defaultValue="" required>
          <option value="" disabled>
            Choose…
          </option>
          {REASONS.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </Select>
      </label>
      <CheckboxField name="late" label="Late cancellation" hint="Less notice than the clinic's policy." />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Keep visit
        </Button>
        <SubmitButton pendingText="Cancelling">Cancel visit</SubmitButton>
      </div>
    </form>
  );
}
