import * as React from "react";
import { cn } from "@/lib/utils";

/** Native checkbox with a label and optional hint; the whole row is clickable. */
export function CheckboxField({
  label,
  hint,
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "type"> & { label: string; hint?: string }) {
  const id = React.useId();
  return (
    <label htmlFor={id} className={cn("flex cursor-pointer items-start gap-3 rounded-md border bg-card p-3 hover:bg-muted/50", className)}>
      <input id={id} type="checkbox" className="mt-0.5 size-4 cursor-pointer accent-[var(--primary)]" {...props} />
      <span className="grid gap-0.5">
        <span className="text-small font-medium">{label}</span>
        {hint && <span className="text-caption text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}
