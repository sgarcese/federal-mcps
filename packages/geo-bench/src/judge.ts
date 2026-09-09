import type { BenchItem } from "./benchmark.js";

/**
 * Grades an answer against an item's rubric or exact-set truth, returning 1 / 0.5 / 0. The
 * rubric contract: every `must_include` concept present scores toward 1; any `must_not_claim`
 * trap present caps the item at 0 (harness rubric, ADR-008 §4). The real judge is an LLM
 * working only from the rubric (as in the imported run); tests use a scripted stub.
 */
export interface Judge {
  readonly name: string;
  grade(item: BenchItem, answer: string): Promise<number>;
}

/** A deterministic judge for tests: returns the score wired for each id (default 0). */
export function stubJudge(scores: Record<string, number>): Judge {
  return {
    name: "stub",
    async grade(item) {
      return scores[item.id] ?? 0;
    },
  };
}

const RUBRIC_SYSTEM = `You are a strict grader for a US-geography benchmark. Grade the ANSWER against the RUBRIC only.
Rules:
- Score 1.0 only if the answer conveys EVERY must_include concept and makes NONE of the must_not_claim errors.
- Score 0.0 if the answer makes ANY must_not_claim error (a trap), regardless of other content, or is missing/fabricated.
- Score 0.5 for partial credit: some but not all must_include concepts, and no trap.
For exact_set items (no rubric), grade against GROUND_TRUTH and TOLERANCE: 1.0 if it meets the tolerance, 0.5 if close, 0.0 otherwise.
Reply with ONLY a JSON object: {"score": 1.0} (score in {0, 0.5, 1}).`;

/** The live judge: an Anthropic model reading the rubric. Lazy SDK import; no key needed offline. */
export function anthropicJudge(options: { model?: string; apiKey?: string } = {}): Judge {
  const modelId = options.model ?? "claude-sonnet-5";
  return {
    name: `anthropic-judge:${modelId}`,
    async grade(item, answer) {
      // biome-ignore lint/suspicious/noExplicitAny: the SDK is loaded lazily and untyped here.
      const { default: Anthropic } = (await import("@anthropic-ai/sdk")) as any;
      const client = new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
      const rubric = item.rubric
        ? `RUBRIC:\nmust_include: ${JSON.stringify(item.rubric.must_include)}\nmust_not_claim: ${JSON.stringify(item.rubric.must_not_claim)}`
        : `GROUND_TRUTH: ${item.ground_truth}\nTOLERANCE: ${item.tolerance ?? "exact"}`;
      const res = await client.messages.create({
        model: modelId,
        max_tokens: 200,
        system: RUBRIC_SYSTEM,
        messages: [
          {
            role: "user",
            content: `QUESTION: ${item.question}\n\n${rubric}\n\nANSWER:\n${answer}`,
          },
        ],
      });
      // biome-ignore lint/suspicious/noExplicitAny: the SDK response content is untyped here.
      const blocks = res.content as any[];
      const text = blocks
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
      const m = text.match(/"score"\s*:\s*(0(?:\.5)?|0\.5|1(?:\.0)?)/);
      const parsed = m ? Number.parseFloat(m[1] as string) : 0;
      return parsed === 0.5 ? 0.5 : parsed >= 1 ? 1 : 0;
    },
  };
}
