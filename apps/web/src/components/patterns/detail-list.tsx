import { cn } from "@/lib/utils";

/** Label and value pairs for detail pages. Empty values show a dash. */
export function DetailList({ items, className }: { items: [label: string, value: React.ReactNode][]; className?: string }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-4 sm:grid-cols-2", className)}>
      {items.map(([label, value]) => (
        <div key={label} className="grid gap-0.5">
          <dt className="text-caption font-medium uppercase tracking-wider text-muted-foreground">{label}</dt>
          <dd className="break-words">{value === null || value === undefined || value === "" ? "—" : value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Panel({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("grid content-start gap-4 rounded-xl border bg-card p-5 shadow-card", className)}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-body font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}
