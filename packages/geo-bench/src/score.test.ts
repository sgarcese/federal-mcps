import { describe, expect, it } from "vitest";
import type { BenchItem } from "./benchmark.js";
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
    id: "A02",
    category: "weighted_overlap",
    kg_relation: "weighted_overlap",
    answer_type: "exact_number",
    question: "q",
    ground_truth: "9",
    source: "s",
  },
  {
    id: "E01",
    category: "containment",
    kg_relation: "containment",
    answer_type: "rubric",
    question: "q",
    ground_truth: "g",
    source: "s",
  },
];

describe("score", () => {
  it("computes overall and per-category accuracy", () => {
    const report = score(
      [
        { id: "A01", score: 1 },
        { id: "A02", score: 0 },
        { id: "E01", score: 0.5 },
      ],
      items,
    );
    expect(report.overall).toBe(0.5);
    expect(report.by_category.weighted_overlap).toEqual({ n: 2, acc: 0.5 });
    expect(report.by_category.containment).toEqual({ n: 1, acc: 0.5 });
    expect(report.by_answer_type.exact_number).toEqual({ n: 2, acc: 0.5 });
  });

  it("lists the zeros, sorted", () => {
    const report = score(
      [
        { id: "A02", score: 0 },
        { id: "A01", score: 0 },
        { id: "E01", score: 1 },
      ],
      items,
    );
    expect(report.zeros).toEqual(["A01", "A02"]);
  });

  it("throws on an unknown id", () => {
    expect(() => score([{ id: "ZZ", score: 1 }], items)).toThrow(/unknown item ids/);
  });

  it("throws when there is nothing to score", () => {
    expect(() => score([], items)).toThrow(/no graded/);
  });
});
