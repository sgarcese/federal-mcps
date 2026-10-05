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
  LIMITS_ENV,
  type Limiter,
  type LimitsConfig,
  limiterFromEnv,
  MemoryBudgetStore,
  MemoryCacheStore,
  openBundledCatalog,
  parseLimitsConfig,
  splitUpstreamPerMinute,
} from "@federal-mcps/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BEA_ERRORS_PER_MINUTE, BEA_PER_MINUTE, beaBodyError, sanitizeBeaBody } from "./bea-api.js";
import { buildBeaDefinition } from "./definition.js";

export {
  BEA_CACHE_TTL_SECONDS,
  BEA_ERRORS_PER_MINUTE,
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

/**
 * BEA's published per-minute quota and error budget, split across the containers
 * `FEDERAL_MCPS_LIMITS` reserves concurrency for (#324, ADR-020 §2, §7): e.g. 90 ÷ 2 = 45 and
 * 30 ÷ 2 = 15. Stay at today's constants when `limits` is unset, or set but silent on BEA or on
 * `reservedConcurrency` — exported so the split itself is unit-testable without env vars.
 */
export function resolveBeaPerMinute(limits: LimitsConfig | undefined): number {
  return splitUpstreamPerMinute(limits, "upstreamPerMinute", "bea", BEA_PER_MINUTE);
}
export function resolveBeaErrorsPerMinute(limits: LimitsConfig | undefined): number {
  return splitUpstreamPerMinute(limits, "upstreamErrorsPerMinute", "bea", BEA_ERRORS_PER_MINUTE);
}

/** The core client for the BEA Data API: the limiter, and BEA's sanitize and 200-error hooks. */
export function createBeaHttpClient(limiter?: Limiter): ReturnType<typeof createHttpClient> {
  const limits = parseLimitsConfig(process.env[LIMITS_ENV]);
  return createHttpClient({
    source: "bea",
    budget: new MemoryBudgetStore(BEA_DAILY_BUDGET),
    cache: new MemoryCacheStore(),
    perMinute: resolveBeaPerMinute(limits),
    errorsPerMinute: resolveBeaErrorsPerMinute(limits),
    sanitize: sanitizeBeaBody,
    bodyError: beaBodyError,
    ...(limiter === undefined ? {} : { limiter }),
  });
}

/** Builds the configured BEA `McpServer` over the bundled catalog. */
export function createBeaServer(options?: CreateServerOptions): McpServer {
  // One limiter per container (#322, ADR-020 §2, §7): the shell counts tool calls, and every
  // client charges its upstream fetches, against the same counters.
  const limiter = options?.limiter ?? limiterFromEnv();
  const definition = buildBeaDefinition({
    catalog: openBundledCatalog(),
    httpClient: createBeaHttpClient(limiter),
    // biome-ignore lint/complexity/useLiteralKeys: process.env is an index signature under noPropertyAccessFromIndexSignature.
    apiKey: () => process.env["BEA_API_KEY"],
  });
  return createServer(definition, { ...options, limiter });
}
