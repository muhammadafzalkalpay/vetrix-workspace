"use client";

// Talk to Riley as a client would, by text or as a typed phone call. Every
// conversation is Sandbox: bookings and tasks are real records in this
// clinic, but no text or call reaches a phone.
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowUpRight, Info, Loader2, MessageSquareText, PhoneCall, PhoneOff, RotateCcw, SendHorizontal, UserPlus } from "lucide-react";
import type { TriageLevel } from "@vetrix/domain";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ConsoleResult } from "./actions";
import { SandboxBadge, TriageBadge } from "./labels";

export interface QuickCaller {
  name: string;
  mobile: string;
  display: string;
  pets: string[];
}

type Line = { id: number; speaker: "caller" | "ai" | "system"; body: string };

const SUGGESTIONS = [
  "I'd like to book a checkup",
  "Can I get a nail trim this week?",
  "She keeps throwing up",
  "My dog ate chocolate",
  "I need a refill of his medication",
  "What are your hours?",
];

let nextId = 1;

/** Server actions the console calls: staff ones, or the rate-limited public ones. */
export interface ConsoleActions {
  start: (input: { channel: "voice" | "sms"; callerNumber: string }) => Promise<ConsoleResult>;
  send: (callId: string, text: string) => Promise<ConsoleResult>;
  end: (callId: string) => Promise<void>;
}

