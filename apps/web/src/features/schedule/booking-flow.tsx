"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { AlertCircle, AlertTriangle, CalendarDays, Loader2, Search, Sparkles, X } from "lucide-react";
import { FormField } from "@/components/patterns/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "@/features/clients/form-bits";
import { PetAvatar } from "@/features/clients/species-icon";
import { cn } from "@/lib/utils";
import { bookAction, findPetsAction, nextOpenDaysAction, slotsAction, type PetOption, type SlotsResult } from "./actions";
import { formatDayShort } from "./format";
import type { Species } from "@vetrix/domain";

export interface ServiceOption {
  id: string;
  name: string;
  category: string;
  durationMin: number;
  species: string[];
}

export interface ProviderOption {
  id: string;
  name: string;
}

const CATEGORY: Record<string, string> = { exam: "Exams", tech: "Technician", surgery: "Surgery and dental", diagnostics: "Diagnostics", other: "Other" };

function Step({ n, title, children, done }: { n: number; title: string; children: React.ReactNode; done?: boolean }) {
  return (
    <section className="grid gap-3 rounded-xl border bg-card p-5 shadow-card">
      <h3 className="flex items-center gap-2.5 font-semibold">
        <span
          className={cn(
            "flex size-7 items-center justify-center rounded-full text-small",
            done ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground",
          )}
        >
          {n}
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function PetPicker({ value, onChange, locked }: { value: PetOption | null; onChange: (p: PetOption | null) => void; locked: boolean }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PetOption[]>([]);
  const [pending, start] = useTransition();
  useEffect(() => {
    if (value || q.trim().length < 2) return setResults([]);
    const t = setTimeout(() => start(async () => setResults(await findPetsAction(q))), 250);
    return () => clearTimeout(t);
  }, [q, value]);

  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-lg border bg-secondary/40 p-3">
        <PetAvatar species={value.species as Species} />
        <span className="grid flex-1">
          <span className="font-semibold">{value.name}</span>
          <span className="text-small text-muted-foreground">
            {[value.breed, value.owner].filter(Boolean).join(" · ")}
          </span>
        </span>
        {!locked && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            Change
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="relative grid gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input autoFocus aria-label="Find a pet" placeholder="Pet or owner name, or microchip" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        {pending && <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />}
      </div>
      {results.length > 0 && (
        <ul role="listbox" aria-label="Matching pets" className="grid gap-1 rounded-lg border bg-card p-1 shadow-lg">
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => onChange(p)}
                className="flex w-full cursor-pointer items-center gap-3 rounded-md p-2 text-left hover:bg-muted"
              >
                <PetAvatar species={p.species as Species} className="size-8" />
                <span className="grid">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-caption text-muted-foreground">{[p.breed, p.owner].filter(Boolean).join(" · ")}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.trim().length >= 2 && !pending && results.length === 0 && <p className="text-small text-muted-foreground">No active pets match.</p>}
    </div>
  );
}

function part(timezone: string, start: number): "Morning" | "Afternoon" | "Evening" {
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: timezone }).format(start));
  return h < 12 ? "Morning" : h < 17 ? "Afternoon" : "Evening";
}

