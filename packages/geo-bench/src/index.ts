/**
 * @federal-mcps/geo-bench — UGEO-Bench in-repo (#60, ADR-008 §4). Runs a model with and
 * without the geography MCP tools and scores the lift; the benchmark itself stays verbatim
 * under docs/spikes/geo-ontologies/ and is only read here. The offline pieces (batches,
 * scoring, exact-number grading, report) are unit-tested; running a live model arm and the
 * LLM judge is a documented manual gate (see README), not a merge gate.
 */
export {
  type AnswerType,
  type BenchItem,
  type Benchmark,
  BENCHMARK_PATH,
  loadBenchmark,
  RELATIONAL_CATEGORIES,
  type Rubric,
} from "./benchmark.js";
export {
  DEFAULT_BATCH_SIZE,
  DEFAULT_SEED,
  makeBatches,
  renderBatch,
  seededShuffle,
} from "./batches.js";
export {
  type Answer,
  type Arm,
  connectGeoClient,
  runWithoutTools,
  runWithTools,
  toolSpecs,
} from "./arms.js";
export { extractNumbers, firstNumber, gradeExactNumber, parseNumericTolerance } from "./graders.js";
export { anthropicJudge, type Judge, stubJudge } from "./judge.js";
export { anthropicModel, type Model, type ToolExecutor, type ToolSpec } from "./model.js";
export { gradeAnswers } from "./grade.js";
export { type Cell, type Graded, score, type ScoreReport } from "./score.js";
export { computeDelta, type Delta, renderReport } from "./report.js";
export {
  BENCH_CATALOG_CSV,
  benchCatalogRows,
  buildBenchCatalog,
  parseBenchOverlaps,
} from "./bench-catalog.js";