export function SandboxConsole({
  aiName,
  callers,
  actions,
  showCallsLink = true,
}: {
  aiName: string;
  callers: QuickCaller[];
  actions: ConsoleActions;
  /** Staff can open the finished conversation under Calls; the public page cannot. */
  showCallsLink?: boolean;
}) {
  const [channel, setChannel] = useState<"sms" | "voice">("sms");
  const [number, setNumber] = useState(callers[0]?.display ?? "");
  const [callId, setCallId] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [text, setText] = useState("");
  const [level, setLevel] = useState<TriageLevel>("routine");
  const [ended, setEnded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [lines, pending]);

  const add = (speaker: Line["speaker"], bodies: string[]) =>
    setLines((prev) => [...prev, ...bodies.map((body) => ({ id: nextId++, speaker, body }))]);

  function start() {
    setError(null);
    startTransition(async () => {
      const r = await actions.start({ channel, callerNumber: number });
      if (!r.ok) return setError(r.error);
      setCallId(r.callId);
      setLines([]);
      setLevel("routine");
      setEnded(false);
      add("ai", r.replies);
      setTimeout(() => inputRef.current?.focus(), 50);
    });
  }

  function send(message: string) {
    const body = message.trim();
    if (!body || !callId || pending || ended) return;
    setError(null);
    setText("");
    add("caller", [body]);
    startTransition(async () => {
      const r = await actions.send(callId, body);
      if (!r.ok) return setError(r.error);
      add("ai", r.replies);
      add("system", r.notes);
      setLevel(r.triageLevel);
      setEnded(r.ended);
    });
  }

  function hangUp() {
    if (!callId) return;
    startTransition(async () => {
      await actions.end(callId);
      add("system", [channel === "voice" ? "Caller hung up." : "Conversation closed."]);
      setEnded(true);
    });
  }

  function reset() {
    setCallId(null);
    setLines([]);
    setEnded(false);
    setLevel("routine");
    setError(null);
  }

  const digits = (v: string) => v.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  const chosen = callers.find((c) => digits(c.mobile) === digits(number));

  if (!callId) {
    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="grid content-start gap-5 rounded-xl border bg-card p-5 shadow-card">
          <div className="grid gap-2">
            <Label>How is the client getting in touch?</Label>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Channel">
              {(
                [
                  ["sms", "Text message", MessageSquareText],
                  ["voice", "Phone call", PhoneCall],
                ] as const
              ).map(([value, label, Icon]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={channel === value}
                  onClick={() => setChannel(value)}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-lg border px-3 py-3 text-small font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    channel === value ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted",
                  )}
                >
                  <Icon className="size-4" aria-hidden /> {label}
                </button>
              ))}
            </div>
            {channel === "voice" && (
              <p className="text-caption text-muted-foreground">You type what the caller would say. Live voice comes with the Azure key and the voice service.</p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="caller-number">Client&apos;s mobile number</Label>
            <Input id="caller-number" value={number} onChange={(e) => setNumber(e.target.value)} inputMode="tel" placeholder="(555) 555-0123" autoComplete="off" />
            <p className="text-caption text-muted-foreground">
              {chosen ? `Riley will recognise ${chosen.name} (${chosen.pets.join(", ") || "no pets"}).` : "A number Riley doesn't know is treated as a new client."}
            </p>
          </div>

          {error && <Alert variant="error">{error}</Alert>}
          <Button onClick={start} disabled={pending || !number.trim()} className="w-full sm:w-auto sm:justify-self-start">
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : channel === "voice" ? <PhoneCall aria-hidden /> : <MessageSquareText aria-hidden />}
            {channel === "voice" ? `Call ${aiName}` : `Text ${aiName}`}
          </Button>
        </section>

        <section className="grid content-start gap-3 rounded-xl border bg-card p-5 shadow-card">
          <h3 className="font-semibold">Pick a client</h3>
          <ul className="grid gap-2">
            {callers.map((c) => (
              <li key={c.mobile}>
                <button
                  type="button"
                  onClick={() => setNumber(c.display)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    chosen?.mobile === c.mobile ? "border-primary bg-primary/5" : "hover:bg-muted",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{c.name}</span>
                    <span className="block truncate text-caption text-muted-foreground">{c.pets.join(", ") || "No active pets"}</span>
                  </span>
                  <span className="shrink-0 text-caption text-muted-foreground tabular-nums">{c.display}</span>
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                onClick={() => setNumber(`(555) 555-${String(Math.floor(1000 + Math.random() * 8999))}`)}
                className="flex w-full items-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-small font-medium text-primary transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <UserPlus className="size-4" aria-hidden /> A new client
              </button>
            </li>
          </ul>
        </section>
      </div>
    );
  }

  return (
    <section className="mx-auto grid w-full max-w-3xl overflow-hidden rounded-xl border bg-card shadow-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-full bg-primary text-small font-semibold text-primary-foreground">{aiName[0]}</span>
          <div className="min-w-0">
            <p className="truncate font-semibold">
              {aiName} · {channel === "voice" ? "Phone call" : "Text"}
            </p>
            <p className="truncate text-caption text-muted-foreground">{chosen ? chosen.name : number}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <TriageBadge level={level} />
          <SandboxBadge />
        </div>
      </header>

      <div className="grid max-h-[60vh] min-h-[320px] content-start gap-3 overflow-y-auto bg-muted/30 px-4 py-5" aria-live="polite">
        {lines.map((l) =>
          l.speaker === "system" ? (
            <p key={l.id} className="mx-auto flex max-w-[90%] items-start gap-1.5 rounded-md bg-background px-3 py-1.5 text-caption text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {l.body}
            </p>
          ) : (
            <div key={l.id} className={cn("flex", l.speaker === "caller" ? "justify-end" : "justify-start")}>
              <p
                className={cn(
                  "max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-small shadow-sm",
                  l.speaker === "caller" ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm border bg-card",
                )}
              >
                <span className="sr-only">{l.speaker === "caller" ? "Client: " : `${aiName}: `}</span>
                {l.body}
              </p>
            </div>
          ),
        )}
        {pending && (
          <div className="flex justify-start">
            <span className="flex items-center gap-1 rounded-2xl rounded-bl-sm border bg-card px-4 py-3" aria-label={`${aiName} is replying`}>
              {[0, 1, 2].map((i) => (
                <span key={i} className="size-1.5 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: `${i * 120}ms` }} />
              ))}
            </span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {error && <Alert variant="error" className="m-4 mb-0">{error}</Alert>}

      {ended ? (
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
          <p className="text-small text-muted-foreground">This conversation has ended.</p>
          <div className="flex gap-2">
            {showCallsLink && (
              <Link href={`/calls/${callId}`} className="inline-flex items-center gap-1 text-small font-semibold text-primary hover:underline">
                Open in Calls <ArrowUpRight className="size-4" aria-hidden />
              </Link>
            )}
            <Button variant="outline" size="sm" onClick={reset}>
              <RotateCcw aria-hidden /> New conversation
            </Button>
          </div>
        </footer>
      ) : (
        <footer className="grid gap-3 border-t px-4 py-3">
          {lines.length <= 1 && (
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  disabled={pending}
                  className="rounded-full border px-3 py-1 text-caption font-medium transition-colors hover:border-primary/50 hover:bg-primary/5 disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send(text);
            }}
          >
            <Input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={channel === "voice" ? "Type what the caller says…" : "Type a text message…"}
              aria-label="Message"
              maxLength={1000}
              autoComplete="off"
            />
            <Button type="submit" disabled={pending || !text.trim()} aria-label="Send">
              <SendHorizontal aria-hidden />
            </Button>
            <Button type="button" variant="outline" onClick={hangUp} disabled={pending} aria-label={channel === "voice" ? "Hang up" : "Close conversation"}>
              <PhoneOff aria-hidden />
            </Button>
          </form>
        </footer>
      )}
    </section>
  );
}
