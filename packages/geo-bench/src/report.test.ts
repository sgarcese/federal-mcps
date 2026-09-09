import { describe, expect, it } from "vitest";
import type { BenchItem } from "./benchmark.js";
import { computeDelta, renderReport } from "./report.js";
import { score } from "./score.js";

const items: BenchItem[] = [
  {
    id: "A01",
    category: "weighted_overlap",
    kg_relation: "weighted_overlap",
    answer_type: "exact_number",
    question: "q",
    ground_truth: "17",
    source: "s",
  },
  {
    id: "B01",
    category: "temporal_succession",
    kg_relation: "temporal_succession",
    answer_type: "rubric",
    question: "q",
    ground_truth: "g",
    source: "s",
  },
  {
    id: "Z01",
    category: "control",
    kg_relation: "control",
    answer_type: "rubric",
    question: "q",
    ground_truth: "g",
    source: "s",
  },
];

// With tools: relational items correct; without: relational items wrong; control same.
const withTools = score(
  [
    { id: "A01", score: 1 },
    { id: "B01", score: 1 },
    { id: "Z01", score: 1 },
  ],
  items,
);
const without = score(
  [
    { id: "A01", score: 0 },
    { id: "B01", score: 0 },
    { id: "Z01", score: 1 },
  ],
  items,
);

describe("computeDelta", () => {
  it("computes overall and per-category lift", () => {
    const d = computeDelta(withTools, without);
    expect(d.overall).toBeCloseTo(0.667, 3);
    expect(d.by_category.weighted_overlap).toBe(1);
    expect(d.by_category.control).toBe(0);
  });

  it("reports the relational lift the gate cares about", () => {
    const d = computeDelta(withTools, without);
    expect(d.relational_overall.withTools).toBe(1);
    expect(d.relational_overall.without).toBe(0);
    expect(d.relational_overall.delta).toBe(1);
  });
});

describe("renderReport", () => {
  it("marks relational categories and prints a GATE verdict line", () => {
    const text = renderReport(withTools, without);
    expect(text).toMatch(/\*weighted_overlap/);
    expect(text).toMatch(/GATE: tools lifted the relational categories by \+1\.000/);
  });

  it("says the gate is not met when there is no relational lift", () => {
    const flat = score(
      [
        { id: "A01", score: 0 },
        { id: "B01", score: 0 },
        { id: "Z01", score: 1 },
      ],
      items,
    );
    expect(renderReport(flat, flat)).toMatch(/the gate is not met/);
  });
});
