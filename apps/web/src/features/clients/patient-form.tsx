"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { SPECIES, TEMPERAMENT_FLAGS, type Species, type TemperamentFlag } from "@vetrix/domain";
import { FormField } from "@/components/patterns/form-field";
import { buttonVariants } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";
import { fieldError, formDefaults, FormError, FormSection, SubmitButton } from "./form-bits";
import { SPECIES_LABEL, TEMPERAMENT_LABEL } from "./labels";

export interface PatientFormValues {
  name: string;
  species: Species;
  breed: string;
  sex: "male" | "female" | "";
  neutered: "yes" | "no" | "";
  dateOfBirth: string;
  approxAgeMonths: number | null;
  weightKg: string;
  colorMarkings: string;
  microchipNumber: string;
  medicalAlerts: string;
  temperamentFlags: TemperamentFlag[];
}

const FIELDS = [
  "name", "species", "breed", "sex", "neutered", "dateOfBirth", "approxAgeMonths", "weightKg",
  "colorMarkings", "microchipNumber", "medicalAlerts",
];

export function PatientForm({
  action,
  initial,
  cancelHref,
  submitLabel,
  today,
}: {
  action: (state: ActionResult | null, form: FormData) => Promise<ActionResult>;
  initial?: Partial<PatientFormValues>;
  cancelHref: string;
  submitLabel: string;
  today: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const v = initial ?? {};
  const d = formDefaults(state);
  const [ageMode, setAgeMode] = useState<"dob" | "approx">(v.approxAgeMonths != null && !v.dateOfBirth ? "approx" : "dob");
  const ageError = fieldError(state, "dateOfBirth") ?? fieldError(state, "approxAgeMonths");

  return (
    <form key={JSON.stringify(state)} action={formAction} noValidate className="grid gap-5">
      <FormError state={state} fields={FIELDS} />

      <FormSection title="Pet" description="Name and species are required.">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Name" error={fieldError(state, "name")}>
            {(f) => <Input {...f} name="name" defaultValue={d.text("name", v.name)} autoComplete="off" required />}
          </FormField>
          <FormField label="Species" error={fieldError(state, "species")}>
            {(f) => (
              <Select {...f} name="species" defaultValue={d.text("species", v.species)} required>
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
          <FormField label="Breed" error={fieldError(state, "breed")}>
            {(f) => <Input {...f} name="breed" defaultValue={d.text("breed", v.breed)} autoComplete="off" />}
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Sex">
              {(f) => (
                <Select {...f} name="sex" defaultValue={d.text("sex", v.sex)}>
                  <option value="">Unknown</option>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                </Select>
              )}
            </FormField>
            <FormField label="Spayed or neutered">
              {(f) => (
                <Select {...f} name="neutered" defaultValue={d.text("neutered", v.neutered)}>
                  <option value="">Unknown</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </Select>
              )}
            </FormField>
          </div>
        </div>
      </FormSection>

      <FormSection title="Age and size" description="A date of birth gives the most accurate reminders.">
        <input type="hidden" name="ageMode" value={ageMode} />
        <div role="radiogroup" aria-label="How to give the age" className="inline-flex w-fit rounded-md border bg-muted p-1">
          {(["dob", "approx"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={ageMode === mode}
              onClick={() => setAgeMode(mode)}
              className={cn(
                "cursor-pointer rounded-sm px-3 py-1.5 text-small font-medium",
                ageMode === mode ? "bg-card text-foreground shadow-card" : "text-muted-foreground",
              )}
            >
              {mode === "dob" ? "Date of birth" : "Approximate age"}
            </button>
          ))}
        </div>
        {ageMode === "dob" ? (
          <FormField label="Date of birth" error={ageError}>
            {(f) => <Input {...f} name="dateOfBirth" type="date" max={today} defaultValue={d.text("dateOfBirth", v.dateOfBirth)} className="sm:max-w-56" />}
          </FormField>
        ) : (
          <div className="grid max-w-sm grid-cols-2 gap-4">
            <FormField label="Years" error={ageError}>
              {(f) => (
                <Input {...f} name="approxYears" type="number" min={0} max={40} inputMode="numeric"
                  defaultValue={d.text("approxYears", v.approxAgeMonths != null ? Math.floor(v.approxAgeMonths / 12) : null)} />
              )}
            </FormField>
            <FormField label="Months">
              {(f) => (
                <Input {...f} name="approxMonths" type="number" min={0} max={11} inputMode="numeric"
                  defaultValue={d.text("approxMonths", v.approxAgeMonths != null ? v.approxAgeMonths % 12 : null)} />
              )}
            </FormField>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Weight (kg)" error={fieldError(state, "weightKg")}>
            {(f) => <Input {...f} name="weightKg" type="number" step="0.1" min={0} inputMode="decimal" defaultValue={d.text("weightKg", v.weightKg)} />}
          </FormField>
          <FormField label="Colour and markings" error={fieldError(state, "colorMarkings")}>
            {(f) => <Input {...f} name="colorMarkings" defaultValue={d.text("colorMarkings", v.colorMarkings)} />}
          </FormField>
          <FormField label="Microchip number" error={fieldError(state, "microchipNumber")}>
            {(f) => <Input {...f} name="microchipNumber" inputMode="numeric" defaultValue={d.text("microchipNumber", v.microchipNumber)} />}
          </FormField>
        </div>
      </FormSection>

      <FormSection title="Care notes" description="Shown to staff when booking and at check-in.">
        <FormField label="Medical alerts" hint="Allergies, conditions, medicines to avoid." error={fieldError(state, "medicalAlerts")}>
          {(f) => <Textarea {...f} name="medicalAlerts" defaultValue={d.text("medicalAlerts", v.medicalAlerts)} />}
        </FormField>
        <div className="grid gap-2 sm:grid-cols-2">
          {TEMPERAMENT_FLAGS.map((flag) => (
            <CheckboxField
              key={flag}
              name="temperamentFlags"
              value={flag}
              defaultChecked={d.has("temperamentFlags", flag, v.temperamentFlags)}
              label={TEMPERAMENT_LABEL[flag]}
            />
          ))}
        </div>
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
