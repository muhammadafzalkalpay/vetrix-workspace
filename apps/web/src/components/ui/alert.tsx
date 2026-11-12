import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const alertVariants = cva(
  "flex gap-3 rounded-md border px-4 py-3 text-small [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        info: "border-info/30 bg-info-soft text-foreground [&>svg]:text-info",
        success: "border-success/30 bg-success-soft text-foreground [&>svg]:text-success-text",
        warning: "border-warning/40 bg-warning-soft text-foreground [&>svg]:text-warning-text",
        error: "border-destructive/30 bg-danger-soft text-foreground [&>svg]:text-destructive",
      },
    },
    defaultVariants: { variant: "info" },
  },
);

/** Errors are announced to screen readers immediately; others politely. */
function Alert({ className, variant, ...props }: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Alert };
