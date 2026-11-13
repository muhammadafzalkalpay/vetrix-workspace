"use client";

import { useState, useTransition } from "react";
import { BellOff, Loader2, Send } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { runRemindersAction, stopReminderAction, type RunResult } from "./actions";

export function RunButton({ asOf, due, quiet }: { asOf: string; due: number; quiet: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<RunResult | null>(null);
  const run = () => start(async () => setResult(await runRemindersAction(asOf)));
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={run} disabled={pending || due === 0}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
          {pending ? "Sending…" : `Send ${due} due reminder${due === 1 ? "" : "s"}`}
        </Button>
        {quiet && <span className="text-caption text-muted-foreground">Quiet hours: emails go now, texts and calls wait for the next run.</span>}
      </div>
      {result && !result.ok && <Alert variant="error">{result.error}</Alert>}
      {result?.ok && (
        <Alert variant="success">
          {result.summary.messages === 0
            ? "Nothing new to send."
            : `${result.summary.messages} message${result.summary.messages === 1 ? "" : "s"} ${result.sandbox ? "saved (Sandbox: not sent)" : "sent"}: ${result.summary.texts} texts, ${result.summary.emails} emails, ${result.summary.calls} calls${result.summary.households ? `, ${result.summary.households} combined for households` : ""}.`}
          {result.summary.heldForQuietHours > 0 && ` ${result.summary.heldForQuietHours} wait for the end of quiet hours.`}
          {result.summary.skipped.length > 0 && ` ${result.summary.skipped.length} could not be sent (no way to contact the client).`}
        </Alert>
      )}
    </div>
  );
}

export function StopButton({ ruleId, patientId, dueAt }: { ruleId: string; patientId: string; dueAt: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="grid justify-items-end gap-1">
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await stopReminderAction({ ruleId, patientId, dueAt });
            if (!r.ok) setError(r.error ?? "Could not stop.");
          })
        }
        aria-label="Stop this reminder"
      >
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <BellOff aria-hidden />} Stop
      </Button>
      {error && <span className="text-caption text-destructive">{error}</span>}
    </div>
  );
}
