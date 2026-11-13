"use client";

import { useActionState, useState, useTransition } from "react";
import { CalendarPlus, Loader2, Trash2 } from "lucide-react";
import { FormField } from "@/components/patterns/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fieldError, formDefaults, FormError, FormSection, SubmitButton } from "@/features/clients/form-bits";
import type { ActionResult } from "@/lib/action-result";
import {
  addHolidayAction,
  removeHolidayAction,
  saveDetailsAction,
  saveFrontDeskAction,
  saveHoursAction,
  saveMessagingAction,
  savePoliciesAction,
  setReminderRuleAction,
  setServiceActiveAction,
} from "./actions";

type FormAction = (state: ActionResult | null, form: FormData) => Promise<ActionResult>;

/** A settings section with its own form, error and "Saved" message. */
function SectionForm({
  id,
  title,
  description,
  action,
  fields,
  children,
}: {
  id: string;
  title: string;
  description: string;
  action: FormAction;
  fields: string[];
  children: (d: ReturnType<typeof formDefaults>, state: ActionResult | null) => React.ReactNode;
}) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(action, null);
  return (
    <div id={id} className="scroll-mt-20">
      <FormSection title={title} description={description}>
        <form action={formAction} className="grid gap-4">
          {children(formDefaults(state), state)}
          <FormError state={state} fields={fields} />
          {state?.ok && <Alert variant="success">{state.message}</Alert>}
          <div>
            <SubmitButton pendingText="Saving…">Save</SubmitButton>
          </div>
        </form>
      </FormSection>
    </div>
  );
}

// ---------- Clinic details ----------

export interface DetailsValues {
  name: string;
  address: string | null;
  mainPhone: string | null;
  website: string | null;
  timezone: string;
}

