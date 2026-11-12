// Clinic-local time <-> instants, using the built-in time zone database.
// Clinics book in their own wall-clock time ("Tuesday 9:00"); the database
// stores instants. These helpers are DST-safe.

const MINUTE = 60_000;

/** Offset of `timezone` from UTC at `instant`, in minutes (e.g. +300 for Karachi). */
export function offsetMinutes(timezone: string, instant: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / MINUTE);
}

/** The instant of a clinic-local date and time ("2026-11-17", "09:30"). */
export function zonedInstant(date: string, time: string, timezone: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // Two passes settle DST edges: the offset at the guess, then at the corrected instant.
  let instant = guess - offsetMinutes(timezone, guess) * MINUTE;
  instant = guess - offsetMinutes(timezone, instant) * MINUTE;
  return instant;
}

/** Clinic-local date (YYYY-MM-DD) and minutes after midnight for an instant. */
export function localParts(instant: number, timezone: string): { date: string; minutes: number; weekday: number } {
  const local = instant + offsetMinutes(timezone, instant) * MINUTE;
  const d = new Date(local);
  return {
    date: d.toISOString().slice(0, 10),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
    weekday: d.getUTCDay(),
  };
}

/** "09:30" -> 570 */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

/** 570 -> "09:30" */
export function minutesToTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Calendar dates from `from` for `days` days (YYYY-MM-DD, no time zone involved). */
export function dateRange(from: string, days: number): string[] {
  const [y, m, d] = from.split("-").map(Number) as [number, number, number];
  return Array.from({ length: days }, (_, i) => new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10));
}

/** Weekday of a calendar date, 0 = Sunday. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
