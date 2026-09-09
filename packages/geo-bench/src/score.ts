import type { BenchItem } from "./benchmark.js";

/** One graded answer: score is 1 (correct), 0.5 (partial) or 0 (incorrect/trap/fabricated). */
export interface Graded {
  id: string;
  score: number;
}

export interface Cell {
  n: number;
  acc: number;
}

export interface ScoreReport {
  n: number;
  n_expected: number;
  overall: number;
  by_category: Record<string, Cell>;
  by_kg_relation: Record<string, Cell>;
  by_answer_type: Record<string, Cell>;
  zeros: string[];
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

function aggregate(groups: Map<string, number[]>): Record<string, Cell> {
  const out: Record<string, Cell> = {};
  for (const key of [...groups.keys()].sort()) {
    const scores = groups.get(key) as number[];
    out[key] = { n: scores.length, acc: round3(scores.reduce((a, b) => a + b, 0) / scores.length) };
  }
  return out;
}

/**
 * Aggregate graded answers by category, the knowledge-graph relation each item tests, and
 * answer type — a faithful port of harness.py `score`. Throws on unknown ids so a run can
 * never be scored against the wrong benchmark.
 */
export function score(graded: readonly Graded[], items: readonly BenchItem[]): ScoreReport {
  const byId = new Map(items.map((it) => [it.id, it]));
  const missing = graded.filter((g) => !byId.has(g.id)).map((g) => g.id);
  if (missing.length > 0)
    throw new Error(`unknown item ids in graded input: ${missing.join(", ")}`);
  if (graded.length === 0) throw new Error("no graded answers to score");

  const cat = new Map<string, number[]>();
  const rel = new Map<string, number[]>();
  const atype = new Map<string, number[]>();
  const push = (m: Map<string, number[]>, k: string, v: number): void => {
    const list = m.get(k) ?? [];
    list.push(v);
    m.set(k, list);
  };
  for (const g of graded) {
    const it = byId.get(g.id) as BenchItem;
    push(cat, it.category, g.score);
    push(rel, it.kg_relation, g.score);
    push(atype, it.answer_type, g.score);
  }

  return {
    n: graded.length,
    n_expected: items.length,
    overall: round3(graded.reduce((a, g) => a + g.score, 0) / graded.length),
    by_category: aggregate(cat),
    by_kg_relation: aggregate(rel),
    by_answer_type: aggregate(atype),
    zeros: graded
      .filter((g) => g.score === 0)
      .map((g) => g.id)
      .sort(),
  };
}