export function DetailsForm({ saved, timezones }: { saved: DetailsValues; timezones: string[] }) {
  return (
    <SectionForm
      id="details"
      title="Clinic details"
      description="Riley says the clinic name on every call. The time zone sets appointment times, reminders and quiet hours."
      action={saveDetailsAction}
      fields={["name", "address", "mainPhone", "website", "timezone"]}
    >
      {(d, state) => (
        <>
          <FormField label="Clinic name" error={fieldError(state, "name")}>
            {(p) => <Input {...p} name="name" defaultValue={d.text("name", saved.name)} />}
          </FormField>
          <FormField label="Address" error={fieldError(state, "address")}>
            {(p) => <Input {...p} name="address" defaultValue={d.text("address", saved.address)} />}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Main phone" error={fieldError(state, "mainPhone")}>
              {(p) => <Input {...p} name="mainPhone" type="tel" defaultValue={d.text("mainPhone", saved.mainPhone)} />}
            </FormField>
            <FormField label="Website" error={fieldError(state, "website")}>
              {(p) => <Input {...p} name="website" type="url" placeholder="https://" defaultValue={d.text("website", saved.website)} />}
            </FormField>
          </div>
          <FormField label="Time zone" error={fieldError(state, "timezone")} hint="Changing this moves how every time is shown. Check the schedule after.">
            {(p) => (
              <Select {...p} name="timezone" defaultValue={String(d.text("timezone", saved.timezone))}>
                {timezones.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace(/_/g, " ")}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
        </>
      )}
    </SectionForm>
  );
}

// ---------- Opening hours ----------

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// Monday first, as clinics read their week.
const ORDER = [1, 2, 3, 4, 5, 6, 0];

export function HoursForm({ saved }: { saved: ({ opens: string; closes: string } | null)[] }) {
  return (
    <SectionForm
      id="hours"
      title="Opening hours"
      description="Riley offers times only inside these hours. Outside them, emergencies follow the after-hours setting."
      action={saveHoursAction}
      fields={[]}
    >
      {(d) => (
        <div className="grid gap-2">
          {ORDER.map((day) => (
            <HoursRow key={day} day={day} saved={saved[day] ?? null} d={d} />
          ))}
        </div>
      )}
    </SectionForm>
  );
}

function HoursRow({ day, saved, d }: { day: number; saved: { opens: string; closes: string } | null; d: ReturnType<typeof formDefaults> }) {
  const [closed, setClosed] = useState(d.submitted ? d.on(`closed_${day}`, false) : saved === null);
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-3 rounded-md border p-2 sm:grid-cols-[7rem_minmax(0,1fr)_auto]">
      <span className="text-small font-medium">{DAYS[day]}</span>
      <div className="flex items-center gap-2">
        <Input
          type="time"
          name={`opens_${day}`}
          aria-label={`${DAYS[day]} opens`}
          disabled={closed}
          defaultValue={String(d.text(`opens_${day}`, saved?.opens ?? "08:00"))}
          className="h-9"
        />
        <span className="text-small text-muted-foreground">to</span>
        <Input
          type="time"
          name={`closes_${day}`}
          aria-label={`${DAYS[day]} closes`}
          disabled={closed}
          defaultValue={String(d.text(`closes_${day}`, saved?.closes ?? "18:00"))}
          className="h-9"
        />
      </div>
      <label className="col-span-2 flex cursor-pointer items-center gap-2 text-small sm:col-span-1">
        <input type="checkbox" name={`closed_${day}`} checked={closed} onChange={(e) => setClosed(e.currentTarget.checked)} className="size-4 accent-[var(--primary)]" />
        Closed
      </label>
    </div>
  );
}

// ---------- Closed days ----------

export function HolidaysPanel({ holidays }: { holidays: { id: string; date: string; name: string | null }[] }) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(addHolidayAction, null);
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = holidays.filter((h) => h.date >= today);
  const past = holidays.length - upcoming.length;
  return (
    <div id="closed-days" className="scroll-mt-20">
      <FormSection title="Closed days" description="Holidays and other days the clinic is shut. Riley won't offer times on them.">
        {upcoming.length === 0 ? (
          <p className="text-small text-muted-foreground">No closed days coming up.</p>
        ) : (
          <ul className="grid gap-2">
            {upcoming.map((h) => (
              <HolidayRow key={h.id} holiday={h} />
            ))}
          </ul>
        )}
        {past > 0 && <p className="text-caption text-muted-foreground">{past} past closed {past === 1 ? "day is" : "days are"} kept for the record.</p>}
        <form action={formAction} className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-end" key={state?.ok ? state.message : "add"}>
          <FormField label="Date" error={fieldError(state, "date")}>
            {(p) => <Input {...p} name="date" type="date" min={today} />}
          </FormField>
          <FormField label="Name (optional)" error={fieldError(state, "name")}>
            {(p) => <Input {...p} name="name" placeholder="Thanksgiving" />}
          </FormField>
          <SubmitButton pendingText="Adding…">
            <CalendarPlus aria-hidden /> Add
          </SubmitButton>
        </form>
        <FormError state={state} fields={["date", "name"]} />
      </FormSection>
    </div>
  );
}

