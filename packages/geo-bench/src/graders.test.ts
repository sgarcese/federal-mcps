import { describe, expect, it } from "vitest";
import type { BenchItem } from "./benchmark.js";
import { extractNumbers, gradeExactNumber, parseNumericTolerance } from "./graders.js";

function num(ground_truth: string, tolerance: string): BenchItem {
  return {
    id: "A",
    category: "weighted_overlap",
    kg_relation: "weighted_overlap",
    answer_type: "exact_number",
    question: "q",
    ground_truth,
    tolerance,
    source: "s",
  };
}

describe("number extraction and tolerance", () => {
  it("extracts numbers, stripping commas", () => {
    expect(extractNumbers("237 of 586 (40.4%)")).toEqual([237, 586, 40.4]);
    expect(extractNumbers("2,672 of 3,825 people")).toEqual([2672, 3825]);
  });

  it("reads numeric tolerances, and rejects non-numeric ones", () => {
    expect(parseNumericTolerance("exact")).toBe(0);
    expect(parseNumericTolerance("+/- 5")).toBe(5);
    expect(parseNumericTolerance("+/- 1 percentage point")).toBe(1);
    expect(parseNumericTolerance("all four required")).toBeUndefined();
    expect(parseNumericTolerance(undefined)).toBeUndefined();
  });
});

describe("gradeExactNumber", () => {
  it("scores 1 when the answer states the target within tolerance", () => {
    expect(gradeExactNumber(num("17", "exact"), "It overlaps 17 tracts.")).toBe(1);
    expect(gradeExactNumber(num("237 of 586 (40.4%)", "+/- 5"), "About 240 tracts.")).toBe(1);
  });

  it("scores 0 when no stated number is within tolerance", () => {
    expect(gradeExactNumber(num("17", "exact"), "Around 25 tracts.")).toBe(0);
    expect(gradeExactNumber(num("237 of 586 (40.4%)", "+/- 5"), "About 400.")).toBe(0);
  });

  it("returns undefined (defer to the judge) when the target/tolerance is not numeric", () => {
    expect(
      gradeExactNumber(num("Four states: PA NJ DE MD", "all four required"), "x"),
    ).toBeUndefined();
  });
});
