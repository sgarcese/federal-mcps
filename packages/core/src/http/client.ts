import { CACHE_MISS, type CacheInfo } from "../cache.js";
import type { BudgetStore } from "./budget.js";
import { type CacheEntry, type CacheStore, cacheKey } from "./cache-store.js";
import { HttpError, NetworkError, QuotaExceededError, TimeoutError } from "./errors.js";
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
}

export interface RequestOptions {
  readonly headers?: Record<string, string>;
  /** Cached values younger than this are returned without a fetch. */
  readonly freshTtlSeconds?: number;
  /** Cached values older than this are never served on fetch failure. */
  readonly staleTtlSeconds?: number;
  readonly timeoutMs?: number;
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

export function createHttpClient(options: HttpClientOptions): HttpClient {
  const { source, budget, cache } = options;
  const fetchFn = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const fixtureMode = resolveFixtureMode(options.fixtures?.mode);
  const fixtureDir = options.fixtures?.dir ?? DEFAULT_FIXTURE_DIR;
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function doFetchOnce(
    url: string,
    headers: Record<string, string> | undefined,
    timeoutMs: number,
    body: string | undefined,
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
        throw new TimeoutError({ source, url, timeoutMs });
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function fetchWithRetry(
    url: string,
    headers: Record<string, string> | undefined,
    timeoutMs: number,
    body: string | undefined,
  ): Promise<RawResponse> {
    let attempt = 0;
    for (;;) {
      attempt++;
      let raw: RawResponse;
      try {
        raw = await doFetchOnce(url, headers, timeoutMs, body);
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
  ): Promise<RawResponse> {
    if (fixtureMode === "replay") {
      const fixture = await readFixture(fixtureDir, source, url, body);
      if (fixture.status >= 400) {
        throw new HttpError({ source, status: fixture.status, url, attempts: 1 });
      }
      return fixture;
    }

    const budgetResult = await budget.consume(source, 1);
    if (!budgetResult.allowed) {
      throw new QuotaExceededError({ source, resetsAt: budgetResult.resetsAt });
    }

    const response = await fetchWithRetry(url, headers, timeoutMs, body);

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
        const response = await performRequest(url, headers, timeoutMs, body);
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

    const response = await performRequest(url, headers, timeoutMs, body);
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
