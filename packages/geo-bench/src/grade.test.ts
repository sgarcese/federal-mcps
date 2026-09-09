import { describe, expect, it } from "vitest";
import type { Answer } from "./arms.js";
import type { BenchItem } from "./benchmark.js";
import { gradeAnswers } from "./grade.js";
import { stubJudge } from "./judge.js";

const items: BenchItem[] = [
  {
    id: "A01",
    category: "weighted_overlap",
    kg_relation: "weighted_overlap",
    answer_type: "exact_number",
    question: "how many tracts?",
    ground_truth: "17",
    tolerance: "exact",
    source: "s",
  },
  {
    id: "E01",
    category: "containment",
    kg_relation: "containment",
    answer_type: "rubric",
    question: "nest?",
    ground_truth: "no",
    source: "s",
    rubric: { must_include: ["no"], must_not_claim: ["nests"] },
  },
];

function ans(id: string, text: string): Answer {
  return { id, arm: "with_tools", question: "q", text };
}

describe("gradeAnswers", () => {
  it("grades exact_number programmatically, without consulting the judge", async () => {
    const judge = stubJudge({ A01: 0, E01: 1 }); // would give A01=0 if consulted
    const graded = await gradeAnswers([ans("A01", "It overlaps 17 tracts.")], items, judge);
    expect(graded).toEqual([{ id: "A01", score: 1 }]);
  });

  it("sends rubric items to the judge", async () => {
    const graded = await gradeAnswers(
      [ans("E01", "No, they do not nest.")],
      items,
      stubJudge({ E01: 1 }),
    );
    expect(graded).toEqual([{ id: "E01", score: 1 }]);
  });

  it("throws on an answer for an unknown item", async () => {
    await expect(gradeAnswers([ans("ZZ", "x")], items, stubJudge({}))).rejects.toThrow(
      /unknown item/,
    );
  });
});
