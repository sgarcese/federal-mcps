/**
 * @federal-mcps/server-bea — BEA Regional economic accounts by place (M14, ADR-019).
 *
 * `createBeaServer` builds the family shell's `McpServer` from this package's definition; a caller
 * runs it over stdio (`src/stdio.ts`, the `federal-mcps-bea` bin) or Streamable HTTP
 * (`src/http.ts`).
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
import { BEA_PER_MINUTE, beaBodyError, sanitizeBeaBody } from "./bea-api.js";
import { buildBeaDefinition } from "./definition.js";

export {
  BEA_CACHE_TTL_SECONDS,
  BEA_PER_MINUTE,
  type BeaDataRow,
  type BeaQuery,
  type BeaResults,
  beaBodyError,
  beaDataUrl,
  beaGetData,
  beaObservation,
  sanitizeBeaBody,
  unitOf,
  vintageNote,
} from "./bea-api.js";
export { type BeaDefinitionDeps, buildBeaDefinition } from "./definition.js";
export { BEA_API_ENDPOINT, BEA_REQUIRED_SENTENCE, describeSource } from "./describe-source.js";
export { openBundledCatalog, setCatalogForTest } from "@federal-mcps/core";
export { BEA_SERVER_VERSION } from "./version.js";

/**
 * BEA publishes no daily cap; it limits per minute (100 requests, 100 MB, 30 errors). The budget
 * counter is kept generous so the core client's accounting still applies.
 */
const BEA_DAILY_BUDGET = 50_000;

/** The core client for the BEA Data API: the limiter, and BEA's sanitize and 200-error hooks. */
export function createBeaHttpClient(): ReturnType<typeof createHttpClient> {
  return createHttpClient({
    source: "bea",
    budget: new MemoryBudgetStore(BEA_DAILY_BUDGET),
    cache: new MemoryCacheStore(),
    perMinute: BEA_PER_MINUTE,
    sanitize: sanitizeBeaBody,
    bodyError: beaBodyError,
  });
}

/** Builds the configured BEA `McpServer` over the bundled catalog. */
export function createBeaServer(options?: CreateServerOptions): McpServer {
  const definition = buildBeaDefinition({
    catalog: openBundledCatalog(),
    httpClient: createBeaHttpClient(),
    // biome-ignore lint/complexity/useLiteralKeys: process.env is an index signature under noPropertyAccessFromIndexSignature.
    apiKey: () => process.env["BEA_API_KEY"],
  });
  return createServer(definition, options);
}
