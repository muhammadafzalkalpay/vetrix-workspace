// Every rule that depends on time reads it from a Clock, never from
// `new Date()` directly. Tests use a fixed clock to freeze time, e.g. the
// reminder run on 2026-11-03 or a daylight-saving change.

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export interface FixedClock extends Clock {
  set(at: Date | string): void;
  advanceMinutes(minutes: number): void;
}

export function fixedClock(at: Date | string): FixedClock {
  let current = new Date(at);
  return {
    now: () => new Date(current),
    set(next) {
      current = new Date(next);
    },
    advanceMinutes(minutes) {
      current = new Date(current.getTime() + minutes * 60_000);
    },
  };
}
