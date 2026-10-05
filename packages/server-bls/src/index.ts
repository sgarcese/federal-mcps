/**
 * @federal-mcps/server-bls — Bureau of Labor Statistics server (issue #8).
 *
 * `createBlsServer` builds the family shell's `McpServer` from this
 * package's `definition` (`packages/core/src/server/create-server.ts`); a
 * caller then runs it over stdio (`src/stdio.ts`, the `federal-mcps-bls` bin)
 * or Streamable HTTP (`src/http.ts`).
 */
import {
  type CreateServerOptions,
  createHttpClient,
  createServer,
  MemoryBudgetStore,
  MemoryCacheStore,
  openBundledCatalog,
} from "@federal-mcps/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildBlsDefinition } from "./definition.js";
import { setQcewHttpClient } from "./qcew-indicators.js";

export { buildBlsDefinition } from "./definition.js";
export { describeSource } from "./describe-source.js";
export { openBundledCatalog, setCatalogForTest } from "@federal-mcps/core";
export { BLS_SERVER_VERSION } from "./version.js";
export {
  buildLausSeriesId,
  isLausSeriesId,
  LAUS_MEASURE_CODES,
  LAUS_MEASURE_DESCRIPTIONS,
  LAUS_MEASURES,
  type LausMeasure,
  type LausSeriesOptions,
} from "./laus.js";
export { blsIndicatorTools, type BlsIndicatorToolsOptions } from "./get-indicator.js";
export { blsIndicatorDefinitions } from "./indicators.js";
export { lausIndicatorDefinitions } from "./laus-indicators.js";
export {
  createIndicatorRegistry,
  type IndicatorDefinition,
  type IndicatorFallback,
  type IndicatorRegistry,
} from "@federal-mcps/core";
export {
  fetchSeriesObservations,
  fetchSeriesRaw,
  BLS_SERIES_ENDPOINT,
  type SeriesFetchOptions,
  type SeriesObservation,
  type SeriesResult,
} from "./series-fetch.js";

/**
 * The daily BLS API budget (500 queries/day with a key, ADR-009 §2) and the per-container
 * cache/budget, created once per process.
 */
const BLS_DAILY_BUDGET = 500;

/**
 * QCEW's CSV slices are open data with no registered-key daily cap, so they get their own
 * generous budget rather than drawing on the BLS timeseries API's 500/day (#324, ADR-020 §2).
 */
const QCEW_DAILY_BUDGET = 50_000;

/** Builds the configured BLS `McpServer` over the bundled catalog + BLS API client, ready to run. */
export function createBlsServer(options?: CreateServerOptions): McpServer {
  const httpClient = createHttpClient({
    source: "bls",
    budget: new MemoryBudgetStore(BLS_DAILY_BUDGET),
    cache: new MemoryCacheStore(),
  });
  // QCEW's own source key ("bls-qcew") so its fetches never decrement the BLS API's budget.
  setQcewHttpClient(
    createHttpClient({
      source: "bls-qcew",
      budget: new MemoryBudgetStore(QCEW_DAILY_BUDGET),
      cache: new MemoryCacheStore(),
    }),
  );
  const definition = buildBlsDefinition({
    catalog: openBundledCatalog(),
    httpClient,
    // biome-ignore lint/complexity/useLiteralKeys: process.env is an index signature under noPropertyAccessFromIndexSignature.
    apiKey: () => process.env["BLS_API_KEY"],
  });
  return createServer(definition, options);
}
