import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifyReply, type ReplyRules } from "./replies";

const rules = JSON.parse(readFileSync(new URL("../../pack/veterinary/retention.json", import.meta.url), "utf8")).inbound_reply_handling as ReplyRules;

describe("classifyReply (retention.json inbound_reply_handling)", () => {
  it("acts on one-word keywords only", () => {
    expect(classifyReply("C", "appointment_confirmation", rules)).toBe("confirm");
    expect(classifyReply("c.", null, rules)).toBe("confirm");
    expect(classifyReply("R", null, rules)).toBe("reschedule");
    expect(classifyReply("REFILL", "prevention_refill", rules)).toBe("refill");
    expect(classifyReply("help", null, rules)).toBe("help");
    expect(classifyReply("can you see Max on Friday", "appointment_confirmation", rules)).toBe("conversation");
  });

  it("takes YES as the fasting confirmation only after a fasting check", () => {
    expect(classifyReply("Yes!", "fasting_check_evening", rules)).toBe("fasting_confirmed");
    expect(classifyReply("yes", "wellness_due_30", rules)).toBe("conversation");
  });

  it("recognises a death, but not an end-of-life request", () => {
    expect(classifyReply("Bella passed away last month", "vaccine_due_30", rules)).toBe("deceased");
    expect(classifyReply("we had him put down last week", null, rules)).toBe("deceased");
    expect(classifyReply("we need to put him down", null, rules)).toBe("conversation");
  });

  it("catches a worry after surgery only in reply to the post-op check-in", () => {
    expect(classifyReply("she's still bleeding a bit", "post_op_day1", rules)).toBe("post_op_concern");
    expect(classifyReply("she's still bleeding a bit", "wellness_due_7", rules)).toBe("conversation");
  });

  it("notes a client who moved to another vet", () => {
    expect(classifyReply("we moved, we have a new vet now", null, rules)).toBe("moved");
  });
});
