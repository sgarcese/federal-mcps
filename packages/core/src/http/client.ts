import { CACHE_MISS, type CacheInfo } from "../cache.js";
import type { BudgetStore } from "./budget.js";
import { type CacheEntry, type CacheStore, cacheKey } from "./cache-store.js";
import {
  HttpError,
  NetworkError,
  QuotaExceededError,
  RateLimitWaitError,
  TimeoutError,
} from "./errors.js";
import { type FixtureMode, readFixture, resolveFixtureMode, writeFixture } from "./fixtures.js";
import { DEFAULT_BACKOFF, computeDelayMs, isRetryableStatus, parseRetryAfter } from "./retry.js";

export interface FixtureOptions {
  readonly mode?: FixtureMode;
  /** Fixture directory, default "fixtures" relative to `process.cwd()`. */
  readonly dir?: string;
}

export interface HttpClientOptions {
  /** Agency source key, e.g. "bls". Used by budget, cache and fixture paths. */
  readonly source: string;
  readonly budget: BudgetStore;
  readonly cache: CacheStore;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  readonly fixtures?: FixtureOptions;
  readonly timeoutMs?: number;
  /**
   * Per-client token-bucket rate limit, in requests per minute (ADR-018 §5). Optional and
   * per-client rather than hard-coded, because an agency's published limit (e.g. HUD User's
   * 60 queries/minute/token) may be revised later. A request that finds no token waits for
   * the next refill; only a real upstream fetch consumes a token — cache hits and fixture
   * replay never do. Omit to leave the client unlimited (unchanged behaviour).
   */
  readonly perMinute?: number;
  /**
   * Longest a request will wait for a token before giving up, in ms (default 60_000). A
   * wait that would exceed this throws `RateLimitWaitError` naming the source and the
   * configured limit; `fetch` is never invoked in that case. Ignored when `perMinute` is
   * not set.
   */
  readonly maxWaitMs?: number;
  /** Sleep implementation used while waiting for a rate-limit token; defaults to `setTimeout`. Injectable for tests. */
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface RequestOptions {
  readonly headers?: Record<string, string>;
  /** Cached values younger than this are returned without a fetch. */
  readonly freshTtlSeconds?: number;
  /** Cached values older than this are never served on fetch failure. */
  readonly staleTtlSeconds?: number;
  readonly timeoutMs?: number;
  /**
   * Query parameters appended to the URL at fetch time only — an API key an agency accepts
   * nowhere else (Census). They are NOT part of the cache key, the fixture path or recorded
   * fixture, or any error's `url`, so a key never lands on disk or in a log (ADR-014 §9).
   */
  readonly queryAuth?: Record<string, string>;
}

export interface HttpResult<T> {
  readonly value: T;
  readonly cache: CacheInfo;
  readonly status: number;
}

export interface HttpClient {
  getJson<T>(url: string, options?: RequestOptions): Promise<HttpResult<T>>;
  getText(url: string, options?: RequestOptions): Promise<HttpResult<string>>;
  /** POST a JSON body and parse a JSON response, through the same retry/budget/cache/fixtures path. */
  postJson<T>(url: string, body: unknown, options?: RequestOptions): Promise<HttpResult<T>>;
}

interface RawResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_FIXTURE_DIR = "fixtures";
const DEFAULT_MAX_WAIT_MS = 60_000;

export function createHttpClient(options: HttpClientOptions): HttpClient {
  const { source, budget, cache } = options;
  const fetchFn = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const fixtureMode = resolveFixtureMode(options.fixtures?.mode);
  const fixtureDir = options.fixtures?.dir ?? DEFAULT_FIXTURE_DIR;
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const perMinute = options.perMinute;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const sleepFn =
    options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  // Token-bucket state for the optional per-minute rate limiter (ADR-018 §5). Only used
  // when `perMinute` is set; `tokens` refills continuously (perMinute tokens per 60s) up
  // to a capacity of `perMinute`. `blockedUntilMs` implements the optional
  // x-ratelimit-remaining: 0 backoff, holding the bucket closed until the header's minute
  // rolls over even if the continuous refill would otherwise have produced a token sooner.
  let tokens = perMinute ?? 0;
  let lastRefillMs = now().getTime();
  let blockedUntilMs = 0;

  /**
   * Checks the bucket for a token without waiting. Returns `null` and consumes a token
   * when one is available now; otherwise returns the number of ms until one will be.
   */
  function checkToken(): { waitMs: number } | null {
    if (perMinute === undefined) return null;

    const nowMs = now().getTime();
    const ratePerMs = perMinute / 60_000;

    if (nowMs < blockedUntilMs) {
      return { waitMs: blockedUntilMs - nowMs };
    }

    const elapsedMs = nowMs - lastRefillMs;
    if (elapsedMs > 0) {
      tokens = Math.min(perMinute, tokens + elapsedMs * ratePerMs);
      lastRefillMs = nowMs;
    }

    if (tokens >= 1) {
      tokens -= 1;
      return null;
    }

    const deficit = 1 - tokens;
    return { waitMs: Math.ceil(deficit / ratePerMs) };
  }

  /** Waits for a rate-limit token, throwing if the wait would exceed `maxWaitMs`. */
  async function acquireRateLimitToken(): Promise<void> {
    for (;;) {
      const pending = checkToken();
      if (pending === null) return;
      if (pending.waitMs > maxWaitMs) {
        throw new RateLimitWaitError({
          source,
          perMinute: perMinute as number,
          waitMs: pending.waitMs,
          maxWaitMs,
        });
      }
      await sleepFn(pending.waitMs);
    }
  }

  /** Optional back-off (ADR-018 §5): a response reporting no remaining quota closes the
   * bucket until its minute rolls over, even if the continuous refill would allow sooner. */
  function noteRateLimitHeaders(headers: Record<string, string>): void {
    if (perMinute === undefined) return;
    if (headers["x-ratelimit-remaining"] === "0") {
      blockedUntilMs = now().getTime() + 60_000;
    }
  }

  async function doFetchOnce(
    url: string,
    headers: Record<string, string> | undefined,
    timeoutMs: number,
    body: string | undefined,
    errorUrl: string = url,
  ): Promise<RawResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const init: RequestInit = { signal: controller.signal };
      if (headers) {
        init.headers = headers;
      }
      if (body !== undefined) {
        init.method = "POST";
        init.body = body;
      }
      const response = await fetchFn(url, init);
      const bodyText = await response.text();
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      return { status: response.status, headers: responseHeaders, body: bodyText };
    } catch (err) {
      if (controller.signal.aborted) {
        throw new TimeoutError({ source, url: errorUrl, timeoutMs });
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** The URL actually fetched: the clean URL plus any query-string credentials. */
  function wireUrl(url: string, queryAuth: Record<string, string> | undefined): string {
    if (!queryAuth || Object.keys(queryAuth).length === 0) return url;
    const extra = new URLSearchParams(queryAuth).toString();
    return `${url}${url.includes("?") ? "&" : "?"}${extra}`;
  }

  async function fetchWithRetry(
    url: string,
    headers: Record<string, string> | undefined,
    timeoutMs: number,
    body: string | undefined,
    queryAuth?: Record<string, string>,
  ): Promise<RawResponse> {
    const target = wireUrl(url, queryAuth);
    let attempt = 0;
    for (;;) {
      attempt++;
      let raw: RawResponse;
      try {
        raw = await doFetchOnce(target, headers, timeoutMs, body, url);
      } catch (err) {
        if (err instanceof TimeoutError) {
          throw err;
        }
        if (attempt >= DEFAULT_BACKOFF.maxAttempts) {
          throw new NetworkError({ source, url, cause: err });
        }
        await delay(computeDelayMs(attempt, DEFAULT_BACKOFF));
        continue;
      }

      if (!isRetryableStatus(raw.status)) {
        if (raw.status >= 400) {
          throw new HttpError({ source, status: raw.status, url, attempts: attempt });
        }
        return raw;
      }

      if (attempt >= DEFAULT_BACKOFF.maxAttempts) {
        throw new HttpError({ source, status: raw.status, url, attempts: attempt });
      }

      const retryAfterMs = parseRetryAfter(raw.headers["retry-after"] ?? null, now);
      const delayMs = retryAfterMs ?? computeDelayMs(attempt, DEFAULT_BACKOFF);
      await delay(delayMs);
    }
  }

  async function performRequest(
    url: string,
    headers: Record<string, string> | undefined,
    timeoutMs: number,
    body: string | undefined,
    queryAuth?: Record<string, string>,
  ): Promise<RawResponse> {
    if (fixtureMode === "replay") {
      const fixture = await readFixture(fixtureDir, source, url, body);
      if (fixture.status >= 400) {
        throw new HttpError({ source, status: fixture.status, url, attempts: 1 });
      }
      return fixture;
    }

    await acquireRateLimitToken();

    const budgetResult = await budget.consume(source, 1);
    if (!budgetResult.allowed) {
      throw new QuotaExceededError({ source, resetsAt: budgetResult.resetsAt });
    }

    const response = await fetchWithRetry(url, headers, timeoutMs, body, queryAuth);
    noteRateLimitHeaders(response.headers);

    if (fixtureMode === "record") {
      await writeFixture(fixtureDir, source, url, response, now, body);
    }

    return response;
  }

  async function getWithCache<T>(
    method: "GET" | "POST",
    url: string,
    options: RequestOptions | undefined,
    parse: (body: string) => T,
    body?: string,
  ): Promise<HttpResult<T>> {
    const headers = options?.headers;
    const timeoutMs = options?.timeoutMs ?? defaultTimeoutMs;
    const freshTtlSeconds = options?.freshTtlSeconds;
    const staleTtlSeconds = options?.staleTtlSeconds;
    const queryAuth = options?.queryAuth;
    const key = cacheKey(method, url, headers, body);

    let existing: CacheEntry | undefined;
    if (freshTtlSeconds !== undefined) {
      existing = await cache.get(key);
    }

    if (existing) {
      const ageSeconds = Math.floor((now().getTime() - existing.storedAt) / 1000);
      const fresh = freshTtlSeconds ?? 0;

      if (ageSeconds <= fresh) {
        return {
          value: existing.value as T,
          cache: { hit: true, ageSeconds },
          status: existing.status,
        };
      }

      try {
        const response = await performRequest(url, headers, timeoutMs, body, queryAuth);
        const value = parse(response.body);
        await cache.set(key, { value, status: response.status, storedAt: now().getTime() });
        return { value, cache: CACHE_MISS, status: response.status };
      } catch (err) {
        const staleLimit = staleTtlSeconds ?? fresh;
        if (ageSeconds <= staleLimit) {
          return {
            value: existing.value as T,
            cache: { hit: true, ageSeconds, stale: true },
            status: existing.status,
          };
        }
        throw err;
      }
    }

    const response = await performRequest(url, headers, timeoutMs, body, queryAuth);
    const value = parse(response.body);
    if (freshTtlSeconds !== undefined) {
      await cache.set(key, { value, status: response.status, storedAt: now().getTime() });
    }
    return { value, cache: CACHE_MISS, status: response.status };
  }

  return {
    getJson<T>(url: string, options?: RequestOptions) {
      return getWithCache<T>("GET", url, options, (body) => JSON.parse(body) as T);
    },
    getText(url: string, options?: RequestOptions) {
      return getWithCache<string>("GET", url, options, (body) => body);
    },
    postJson<T>(url: string, requestBody: unknown, options?: RequestOptions) {
      const headers = { "content-type": "application/json", ...(options?.headers ?? {}) };
      return getWithCache<T>(
        "POST",
        url,
        { ...options, headers },
        (body) => JSON.parse(body) as T,
        JSON.stringify(requestBody),
      );
    },
  };
}
