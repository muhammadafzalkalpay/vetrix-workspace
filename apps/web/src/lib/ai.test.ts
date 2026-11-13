import { describe, expect, it } from "vitest";
import { createOpenAiClassifier } from "./ai";
import type { Logger } from "./logger";

const quiet = { debug() {}, info() {}, warn() {}, error() {} } as unknown as Logger;

function fakeOpenAi(answer: unknown, status = 200) {
  const calls: { body: Record<string, unknown> }[] = [];
  const f = (async (_url: string, init: RequestInit) => {
    calls.push({ body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }), { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("OpenAI triage classifier", () => {
  it("raises the level when the model understands what the phrases miss", async () => {
    const { f, calls } = fakeOpenAi({ level: "emergency", trigger_ids: ["toxin_ingestion"], evidence: "ate my sugar-free mints", unsure: false });
    const classify = createOpenAiClassifier({ apiKey: "k", model: "m" }, quiet, f);
    const a = await classify("he ate my mints, the sugar-free ones", ["Max"]);
    expect(a.level).toBe("emergency");
    expect(calls[0]!.body.model).toBe("m");
    expect((calls[0]!.body.messages as { content: string }[])[0]!.content).toContain('"Max"');
  });

  it("never lowers what the pack phrases found", async () => {
    const { f } = fakeOpenAi({ level: "routine", trigger_ids: [], evidence: "", unsure: false });
    const a = await createOpenAiClassifier({ apiKey: "k", model: "m" }, quiet, f)("she is having a seizure", []);
    expect(a.level).toBe("emergency");
  });

  it("falls back to the phrase rules when OpenAI fails", async () => {
    const { f } = fakeOpenAi({}, 500);
    const a = await createOpenAiClassifier({ apiKey: "k", model: "m" }, quiet, f)("he keeps throwing up", []);
    expect(a.level).toBe("urgent");
    const down = (async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    expect((await createOpenAiClassifier({ apiKey: "k", model: "m" }, quiet, down)("book a checkup", [])).level).toBe("routine");
  });
});
