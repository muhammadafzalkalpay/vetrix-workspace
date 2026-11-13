"use client";

// Sandbox: type what the client texts back (C, YES, REFILL, or anything) and
// see what Vetrix does, exactly as if it came from their phone.
import { useState, useTransition } from "react";
import Link from "next/link";
import { Info, Loader2, Reply } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { simulateReplyAction, type SimulatedReply } from "./actions";

const EXAMPLES = ["C", "YES", "REFILL", "HELP", "Can we move it to Friday?"];

export function SimulateReply({ clientId, firstName }: { clientId: string; firstName: string }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<SimulatedReply | null>(null);
  const [pending, start] = useTransition();
  const send = (value: string) =>
    start(async () => {
      setResult(await simulateReplyAction(clientId, value));
      setText("");
    });
  return (
    <div className="grid gap-3">
      <p className="text-small text-muted-foreground">Type what {firstName} texts back, as if from their phone. Keywords act straight away; anything else goes to Riley.</p>
      <div className="flex flex-wrap gap-1.5">
        {EXAMPLES.map((e) => (
          <button key={e} type="button" disabled={pending} onClick={() => send(e)} className="rounded-full border px-3 py-1 text-caption font-medium hover:bg-muted disabled:opacity-50">
            {e}
          </button>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) send(text);
        }}
      >
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={`${firstName}'s reply…`} aria-label={`${firstName}'s reply`} maxLength={500} />
        <Button type="submit" variant="outline" disabled={pending || !text.trim()}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Reply aria-hidden />} Reply
        </Button>
      </form>
      {result && !result.ok && <Alert variant="error">{result.error}</Alert>}
      {result?.ok && (
        <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-small">
          {result.texts.length ? result.texts.map((t, i) => <p key={i}><span className="font-semibold">Vetrix:</span> {t}</p>) : <p className="text-muted-foreground">No text back.</p>}
          {result.notes.map((n, i) => (
            <p key={i} className="flex items-start gap-1.5 text-caption text-muted-foreground"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {n}</p>
          ))}
          {result.callId && <Link href={`/calls/${result.callId}`} className="text-caption font-semibold text-primary hover:underline">Open the conversation with Riley</Link>}
        </div>
      )}
    </div>
  );
}
