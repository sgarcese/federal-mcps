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

export { buildBlsDefinition } from "./definition.js";
export { describeSource } from "./describe-source.js";
export { openBundledCatalog, setCatalogForTest } from "@federal-mcps/core";
export { BLS_SERVER_VERSION } from "./version.js";
export {
  buildLausSeriesId,
  isLausSeriesId,
  LAUS_MEASURE_CODES,
  LAUS_MEASURES,
  type LausMeasure,
  type LausSeriesOptions,
} from "./laus.js";
export { blsIndicatorTools, type BlsIndicatorToolsOptions } from "./get-indicator.js";

/**
 * The daily BLS API budget (500 queries/day with a key, ADR-009 §2) and the per-container
 * cache/budget, created once per process.
 */
const BLS_DAILY_BUDGET = 500;

/** Builds the configured BLS `McpServer` over the bundled catalog + BLS API client, ready to run. */
export function createBlsServer(options?: CreateServerOptions): McpServer {
  const httpClient = createHttpClient({
    source: "bls",
    budget: new MemoryBudgetStore(BLS_DAILY_BUDGET),
    cache: new MemoryCacheStore(),
  });
  const definition = buildBlsDefinition({
    catalog: openBundledCatalog(),
    httpClient,
    // biome-ignore lint/complexity/useLiteralKeys: process.env is an index signature under noPropertyAccessFromIndexSignature.
    apiKey: () => process.env["BLS_API_KEY"],
  });
  return createServer(definition, options);
}
