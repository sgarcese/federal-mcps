import type { Answer } from "./arms.js";
import type { BenchItem } from "./benchmark.js";
import { gradeExactNumber } from "./graders.js";
import type { Judge } from "./judge.js";
import type { Graded } from "./score.js";

/**
 * Grade one arm's answers: `exact_number` items are graded programmatically (a number within
 * tolerance), everything else goes to the judge, which enforces the rubric (all must_include,
 * no must_not_claim — a trap caps at 0). Returns the {id, score} rows `score()` aggregates.
 */
export async function gradeAnswers(
  answers: readonly Answer[],
  items: readonly BenchItem[],
  judge: Judge,
): Promise<Graded[]> {
  const byId = new Map(items.map((it) => [it.id, it]));
  const graded: Graded[] = [];
  for (const a of answers) {
    const item = byId.get(a.id);
    if (!item) throw new Error(`answer for unknown item id: ${a.id}`);
    let s = item.answer_type === "exact_number" ? gradeExactNumber(item, a.text) : undefined;
    if (s === undefined) s = await judge.grade(item, a.text);
    graded.push({ id: a.id, score: s });
  }
  return graded;
}
