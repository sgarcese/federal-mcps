/**
 * The shared HTTP client (issue #5): retry/backoff, timeout, per-source daily
 * budget, two-tier cache and fixture record/replay. Every server package
 * calls upstream agency APIs through this — no direct `fetch`.
 */
export type { BudgetConsumeResult, BudgetStore } from "./budget.js";
export { MemoryBudgetStore } from "./budget.js";
export type { CacheEntry, CacheStore } from "./cache-store.js";
export { cacheKey, MemoryCacheStore } from "./cache-store.js";
export type {
  FixtureOptions,
  HttpClient,
  HttpClientOptions,
  HttpResult,
  RequestOptions,
} from "./client.js";
export { createHttpClient } from "./client.js";
export {
  AgencyApiError,
  HttpClientError,
  HttpError,
  MissingFixtureError,
  NetworkError,
  QuotaExceededError,
  RateLimitWaitError,
  TimeoutError,
  UpstreamErrorLimitError,
} from "./errors.js";
export type { FixtureMode, FixtureResponse } from "./fixtures.js";
export { fixturePath, readFixture, resolveFixtureMode, writeFixture } from "./fixtures.js";
export type { BackoffOptions } from "./retry.js";
export { computeDelayMs, DEFAULT_BACKOFF, isRetryableStatus, parseRetryAfter } from "./retry.js";
