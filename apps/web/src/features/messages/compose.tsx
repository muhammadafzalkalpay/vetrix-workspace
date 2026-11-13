"use client";

// Write a text or email to one client. Shows why a channel is unavailable
// (STOP, no email, do not contact) instead of failing after sending.
import { useActionState, useEffect, useRef, useState } from "react";
import { Mail, MessageSquareText } from "lucide-react";
import { SMS_MAX } from "@vetrix/domain";
import { FormField } from "@/components/patterns/form-field";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fieldError, SubmitButton } from "@/features/clients/form-bits";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";
import { sendMessageAction } from "./actions";

export function Compose({
  clientId,
  firstName,
  canText,
  textBlockedReason,
  canEmail,
  emailBlockedReason,
  sandbox,
}: {
  clientId: string;
  firstName: string;
  canText: boolean;
  textBlockedReason: string | null;
  canEmail: boolean;
  emailBlockedReason: string | null;
  sandbox: boolean;
}) {
  const [state, action] = useActionState<ActionResult | null, FormData>(sendMessageAction.bind(null, clientId), null);
  const [channel, setChannel] = useState<"sms" | "email">(canText || !canEmail ? "sms" : "email");
  const [length, setLength] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const values = state && !state.ok ? state.values : undefined;

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      setLength(0);
    }
  }, [state]);

  const blocked = channel === "sms" ? (canText ? null : textBlockedReason) : canEmail ? null : emailBlockedReason;

  return (
    <form ref={formRef} action={action} className="grid gap-4">
      <input type="hidden" name="channel" value={channel} />
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Send as">
        {(
          [
            ["sms", "Text", MessageSquareText],
            ["email", "Email", Mail],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={channel === value}
            onClick={() => setChannel(value)}
            className={cn(
              "flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-small font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              channel === value ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted",
            )}
          >
            <Icon className="size-4" aria-hidden /> {label}
          </button>
        ))}
      </div>

      {blocked ? (
        <Alert variant="warning">{blocked}</Alert>
      ) : (
        <>
          {channel === "email" && (
            <FormField label="Subject" error={fieldError(state, "subject")}>
              {(p) => <Input {...p} name="subject" defaultValue={typeof values?.subject === "string" ? values.subject : ""} maxLength={150} />}
            </FormField>
          )}
          <FormField
            label={channel === "sms" ? `Text to ${firstName}` : `Email to ${firstName}`}
            error={fieldError(state, "body")}
            labelAside={channel === "sms" ? <span className={cn("text-caption tabular-nums", length > SMS_MAX ? "text-destructive" : "text-muted-foreground")}>{length}/{SMS_MAX}</span> : undefined}
          >
            {(p) => (
              <Textarea
                {...p}
                name="body"
                rows={channel === "sms" ? 3 : 6}
                defaultValue={typeof values?.body === "string" ? values.body : ""}
                onChange={(e) => setLength(e.target.value.length)}
                placeholder={channel === "sms" ? `Hi ${firstName}, ...` : ""}
              />
            )}
          </FormField>
          {state && !state.ok && !state.field && <Alert variant="error">{state.error}</Alert>}
          {state?.ok && <Alert variant="success">{state.message}</Alert>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-caption text-muted-foreground">{sandbox ? "Sandbox: the message is saved here and not sent." : "Sent now from the clinic's number or email."}</p>
            <SubmitButton pendingText="Sending…">{channel === "sms" ? "Send text" : "Send email"}</SubmitButton>
          </div>
        </>
      )}
    </form>
  );
}
