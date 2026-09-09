import type { BenchItem } from "./benchmark.js";

/** Pull every number out of free text, commas stripped (percent signs ignored). */
export function extractNumbers(text: string): number[] {
  const matches = text.match(/-?\d[\d,]*(?:\.\d+)?/g) ?? [];
  return matches.map((m) => Number.parseFloat(m.replace(/,/g, ""))).filter((n) => !Number.isNaN(n));
}

/** The first number in `text`, or undefined. Used to read an item's target from its truth. */
export function firstNumber(text: string): number | undefined {
  return extractNumbers(text)[0];
}

/**
 * Read a numeric tolerance from an item's `tolerance` string: "exact" → 0, "+/- 5" → 5,
 * "+/- 1 percentage point" → 1. Anything without a number (e.g. "all four required") is
 * not a numeric tolerance and returns undefined — those items are judged, not counted.
 */
export function parseNumericTolerance(tolerance: string | undefined): number | undefined {
  if (tolerance === undefined) return undefined;
  if (/^\s*exact\s*$/i.test(tolerance)) return 0;
  const m = tolerance.match(/([\d.]+)/);
  return m ? Number.parseFloat(m[1] as string) : undefined;
}

/**
 * Grade an `exact_number` item programmatically: the target is the first number in the
 * ground truth, and the answer scores 1 if any number it states falls within tolerance,
 * else 0 (exact items have no partial credit). Returns undefined when the item's target or
 * tolerance can't be read numerically, so the caller falls back to the judge.
 */
export function gradeExactNumber(item: BenchItem, answer: string): number | undefined {
  const target = firstNumber(item.ground_truth);
  const tol = parseNumericTolerance(item.tolerance);
  if (target === undefined || tol === undefined) return undefined;
  const within = extractNumbers(answer).some((n) => Math.abs(n - target) <= tol);
  return within ? 1 : 0;
}
