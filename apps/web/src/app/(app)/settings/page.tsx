import type { Metadata } from "next";
import { formatPhone } from "@vetrix/domain";
import { loadSettings } from "@vetrix/db/runtime";
import { PageHeader } from "@/components/patterns/page-header";
import { FormSection } from "@/features/clients/form-bits";
import { requirePage } from "@/features/clients/access";
import { DetailsForm, FrontDeskForm, HolidaysPanel, HoursForm, MessagingForm, PoliciesForm, ToggleRow } from "@/features/settings/settings-forms";

export const metadata: Metadata = { title: "Settings · Vetrix" };

const SECTIONS = [
  ["details", "Clinic"],
  ["hours", "Hours"],
  ["closed-days", "Closed days"],
  ["front-desk", "AI front desk"],
  ["policies", "Policies"],
  ["messaging", "Quiet hours"],
  ["reminders", "Reminders"],
  ["services", "Services"],
] as const;

const CATEGORY: Record<string, string> = { exam: "Exams", tech: "Technician visits", surgery: "Surgery and dental", diagnostics: "Diagnostics", other: "Other" };

/** Shows saved numbers as (555) 010-1000; older values may not be in +1 form. */
function showPhone(v: string | null): string | null {
  if (!v) return null;
  const digits = v.replace(/\D/g, "");
  const e164 = v.startsWith("+") ? v : digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith("1") ? `+${digits}` : null;
  try {
    return e164 ? formatPhone(e164) : v;
  } catch {
    return v;
  }
}

function usTimeZones(current: string): string[] {
  const all = Intl.supportedValuesOf("timeZone").filter((tz) => tz.startsWith("America/") || tz === "Pacific/Honolulu");
  const common = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"];
  return [...new Set([current, ...common, ...all])];
}

export default async function SettingsPage() {
  const shell = await requirePage("settings.manage");
  const s = await loadSettings(shell.clinic, shell.location.id);
  const categories = [...new Set(s.services.map((x) => x.category))];

  return (
    <>
      <PageHeader title="Settings" description={`How ${s.details.name} runs: hours, how Riley answers, policies and reminders.`} />
      <nav aria-label="Settings sections" className="-mx-1 mb-6 flex gap-1 overflow-x-auto pb-1">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="shrink-0 rounded-full border bg-card px-3 py-1.5 text-small font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
            {label}
          </a>
        ))}
      </nav>
      <div className="grid gap-6">
        <DetailsForm saved={{ ...s.details, mainPhone: showPhone(s.details.mainPhone) }} timezones={usTimeZones(s.details.timezone)} />
        <HoursForm saved={s.hours} />
        <HolidaysPanel holidays={s.holidays} />
        <FrontDeskForm
          saved={{ ...s.frontDesk, emergencyTransferNumber: showPhone(s.frontDesk.emergencyTransferNumber), erPhone: showPhone(s.frontDesk.erPhone) }}
        />
        <PoliciesForm saved={s.policies} />
        <MessagingForm saved={s.messaging} timezone={s.details.timezone} />

        <div id="reminders" className="scroll-mt-20">
          <FormSection title="Reminders" description="Which reminders go out. Turning one off stops new texts for it; reminders already sent stay in the log.">
            <ul className="grid gap-2">
              {s.reminderRules.map((r) => (
                <ToggleRow
                  key={r.id}
                  kind="reminder"
                  id={r.id}
                  label={r.name}
                  detail={r.running ? undefined : "Not sent yet: coming in a later update."}
                  on={r.enabled}
                  disabled={!r.running}
                />
              ))}
            </ul>
          </FormSection>
        </div>

        <div id="services" className="scroll-mt-20">
          <FormSection title="Services" description="Turn off a service the clinic doesn't offer. Riley and staff can't book it; visits already booked stay.">
            <div className="grid gap-4">
              {categories.map((c) => (
                <div key={c} className="grid gap-2">
                  <h4 className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">{CATEGORY[c] ?? c.replace(/_/g, " ")}</h4>
                  <ul className="grid gap-2">
                    {s.services
                      .filter((x) => x.category === c)
                      .map((x) => (
                        <ToggleRow key={x.id} kind="service" id={x.id} label={x.name} detail={x.durationMin ? `${x.durationMin} min` : undefined} on={x.active} />
                      ))}
                  </ul>
                </div>
              ))}
            </div>
          </FormSection>
        </div>
      </div>
    </>
  );
}
