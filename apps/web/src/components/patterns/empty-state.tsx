import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** What a list or page shows when there is nothing in it yet. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-card px-6 py-12 text-center", className)}>
      <span className="flex size-12 items-center justify-center rounded-full bg-secondary text-primary">
        <Icon className="size-6" aria-hidden />
      </span>
      <div className="grid max-w-sm gap-1">
        <p className="font-semibold">{title}</p>
        {description && <p className="text-small text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
