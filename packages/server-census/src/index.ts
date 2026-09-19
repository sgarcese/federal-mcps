/**
 * @federal-mcps/server-census — U.S. Census Bureau server (M8, ADR-014).
 *
 * `createCensusServer` builds the family shell's `McpServer` from this package's definition; a
 * caller runs it over stdio (`src/stdio.ts`, the `federal-mcps-census` bin) or Streamable HTTP
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
import { buildCensusDefinition } from "./definition.js";

export { buildCensusDefinition, type CensusDefinitionDeps } from "./definition.js";
export {
  CENSUS_API_ENDPOINT,
  CENSUS_API_REQUIRED_SENTENCE,
  describeSource,
} from "./describe-source.js";
export { openBundledCatalog, setCatalogForTest } from "@federal-mcps/core";
export { CENSUS_SERVER_VERSION } from "./version.js";

/**
 * The Census Data API publishes no daily cap comparable to BLS's 500; keys are rate-limited.
 * The budget counter is kept generous so the core client's accounting still applies.
 */
const CENSUS_DAILY_BUDGET = 5_000;

/** Builds the configured Census `McpServer` over the bundled catalog + Census API client. */
export function createCensusServer(options?: CreateServerOptions): McpServer {
  const httpClient = createHttpClient({
    source: "census",
    budget: new MemoryBudgetStore(CENSUS_DAILY_BUDGET),
    cache: new MemoryCacheStore(),
  });
  const definition = buildCensusDefinition({
    catalog: openBundledCatalog(),
    httpClient,
    // biome-ignore lint/complexity/useLiteralKeys: process.env is an index signature under noPropertyAccessFromIndexSignature.
    apiKey: () => process.env["CENSUS_API_KEY"],
  });
  return createServer(definition, options);
}