function HolidayRow({ holiday }: { holiday: { id: string; date: string; name: string | null } }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const label = new Date(`${holiday.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return (
    <li className="flex items-center gap-3 rounded-md border px-3 py-2">
      <span className="min-w-0 flex-1 text-small">
        <span className="font-medium">{label}</span>
        {holiday.name && <span className="text-muted-foreground"> · {holiday.name}</span>}
        {error && <span className="block text-caption text-destructive">{error}</span>}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending}
        aria-label={`Remove ${label}`}
        onClick={() =>
          start(async () => {
            const r = await removeHolidayAction(holiday.id);
            setError(r.ok ? null : r.error);
          })
        }
      >
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
      </Button>
    </li>
  );
}

// ---------- Front desk ----------

export interface FrontDeskValues {
  aiName: string;
  emergencyTransferNumber: string | null;
  afterHoursBehaviour: "er_only" | "er_and_book_next";
  erName: string | null;
  erPhone: string | null;
  erAddress: string | null;
}

export function FrontDeskForm({ saved }: { saved: FrontDeskValues }) {
  const fields = ["aiName", "emergencyTransferNumber", "afterHoursBehaviour", "erName", "erPhone", "erAddress"];
  return (
    <SectionForm
      id="front-desk"
      title="AI front desk"
      description="How Riley introduces itself and where emergencies go."
      action={saveFrontDeskAction}
      fields={fields}
    >
      {(d, state) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Assistant's name" error={fieldError(state, "aiName")} hint="Said in the greeting and texts.">
              {(p) => <Input {...p} name="aiName" defaultValue={d.text("aiName", saved.aiName)} />}
            </FormField>
            <FormField
              label="Emergency transfer number"
              error={fieldError(state, "emergencyTransferNumber")}
              hint="During open hours, emergency calls go straight to this number."
            >
              {(p) => <Input {...p} name="emergencyTransferNumber" type="tel" defaultValue={d.text("emergencyTransferNumber", saved.emergencyTransferNumber)} />}
            </FormField>
          </div>
          <FormField label="After hours" error={fieldError(state, "afterHoursBehaviour")}>
            {(p) => (
              <Select {...p} name="afterHoursBehaviour" defaultValue={String(d.text("afterHoursBehaviour", saved.afterHoursBehaviour))}>
                <option value="er_and_book_next">Give the emergency hospital, then offer the next open time</option>
                <option value="er_only">Give the emergency hospital only</option>
              </Select>
            )}
          </FormField>
          <fieldset className="grid gap-4 rounded-md border p-4">
            <legend className="px-1 text-small font-semibold">Emergency hospital (after hours)</legend>
            <FormField label="Name" error={fieldError(state, "erName")}>
              {(p) => <Input {...p} name="erName" defaultValue={d.text("erName", saved.erName)} />}
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Phone" error={fieldError(state, "erPhone")}>
                {(p) => <Input {...p} name="erPhone" type="tel" defaultValue={d.text("erPhone", saved.erPhone)} />}
              </FormField>
              <FormField label="Address" error={fieldError(state, "erAddress")}>
                {(p) => <Input {...p} name="erAddress" defaultValue={d.text("erAddress", saved.erAddress)} />}
              </FormField>
            </div>
          </fieldset>
        </>
      )}
    </SectionForm>
  );
}

// ---------- Policies ----------

export interface PolicyValues {
  cancellationWindowHours: number;
  cancellationFee: number | null;
  surgeryDeposit: number | null;
  refillTurnaround: string | null;
  newClientPolicy: string | null;
  recordsReleasePolicy: string | null;
  recordingRetentionMonths: number;
  telehealthEnabled: boolean;
}

export function PoliciesForm({ saved }: { saved: PolicyValues }) {
  const fields = ["cancellationWindowHours", "cancellationFee", "surgeryDeposit", "refillTurnaround", "newClientPolicy", "recordsReleasePolicy", "recordingRetentionMonths"];
  return (
    <SectionForm id="policies" title="Policies" description="What Riley tells clients about cancelling, fees and refills." action={savePoliciesAction} fields={fields}>
      {(d, state) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Cancellation notice (hours)" error={fieldError(state, "cancellationWindowHours")}>
              {(p) => <Input {...p} name="cancellationWindowHours" type="number" min={0} max={168} defaultValue={d.text("cancellationWindowHours", saved.cancellationWindowHours)} />}
            </FormField>
            <FormField label="Late cancellation fee ($)" error={fieldError(state, "cancellationFee")} hint="Leave empty for no fee.">
              {(p) => <Input {...p} name="cancellationFee" inputMode="decimal" defaultValue={d.text("cancellationFee", saved.cancellationFee?.toFixed(2))} />}
            </FormField>
            <FormField label="Surgery deposit ($)" error={fieldError(state, "surgeryDeposit")}>
              {(p) => <Input {...p} name="surgeryDeposit" inputMode="decimal" defaultValue={d.text("surgeryDeposit", saved.surgeryDeposit?.toFixed(2))} />}
            </FormField>
            <FormField label="Refill turnaround" error={fieldError(state, "refillTurnaround")} hint='For example "24 hours".'>
              {(p) => <Input {...p} name="refillTurnaround" defaultValue={d.text("refillTurnaround", saved.refillTurnaround)} />}
            </FormField>
          </div>
          <FormField label="New clients" error={fieldError(state, "newClientPolicy")}>
            {(p) => <Textarea {...p} name="newClientPolicy" rows={2} defaultValue={d.text("newClientPolicy", saved.newClientPolicy)} />}
          </FormField>
          <FormField label="Medical records" error={fieldError(state, "recordsReleasePolicy")}>
            {(p) => <Textarea {...p} name="recordsReleasePolicy" rows={2} defaultValue={d.text("recordsReleasePolicy", saved.recordsReleasePolicy)} />}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2 sm:items-end">
            <FormField label="Keep call recordings (months)" error={fieldError(state, "recordingRetentionMonths")}>
              {(p) => <Input {...p} name="recordingRetentionMonths" type="number" min={1} max={120} defaultValue={d.text("recordingRetentionMonths", saved.recordingRetentionMonths)} />}
            </FormField>
            <CheckboxField name="telehealthEnabled" label="Offers telehealth visits" defaultChecked={d.on("telehealthEnabled", saved.telehealthEnabled)} />
          </div>
        </>
      )}
    </SectionForm>
  );
}

// ---------- Messaging ----------

export function MessagingForm({ saved, timezone }: { saved: { quietStart: string; quietEnd: string }; timezone: string }) {
  return (
    <SectionForm
      id="messaging"
      title="Quiet hours"
      description={`No reminder or staff texts go out between these times (${timezone.replace(/_/g, " ")}). Replies to a client who just texted still go out.`}
      action={saveMessagingAction}
      fields={["quietStart", "quietEnd"]}
    >
      {(d, state) => (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="From" error={fieldError(state, "quietStart")}>
            {(p) => <Input {...p} name="quietStart" type="time" defaultValue={d.text("quietStart", saved.quietStart)} />}
          </FormField>
          <FormField label="Until" error={fieldError(state, "quietEnd")}>
            {(p) => <Input {...p} name="quietEnd" type="time" defaultValue={d.text("quietEnd", saved.quietEnd)} />}
          </FormField>
        </div>
      )}
    </SectionForm>
  );
}

// ---------- Toggles (reminders, services) ----------

export function ToggleRow({
  kind,
  id,
  label,
  detail,
  on,
  disabled,
}: {
  kind: "reminder" | "service";
  id: string;
  label: string;
  detail?: string;
  on: boolean;
  disabled?: boolean;
}) {
  const [checked, setChecked] = useState(on);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <li className="flex items-center gap-3 rounded-md border px-3 py-2">
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-small font-medium">{label}</span>
        {detail && <span className="text-caption text-muted-foreground">{detail}</span>}
        {error && <span className="text-caption text-destructive">{error}</span>}
      </span>
      {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />}
      <input
        type="checkbox"
        role="switch"
        aria-label={`${label}: ${checked ? "on" : "off"}`}
        checked={checked}
        disabled={disabled || pending}
        className="size-5 cursor-pointer accent-[var(--primary)] disabled:cursor-not-allowed"
        onChange={(e) => {
          const next = e.currentTarget.checked;
          setChecked(next);
          start(async () => {
            const r = kind === "reminder" ? await setReminderRuleAction(id, next) : await setServiceActiveAction(id, next);
            if (!r.ok) {
              setChecked(!next);
              setError(r.error);
            } else setError(null);
          });
        }}
      />
    </li>
  );
}
