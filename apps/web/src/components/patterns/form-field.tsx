"use client";

import * as React from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface FormFieldProps {
  label: string;
  /** Shown under the field when there is no error. */
  hint?: string;
  error?: string;
  /** Extra content on the label row, e.g. a "Forgot password?" link. */
  labelAside?: React.ReactNode;
  className?: string;
  /** Receives the ids that connect the input to its label, hint and error. */
  children: (field: { id: string; "aria-describedby"?: string; "aria-invalid"?: true }) => React.ReactNode;
}

/** Label, input, hint and error, wired together for screen readers. */
export function FormField({ label, hint, error, labelAside, className, children }: FormFieldProps) {
  const id = React.useId();
  const messageId = `${id}-message`;
  const message = error ?? hint;
  return (
    <div className={cn("grid gap-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {labelAside}
      </div>
      {children({
        id,
        "aria-describedby": message ? messageId : undefined,
        "aria-invalid": error ? true : undefined,
      })}
      {message && (
        <p id={messageId} className={cn("text-small", error ? "text-destructive" : "text-muted-foreground")}>
          {message}
        </p>
      )}
    </div>
  );
}
