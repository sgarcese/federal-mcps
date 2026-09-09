import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * UGEO-Bench, loaded verbatim from the imported research (#60, ADR-008 §4). The benchmark
 * file itself stays under `docs/spikes/geo-ontologies/` and is never edited here — this
 * package only reads it. The path is resolved relative to this module so the CLI, the
 * tests and a built `dist/` all find the one canonical copy.
 */
export const BENCHMARK_PATH = fileURLToPath(
  new URL("../../../docs/spikes/geo-ontologies/benchmark/benchmark.json", import.meta.url),
);

export type AnswerType = "exact_number" | "exact_set" | "rubric";

/** A rubric-graded item's grading contract: every concept required, every trap forbidden. */
export interface Rubric {
  must_include: string[];
  must_not_claim: string[];
}

export interface BenchItem {
  id: string;
  category: string;
  kg_relation: string;
  answer_type: AnswerType;
  question: string;
  ground_truth: string;
  tolerance?: string;
  source: string;
  rubric?: Rubric;
}

export interface Benchmark {
  name: string;
  description: string;
  date_built: string;
  metros: string[];
  grading: string;
  kg_relation_legend: Record<string, string>;
  items: BenchItem[];
}

/** The relational categories the geography tools are expected to lift (ADR-008 §4). */
export const RELATIONAL_CATEGORIES = [
  "weighted_overlap",
  "temporal_succession",
  "containment",
] as const;

let cached: Benchmark | undefined;

/** Reads and caches the benchmark. Throws if the imported file is missing or malformed. */
export function loadBenchmark(path: string = BENCHMARK_PATH): Benchmark {
  if (cached && path === BENCHMARK_PATH) return cached;
  const parsed = JSON.parse(readFileSync(path, "utf-8")) as Benchmark;
  if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
    throw new Error(`benchmark at ${path} has no items`);
  }
  if (path === BENCHMARK_PATH) cached = parsed;
  return parsed;
}
