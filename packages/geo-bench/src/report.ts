import { RELATIONAL_CATEGORIES } from "./benchmark.js";
import type { ScoreReport } from "./score.js";

/** The per-category and overall lift of the tool arm over the closed-book arm. */
export interface Delta {
  overall: number;
  by_category: Record<string, number>;
  relational_overall: { withTools: number; without: number; delta: number };
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** Weighted accuracy across a set of categories (by item count), from a score report. */
function weightedAcross(report: ScoreReport, categories: readonly string[]): number {
  let n = 0;
  let sum = 0;
  for (const c of categories) {
    const cell = report.by_category[c];
    if (cell) {
      n += cell.n;
      sum += cell.acc * cell.n;
    }
  }
  return n === 0 ? 0 : round3(sum / n);
}

/** The lift of the tool arm over the closed-book arm, overall and per category. */
export function computeDelta(withTools: ScoreReport, without: ScoreReport): Delta {
  const by_category: Record<string, number> = {};
  const categories = new Set([
    ...Object.keys(withTools.by_category),
    ...Object.keys(without.by_category),
  ]);
  for (const c of categories) {
    by_category[c] = round3(
      (withTools.by_category[c]?.acc ?? 0) - (without.by_category[c]?.acc ?? 0),
    );
  }
  const relWith = weightedAcross(withTools, RELATIONAL_CATEGORIES);
  const relWithout = weightedAcross(without, RELATIONAL_CATEGORIES);
  return {
    overall: round3(withTools.overall - without.overall),
    by_category,
    relational_overall: {
      withTools: relWith,
      without: relWithout,
      delta: round3(relWith - relWithout),
    },
  };
}

/** A plain-text table: with-tools vs closed-book per category, overall, and the relational lift. */
export function renderReport(withTools: ScoreReport, without: ScoreReport): string {
  const d = computeDelta(withTools, without);
  const rows: string[] = [];
  rows.push("category                n   with   without   delta");
  const categories = Object.keys(d.by_category).sort();
  for (const c of categories) {
    const n = withTools.by_category[c]?.n ?? without.by_category[c]?.n ?? 0;
    const w = (withTools.by_category[c]?.acc ?? 0).toFixed(2);
    const wo = (without.by_category[c]?.acc ?? 0).toFixed(2);
    const marker = (RELATIONAL_CATEGORIES as readonly string[]).includes(c) ? "*" : " ";
    const dv = d.by_category[c] ?? 0;
    rows.push(
      `${marker}${c.padEnd(22)}${String(n).padStart(2)}   ${w}    ${wo}     ${dv >= 0 ? "+" : ""}${dv.toFixed(2)}`,
    );
  }
  rows.push("");
  rows.push(
    `OVERALL                    ${withTools.overall.toFixed(3)}  ${without.overall.toFixed(3)}   ${d.overall >= 0 ? "+" : ""}${d.overall.toFixed(3)}`,
  );
  const r = d.relational_overall;
  rows.push(
    `RELATIONAL (* categories)  ${r.withTools.toFixed(3)}  ${r.without.toFixed(3)}   ${r.delta >= 0 ? "+" : ""}${r.delta.toFixed(3)}`,
  );
  rows.push("");
  rows.push(
    r.delta > 0
      ? `GATE: tools lifted the relational categories by +${r.delta.toFixed(3)}.`
      : `GATE: no relational lift (delta ${r.delta.toFixed(3)}); the gate is not met.`,
  );
  return rows.join("\n");
}
