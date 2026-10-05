/**
 * @federal-mcps/server-hud — HUD User Data API server (M11 shell, ADR-018).
 *
 * `createHudServer` builds the family shell's `McpServer` from this package's definition; a
 * caller runs it over stdio (`src/stdio.ts`, the `federal-mcps-hud` bin) or Streamable HTTP
 * (`src/http.ts`). This release ships the shell only — `hud_resolve_place` and
 * `hud_describe_source` — no indicator tools yet.
 */
import {
  type CreateServerOptions,
  createHttpClient,
  createServer,
  LIMITS_ENV,
  type LimitsConfig,
  MemoryBudgetStore,
  MemoryCacheStore,
  openBundledCatalog,
  parseLimitsConfig,
  splitUpstreamPerMinute,
} from "@federal-mcps/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildHudDefinition } from "./definition.js";

export { buildHudDefinition, type HudDefinitionDeps } from "./definition.js";
export {
  HUD_USER_API_ENDPOINT,
  HUD_USER_REQUIRED_SENTENCE,
  describeSource,
} from "./describe-source.js";
export { openBundledCatalog, setCatalogForTest } from "@federal-mcps/core";
export { HUD_SERVER_VERSION } from "./version.js";

/**
 * HUD User API rate limit: 60 queries per minute per token (ADR-018 §1, §7). No indicator
 * tool calls the API yet, so nothing enforces this locally today — a shared rate limiter is
 * being added to core in parallel (#231); this constant is the seam it will plug into.
 */
export const HUD_USER_PER_MINUTE = 60;

/**
 * The HUD User API publishes no daily cap; the token is rate-limited per minute instead
 * (`HUD_USER_PER_MINUTE`). The budget counter is kept generous so the core client's
 * accounting still applies once an indicator tool starts calling it.
 */
const HUD_DAILY_BUDGET = 50_000;

/**
 * HUD's published per-minute quota, split across the containers `FEDERAL_MCPS_LIMITS`
 * reserves concurrency for (#324, ADR-020 §2, §7): e.g. 60 ÷ 2 = 30. Stays at
 * `HUD_USER_PER_MINUTE` when `limits` is unset, or set but silent on HUD or on
 * `reservedConcurrency` — exported so the split itself is unit-testable without env vars.
 */
export function resolveHudPerMinute(limits: LimitsConfig | undefined): number {
  return splitUpstreamPerMinute(limits, "upstreamPerMinute", "hud", HUD_USER_PER_MINUTE);
}

/** Builds the configured HUD User `McpServer` over the bundled catalog. */
export function createHudServer(options?: CreateServerOptions): McpServer {
  // The core client's per-minute limiter (#231, ADR-018 §5) enforces HUD User's 60/minute per
  // token, split across reserved containers when FEDERAL_MCPS_LIMITS is configured (#324).
  const limits = parseLimitsConfig(process.env[LIMITS_ENV]);
  const httpClient = createHttpClient({
    source: "hud",
    budget: new MemoryBudgetStore(HUD_DAILY_BUDGET),
    cache: new MemoryCacheStore(),
    perMinute: resolveHudPerMinute(limits),
  });
  const definition = buildHudDefinition({
    catalog: openBundledCatalog(),
    httpClient,
    // biome-ignore lint/complexity/useLiteralKeys: process.env is an index signature under noPropertyAccessFromIndexSignature.
    token: () => process.env["HUD_USER_TOKEN"],
  });
  return createServer(definition, options);
}

export {
  type ChasEntity,
  chasEntityOf,
  chasUrl,
  fmrEntityOf,
  fmrUrl,
  HUD_CACHE_TTL_SECONDS,
  hudGetJson,
  ilUrl,
  mtspUrl,
  type PictureEntity,
  pictureCensusFor,
  pictureEntityOf,
  pictureUrl,
} from "./hud-api.js";
