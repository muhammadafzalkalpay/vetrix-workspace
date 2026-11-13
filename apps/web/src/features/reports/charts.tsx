// Small, single-series charts for Reports. One hue (brand teal): magnitude, not
// identity, so no legend; values in text colour; each bar has a hover tooltip
// and an accessible label, and the numbers are also shown as text.
import { cn } from "@/lib/utils";

export function DailyBars({ days, label }: { days: { day: string; total: number; booked: number }[]; label: string }) {
  const max = Math.max(1, ...days.map((d) => d.total));
  const fmt = (d: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
  return (
    <figure className="grid gap-2">
      <div className="flex items-baseline justify-between text-caption text-muted-foreground">
        <figcaption>{label}</figcaption>
        <span className="tabular-nums">max {max}</span>
      </div>
      <div className="relative h-36 border-b border-border" role="img" aria-label={`${label}: ${days.map((d) => `${fmt(d.day)} ${d.total}`).join(", ")}`}>
        <div className="absolute inset-x-0 top-0 border-t border-dashed border-border/60" aria-hidden />
        <div className="absolute inset-0 flex items-end gap-[2px]">
          {days.map((d) => (
            <div key={d.day} className="group relative flex h-full flex-1 items-end" title={`${fmt(d.day)}: ${d.total} conversation${d.total === 1 ? "" : "s"}, ${d.booked} booked`}>
              <div
                className={cn("w-full rounded-t-[4px] bg-primary/85 transition-colors group-hover:bg-primary", d.total === 0 && "bg-transparent")}
                style={{ height: `${(d.total / max) * 100}%`, minHeight: d.total ? 3 : 0 }}
              />
              <span className="pointer-events-none absolute -top-7 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-caption text-background shadow group-hover:block">
                {fmt(d.day)}: {d.total} · {d.booked} booked
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex justify-between text-caption text-muted-foreground tabular-nums">
        <span>{fmt(days[0]!.day)}</span>
        <span>{fmt(days.at(-1)!.day)}</span>
      </div>
    </figure>
  );
}

export function RankedBars({ rows, empty }: { rows: { name: string; value: number }[]; empty: string }) {
  if (rows.length === 0) return <p className="text-small text-muted-foreground">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value));
  return (
    <ul className="grid gap-3">
      {rows.map((r) => (
        <li key={r.name} className="grid gap-1" title={`${r.name}: ${r.value}`}>
          <div className="flex justify-between gap-3 text-small">
            <span className="truncate">{r.name}</span>
            <span className="font-medium tabular-nums">{r.value}</span>
          </div>
          <div className="h-2 rounded-full bg-muted">
            <div className="h-2 rounded-full bg-primary/85" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
