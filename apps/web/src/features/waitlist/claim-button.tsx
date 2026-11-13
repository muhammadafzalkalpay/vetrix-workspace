"use client";

import { useState, useTransition } from "react";
import { CalendarCheck, Loader2 } from "lucide-react";
import type { ClaimResult } from "@vetrix/db/runtime";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { claimAction } from "./claim-actions";

export function ClaimButton({ org, token, label }: { org: string; token: string; label: string }) {
  const [result, setResult] = useState<ClaimResult | null>(null);
  const [pending, start] = useTransition();
  if (result?.status === "claimed") {
    return <Alert variant="success">You&apos;re booked: {result.petName}, {result.when}. We&apos;ve sent a confirmation text.</Alert>;
  }
  return (
    <div className="grid gap-3">
      {result && (
        <Alert variant="warning">
          {result.status === "taken" ? "Sorry, someone claimed this time just before you. You're still on the waitlist." : result.status === "expired" ? "Sorry, this offer has ended. You're still on the waitlist." : "This link is no longer valid."}
        </Alert>
      )}
      {!result && (
        <Button size="lg" disabled={pending} onClick={() => start(async () => setResult(await claimAction(org, token)))}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <CalendarCheck aria-hidden />} {label}
        </Button>
      )}
    </div>
  );
}