export function BookingFlow({
  services,
  providers,
  today,
  timezone,
  initialPet,
  reschedule,
}: {
  services: ServiceOption[];
  providers: ProviderOption[];
  today: string;
  timezone: string;
  initialPet?: PetOption | null;
  reschedule?: { id: string; serviceId: string; providerId: string | null; when: string } | null;
}) {
  const [pet, setPet] = useState<PetOption | null>(initialPet ?? null);
  const [serviceId, setServiceId] = useState(reschedule?.serviceId ?? "");
  const [providerId, setProviderId] = useState(reschedule?.providerId ?? "");
  const [date, setDate] = useState<string>("");
  const [days, setDays] = useState<string[]>([]);
  const [slots, setSlots] = useState<SlotsResult | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [loadingDays, startDays] = useTransition();
  const [loadingSlots, startSlots] = useTransition();
  const [state, formAction] = useActionState(bookAction, null);

  const forSpecies = useMemo(() => services.filter((s) => !pet || s.species.includes(pet.species)), [services, pet]);
  const grouped = useMemo(() => {
    const out = new Map<string, ServiceOption[]>();
    for (const s of forSpecies) out.set(s.category, [...(out.get(s.category) ?? []), s]);
    return out;
  }, [forSpecies]);
  const time = (n: number) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(n);

  // When pet or service changes, find the next days with free times.
  useEffect(() => {
    setDays([]);
    setDate("");
    setSlots(null);
    setChosen(null);
    if (!pet || !serviceId) return;
    startDays(async () => {
      const next = await nextOpenDaysAction({ patientId: pet.id, serviceId, from: today });
      setDays(next);
      if (next[0]) setDate(next[0]);
    });
  }, [pet, serviceId, today]);

  // When the day or provider changes, load that day's free times.
  useEffect(() => {
    setChosen(null);
    if (!pet || !serviceId || !date) return setSlots(null);
    startSlots(async () =>
      setSlots(await slotsAction({ patientId: pet.id, serviceId, date, providerId: providerId || undefined, rescheduleId: reschedule?.id })),
    );
  }, [pet, serviceId, date, providerId, reschedule?.id]);

  const selected = slots?.ok ? slots.slots.find((s) => s.start === chosen) : undefined;
  const service = services.find((s) => s.id === serviceId);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="grid content-start gap-5">
        <Step n={1} title="Pet" done={Boolean(pet)}>
          <PetPicker value={pet} onChange={(p) => { setPet(p); if (!reschedule) setServiceId(""); }} locked={Boolean(reschedule)} />
        </Step>

        <Step n={2} title="Service and doctor" done={Boolean(serviceId)}>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Service">
              {(f) => (
                <Select {...f} value={serviceId} onChange={(e) => setServiceId(e.target.value)} disabled={!pet || Boolean(reschedule)}>
                  <option value="">{pet ? "Choose…" : "Choose a pet first"}</option>
                  {[...grouped].map(([cat, list]) => (
                    <optgroup key={cat} label={CATEGORY[cat] ?? cat}>
                      {list.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.durationMin} min)
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField label="Doctor or team member">
              {(f) => (
                <Select {...f} value={providerId} onChange={(e) => setProviderId(e.target.value)} disabled={!serviceId}>
                  <option value="">Anyone available</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          </div>
        </Step>

        <Step n={3} title="Day and time" done={chosen !== null}>
          {!serviceId ? (
            <p className="text-small text-muted-foreground">Choose a pet and a service to see free times.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-2">
                {loadingDays && <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Finding free days" />}
                {days.map((d) => {
                  const f = formatDayShort(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDate(d)}
                      aria-pressed={date === d}
                      className={cn(
                        "grid w-16 cursor-pointer justify-items-center rounded-lg border px-2 py-2 transition-colors",
                        date === d ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
                      )}
                    >
                      <span className="text-caption">{f.weekday}</span>
                      <span className="text-h3 font-semibold leading-tight">{f.day}</span>
                      <span className="text-caption opacity-80">{f.month}</span>
                    </button>
                  );
                })}
                <label className="grid gap-1 text-caption text-muted-foreground">
                  Other day
                  <Input type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} className="h-10 w-40" />
                </label>
              </div>
              {!loadingDays && days.length === 0 && !date && (
                <p className="text-small text-muted-foreground">No free times in the next three weeks. Try another doctor or pick a later day.</p>
              )}

              {loadingSlots && <p className="flex items-center gap-2 text-small text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden /> Finding free times…</p>}
              {slots && !slots.ok && (
                <Alert variant="error">
                  <AlertCircle aria-hidden />
                  <p>{slots.error}</p>
                </Alert>
              )}
              {slots?.ok && slots.blocked && (
                <Alert variant="error">
                  <AlertCircle aria-hidden />
                  <p>{slots.blocked}</p>
                </Alert>
              )}
              {slots?.ok && slots.warnings.length > 0 && (
                <Alert variant="warning">
                  <AlertTriangle aria-hidden />
                  <ul className="grid gap-0.5">
                    {slots.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </Alert>
              )}
              {slots?.ok && !slots.blocked && !loadingSlots && slots.slots.length === 0 && date && (
                <p className="text-small text-muted-foreground">No free times on this day.</p>
              )}
              {slots?.ok && slots.slots.length > 0 && !loadingSlots && (
                <div className="grid gap-4" role="radiogroup" aria-label="Free times">
                  {(["Morning", "Afternoon", "Evening"] as const).map((p) => {
                    const list = slots.slots.filter((s) => part(timezone, s.start) === p);
                    if (list.length === 0) return null;
                    return (
                      <div key={p} className="grid gap-2">
                        <p className="text-caption font-semibold uppercase tracking-wider text-muted-foreground">{p}</p>
                        <div className="flex flex-wrap gap-2">
                          {list.map((s) => {
                            const suggested = slots.suggested.includes(s.start);
                            return (
                              <button
                                key={`${s.start}-${s.providerId}`}
                                type="button"
                                role="radio"
                                aria-checked={chosen === s.start}
                                onClick={() => setChosen(s.start)}
                                title={`${s.providerName}${s.roomName ? ` · ${s.roomName}` : ""}`}
                                aria-label={`${time(s.start)} with ${s.providerName}${s.roomName ? `, ${s.roomName}` : ""}${suggested ? ", suggested" : ""}`}
                                className={cn(
                                  "relative min-w-20 cursor-pointer rounded-md border px-3 py-2 text-small font-medium tabular-nums transition-colors",
                                  chosen === s.start ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary/50 hover:bg-secondary/50",
                                  suggested && chosen !== s.start && "border-primary/60",
                                )}
                              >
                                {time(s.start)}
                                {suggested && <Sparkles className="absolute -right-1.5 -top-1.5 size-3.5 text-primary" aria-hidden />}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </Step>
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <form action={formAction} className="grid gap-4 rounded-xl border bg-card p-5 shadow-card">
          <h3 className="font-semibold">{reschedule ? "Move visit" : "Summary"}</h3>
          {reschedule && <p className="text-small text-muted-foreground">Currently {reschedule.when}.</p>}
          <dl className="grid gap-2 text-small">
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Pet</dt><dd className="font-medium">{pet?.name ?? "—"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Service</dt><dd className="text-right font-medium">{service?.name ?? "—"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">When</dt><dd className="text-right font-medium">{selected ? `${formatDayShort(date).weekday} ${formatDayShort(date).day} ${formatDayShort(date).month}, ${time(selected.start)}` : "—"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">With</dt><dd className="text-right font-medium">{selected?.providerName ?? "—"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Room</dt><dd className="text-right font-medium">{selected?.roomName ?? "—"}</dd></div>
          </dl>
          <input type="hidden" name="patientId" value={pet?.id ?? ""} />
          <input type="hidden" name="serviceId" value={serviceId} />
          <input type="hidden" name="start" value={chosen ?? ""} />
          <input type="hidden" name="providerId" value={selected?.providerId ?? ""} />
          {reschedule && <input type="hidden" name="rescheduleId" value={reschedule.id} />}
          {!reschedule && (
            <>
              <FormField label="Reason for visit">
                {(f) => <Input {...f} name="reason" placeholder="e.g. limping since yesterday" />}
              </FormField>
              <FormField label="Notes for the team">
                {(f) => <Textarea {...f} name="notes" className="min-h-16" />}
              </FormField>
            </>
          )}
          {state && !state.ok && (
            <Alert variant="error">
              <AlertCircle aria-hidden />
              <p>{state.error}</p>
            </Alert>
          )}
          {chosen === null ? (
            <Button type="button" disabled>
              <CalendarDays aria-hidden /> Choose a time
            </Button>
          ) : (
            <SubmitButton pendingText={reschedule ? "Moving" : "Booking"}>{reschedule ? "Move visit" : "Book visit"}</SubmitButton>
          )}
          {chosen !== null && (
            <button type="button" onClick={() => setChosen(null)} className="flex cursor-pointer items-center justify-center gap-1 text-small text-muted-foreground hover:text-foreground">
              <X className="size-3.5" aria-hidden /> Clear time
            </button>
          )}
        </form>
      </aside>
    </div>
  );
}
