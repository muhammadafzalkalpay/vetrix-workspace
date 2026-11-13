"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, Search, UserPlus, X } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { findPetsAction, type PetOption } from "@/features/schedule/actions";
import type { ActionResult } from "@/lib/action-result";
import { addWaitlistAction, removeWaitlistAction } from "./actions";

export function AddToWaitlist({ services, providers }: { services: { id: string; name: string }[]; providers: { id: string; name: string }[] }) {
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<PetOption[]>([]);
  const [pet, setPet] = useState<PetOption | null>(null);
  const [serviceId, setServiceId] = useState("");
  const [providerId, setProviderId] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [searching, startSearch] = useTransition();
  const [saving, startSave] = useTransition();

  useEffect(() => {
    if (pet || q.trim().length < 2) return setOptions([]);
    const t = setTimeout(() => startSearch(async () => setOptions(await findPetsAction(q))), 250);
    return () => clearTimeout(t);
  }, [q, pet]);

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="wl-pet">Pet</Label>
        {pet ? (
          <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-small">
            <span>
              <span className="font-semibold">{pet.name}</span> <span className="text-muted-foreground">· {pet.owner}</span>
            </span>
            <button type="button" onClick={() => { setPet(null); setQ(""); }} aria-label="Choose another pet" className="text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          </div>
        ) : (
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input id="wl-pet" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pet or owner name" className="pl-9" autoComplete="off" />
            {searching && <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />}
            {options.length > 0 && (
              <ul className="absolute z-10 mt-1 grid w-full gap-0.5 rounded-md border bg-card p-1 shadow-lg">
                {options.map((o) => (
                  <li key={o.id}>
                    <button type="button" onClick={() => setPet(o)} className="w-full rounded px-2 py-1.5 text-left text-small hover:bg-muted">
                      <span className="font-medium">{o.name}</span> <span className="text-muted-foreground">({o.species}) · {o.owner}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="wl-service">Service</Label>
        <Select id="wl-service" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
          <option value="">Choose a service</option>
          {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="wl-provider">Preferred provider</Label>
        <Select id="wl-provider" value={providerId} onChange={(e) => setProviderId(e.target.value)}>
          <option value="">Anyone</option>
          {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </div>
      {result && !result.ok && <Alert variant="error">{result.error}</Alert>}
      {result?.ok && <Alert variant="success">{result.message}</Alert>}
      <div>
        <Button
          disabled={!pet || !serviceId || saving}
          onClick={() =>
            startSave(async () => {
              const r = await addWaitlistAction({ patientId: pet!.id, serviceId, providerId });
              setResult(r);
              if (r.ok) { setPet(null); setQ(""); setServiceId(""); setProviderId(""); }
            })
          }
        >
          {saving ? <Loader2 className="animate-spin" aria-hidden /> : <UserPlus aria-hidden />} Add to waitlist
        </Button>
      </div>
    </div>
  );
}

export function RemoveEntry({ entryId }: { entryId: string }) {
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => void (await removeWaitlistAction(entryId)))} aria-label="Remove from the waitlist">
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <X aria-hidden />} Remove
    </Button>
  );
}
