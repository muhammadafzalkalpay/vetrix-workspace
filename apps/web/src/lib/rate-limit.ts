// A small sliding-window limiter for public endpoints (the browser trial).
// In memory, per server instance: with several Cloud Run instances a visitor
// gets a little more, which is acceptable for a sandbox. Sign-in uses Better
// Auth's database-backed limiter instead.

export interface Limiter {
  /** True when the key may proceed (and the attempt is counted). */
  take(key: string): boolean;
}

export function createLimiter(options: { limit: number; windowMs: number; now?: () => number; maxKeys?: number }): Limiter {
  const now = options.now ?? Date.now;
  const hits = new Map<string, number[]>();
  const maxKeys = options.maxKeys ?? 10_000;
  return {
    take(key) {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((x) => t - x < options.windowMs);
      if (recent.length >= options.limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(t);
      hits.delete(key); // re-insert so the oldest keys are evicted first
      hits.set(key, recent);
      if (hits.size > maxKeys) hits.delete(hits.keys().next().value!);
      return true;
    },
  };
}
