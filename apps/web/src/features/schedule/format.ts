// Times and dates shown in the clinic's own time zone.
export function formatTime(instant: number | Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(instant);
}

/** "Tuesday, November 17" for a YYYY-MM-DD clinic date. */
export function formatDayLong(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** "Tue 17" for day chips. */
export function formatDayShort(date: string): { weekday: string; day: string; month: string } {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return {
    weekday: new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(dt),
    day: String(d),
    month: new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(dt),
  };
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
