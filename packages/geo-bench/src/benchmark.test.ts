import { describe, expect, it } from "vitest";
import { loadBenchmark, RELATIONAL_CATEGORIES } from "./benchmark.js";

describe("loadBenchmark (verbatim from the spike)", () => {
  it("loads the 55-item UGEO-Bench with its 8 categories", () => {
    const bench = loadBenchmark();
    expect(bench.name).toMatch(/UGEO-Bench/);
    expect(bench.items.length).toBe(55);
    const categories = new Set(bench.items.map((i) => i.category));
    expect(categories.size).toBe(8);
  });

  it("every item has a question, a ground truth, and a known answer type", () => {
    for (const item of loadBenchmark().items) {
      expect(item.question.length).toBeGreaterThan(0);
      expect(item.ground_truth.length).toBeGreaterThan(0);
      expect(["exact_number", "exact_set", "rubric"]).toContain(item.answer_type);
      if (item.answer_type === "rubric") {
        expect(Array.isArray(item.rubric?.must_include)).toBe(true);
        expect(Array.isArray(item.rubric?.must_not_claim)).toBe(true);
      }
    }
  });

  it("the relational categories the tools target are all present", () => {
    const categories = new Set(loadBenchmark().items.map((i) => i.category));
    for (const c of RELATIONAL_CATEGORIES) expect(categories.has(c)).toBe(true);
  });
});
