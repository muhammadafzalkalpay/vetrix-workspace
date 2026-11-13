import { describe, expect, it } from "vitest";
import { createLimiter } from "./rate-limit";

describe("createLimiter", () => {
  it("allows up to the limit per window, then refuses until the window passes", () => {
    let t = 0;
    const l = createLimiter({ limit: 2, windowMs: 1000, now: () => t });
    expect([l.take("a"), l.take("a"), l.take("a"), l.take("b")]).toEqual([true, true, false, true]);
    t = 1001;
    expect(l.take("a")).toBe(true);
  });

  it("keeps memory bounded", () => {
    const l = createLimiter({ limit: 1, windowMs: 1000, maxKeys: 2 });
    l.take("a");
    l.take("b");
    l.take("c");
    expect(l.take("a")).toBe(true); // "a" was evicted
  });
});
