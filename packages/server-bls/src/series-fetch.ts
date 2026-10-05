import {
  AgencyApiError,
  CACHE_MISS,
  QuotaExceededError,
  type CacheInfo,
  type HttpClient,
  type IndicatorFetch,
  type RequestOptions,
  type SeriesFetchOptions,
  type SeriesResult,
} from "@federal-mcps/core";
import { BLS_TIMESERIES_ENDPOINT } from "./describe-source.js";

/**
 * Fetch observations for any BLS program's series from the BLS Public Data API v2 through the
 * core HTTP client
 * (retry/backoff, timeout, budget counter, two-tier cache, fixtures — #5). No direct
 * `fetch` (CLAUDE.md). The registration key (ADR-006) rides in the POST body and is sent
 * only in production; fixtures are recorded unregistered, so no key ever enters a committed
 * fixture, and the cache key is computed from the body with the key stripped (`cacheBody`,
 * #325) so the fixture/cache identity is keyless regardless.
 */
export const BLS_SERIES_ENDPOINT = BLS_TIMESERIES_ENDPOINT;

/** BLS API limits: 50 series/query with a key (unregistered is lower). */
const MAX_SERIES_PER_REQUEST = 50;

/**
 * Cache TTL for a BLS timeseries response (#325, ADR-020 §8): BLS revises a published period
 * only on its own release schedule, never within a day, so a 24h fresh window is safe and keeps
 * routine repeat lookups off the upstream API and the per-source budget counter. Before this, no
 * TTL was set on a BLS timeseries POST, so the client's two-tier cache only ever served a stale
 * fallback when BLS was down (`docs/architecture.md` "HTTP discipline") — never a fresh hit.
 * Applied unconditionally: a caller-supplied `SeriesFetchOptions.freshTtlSeconds` still wins when
 * given, matching the other programs' pattern of a module-level default a caller can override.
 */
export const BLS_TIMESERIES_CACHE_TTL_SECONDS = 60 * 60 * 24;

/**
 * How long a cached BLS response may still be served as a stale fallback once it is past its
 * fresh window, when a fetch to refresh it fails (#325). Without an explicit `staleTtlSeconds`,
 * the core client's stale-on-failure path never actually triggers once the fresh window has
 * elapsed (its default stale limit equals the fresh TTL itself, so the two windows never
 * overlap) — a week gives a real fallback window for a BLS outage, consistent with
 * `docs/architecture.md` "HTTP discipline"'s "stale fallback when the agency is down".
 */
export const BLS_TIMESERIES_STALE_TTL_SECONDS = 60 * 60 * 24 * 7;

/**
 * The agency-error code `blsDailyThresholdBodyError` reports via the `bodyError` hook (#325).
 * BLS's own server-side daily limit on a registration key is a different cap from this family's
 * own per-source budget counter (`MemoryBudgetStore` in `index.ts`): BLS enforces its own across
 * every caller of that key (any container, any process), and signals a refusal inside an HTTP 200
 * body rather than a 4xx/429 status.
 */
export const BLS_DAILY_THRESHOLD_CODE = "bls-daily-threshold";

/**
 * Case-insensitive match on "daily threshold", the phrase in BLS's documented refusal wording:
 * "Request could not be serviced, as the daily threshold for total number of requests allocated
 * to the user with registration key ... has been reached." (BLS API v2 user reports; no live
 * refusal has been recorded into a fixture here — `fixtures/bls/` has a synthesized one, see
 * `series-fetch.test.ts`). Matching on the phrase rather than the whole sentence tolerates minor
 * wording differences across BLS API versions.
 */
const DAILY_THRESHOLD_RE = /daily threshold/i;

function isDailyThresholdRefusal(res: { status?: unknown; message?: unknown }): boolean {
  if (res.status !== "REQUEST_NOT_PROCESSED") return false;
  const messages = Array.isArray(res.message) ? res.message : [];
  return messages.some((m) => typeof m === "string" && DAILY_THRESHOLD_RE.test(m));
}

/**
 * `HttpClientOptions.bodyError` hook (ADR-019 §4) for the BLS client: inspects the raw response
 * body *before* it is parsed and cached, so a daily-threshold refusal never rides into the 24h
 * cache as if it were a real answer (#325 — "never cache the refusal"). The hook's contract always
 * throws `AgencyApiError`; `fetchSeriesBatches` below recognizes this specific code and converts
 * it to `QuotaExceededError` for the caller. Any other non-success BLS `status` (a bad series id,
 * a malformed query, …) is left alone here — undefined — and handled by the normal
 * `REQUEST_SUCCEEDED` check once the body is parsed, same as before this issue.
 */
export function blsDailyThresholdBodyError(
  body: string,
): { code: string; message: string; retryable: boolean } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  const res = parsed as { status?: unknown; message?: unknown };
  if (!isDailyThresholdRefusal(res)) return undefined;
  const messages = Array.isArray(res.message) ? res.message : [];
  return {
    code: BLS_DAILY_THRESHOLD_CODE,
    message: messages.filter((m): m is string => typeof m === "string").join("; "),
    retryable: false,
  };
}

/**
 * BLS resets its daily registration-key threshold "at midnight"; BLS's documentation does not say
 * on which clock. We assume UTC, matching the shared core budget store's own daily-reset clock
 * (`packages/core/src/http/budget.ts`'s `nextUtcMidnight`) — a consistency choice across the
 * family's two independent daily caps (BLS's own vs. this family's per-source budget counter),
 * not a verified claim about BLS's internal reset time (#325).
 */
function nextUtcMidnightIso(date: Date): string {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1, 0, 0, 0, 0),
  ).toISOString();
}

function throwQuotaExceeded(): never {
  throw new QuotaExceededError({ source: "bls", resetsAt: nextUtcMidnightIso(new Date()) });
}

export type { SeriesFetchOptions, SeriesObservation, SeriesResult } from "@federal-mcps/core";

/** The raw BLS v2 response shape, trimmed to what we read. */
interface BlsApiResponse {
  status: string;
  message?: string[];
  Results?: {
    series?: {
      seriesID: string;
      data?: {
        year: string;
        period: string;
        periodName: string;
        value: string;
        footnotes?: { code?: string; text?: string }[];
      }[];
    }[];
  };
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function parseSeries(res: BlsApiResponse): SeriesResult[] {
  if (res.status !== "REQUEST_SUCCEEDED") {
    const detail = res.message?.join("; ") || res.status;
    throw new Error(`BLS API did not succeed: ${detail}`);
  }
  return (res.Results?.series ?? []).map((s) => ({
    seriesId: s.seriesID,
    observations: (s.data ?? []).map((d) => ({
      year: d.year,
      period: d.period,
      periodName: d.periodName,
      value: d.value === "" || d.value === "-" ? null : Number.parseFloat(d.value),
      footnotes: (d.footnotes ?? [])
        .filter((f) => f.code)
        .map((f) => ({ code: f.code as string, text: f.text ?? "" })),
    })),
  }));
}

/** hit = every batch hit; stale = any batch stale; ageSeconds = the oldest of them. */
function mergeCache(entries: readonly CacheInfo[]): CacheInfo {
  if (entries.length === 0) return CACHE_MISS;
  const ages = entries.map((c) => c.ageSeconds).filter((a): a is number => a !== undefined);
  const stale = entries.some((c) => c.stale === true);
  return {
    hit: entries.every((c) => c.hit),
    ...(ages.length > 0 ? { ageSeconds: Math.max(...ages) } : {}),
    ...(stale ? { stale: true } : {}),
  };
}

/**
 * Fetch observations for one or more BLS series ids (any program), batching into ≤50-series
 * requests. Returns one result per series id (in request order across batches).
 */
/** POST each ≤50-series batch and return the raw BLS responses (one per batch) plus the merged
 *  cache info (#325). Shared by the parsed fetch and `fetchSeriesRaw`. Keyless body unless a
 *  production key is supplied; the key never affects the cache/fixture identity (`cacheBody`). A
 *  daily-threshold refusal — caught either by the `bodyError` hook (production, before anything
 *  is cached) or by inspecting the parsed value directly (fixture replay, where `bodyError` is
 *  never invoked) — always surfaces as `QuotaExceededError`, never the generic parse error below. */
async function fetchSeriesBatches(
  client: HttpClient,
  seriesIds: readonly string[],
  options: SeriesFetchOptions,
): Promise<{ responses: BlsApiResponse[]; cache: CacheInfo }> {
  const responses: BlsApiResponse[] = [];
  const caches: CacheInfo[] = [];
  for (const batch of chunk(seriesIds, MAX_SERIES_PER_REQUEST)) {
    const bodyFields = {
      seriesid: batch,
      ...(options.startYear === undefined ? {} : { startyear: String(options.startYear) }),
      ...(options.endYear === undefined ? {} : { endyear: String(options.endYear) }),
    };
    const wireBody = {
      ...bodyFields,
      ...(options.apiKey ? { registrationkey: options.apiKey } : {}),
    };
    const reqOptions: RequestOptions = {
      freshTtlSeconds: options.freshTtlSeconds ?? BLS_TIMESERIES_CACHE_TTL_SECONDS,
      staleTtlSeconds: BLS_TIMESERIES_STALE_TTL_SECONDS,
      // The registration key never affects cache/fixture identity (#325): hash the body
      // without it, so two calls that differ only by key hit the same cache entry.
      cacheBody: JSON.stringify(bodyFields),
    };

    let result: { value: BlsApiResponse; cache: CacheInfo };
    try {
      result = await client.postJson<BlsApiResponse>(BLS_SERIES_ENDPOINT, wireBody, reqOptions);
    } catch (err) {
      if (err instanceof AgencyApiError && err.code === BLS_DAILY_THRESHOLD_CODE) {
        throwQuotaExceeded();
      }
      throw err;
    }

    // Fixture replay never runs the `bodyError` hook (it returns the recorded response
    // directly), so a replayed refusal is caught here instead — same outcome either way.
    if (isDailyThresholdRefusal(result.value)) {
      throwQuotaExceeded();
    }

    responses.push(result.value);
    caches.push(result.cache);
  }
  return { responses, cache: mergeCache(caches) };
}

export async function fetchSeriesObservations(
  client: HttpClient,
  seriesIds: readonly string[],
  options: SeriesFetchOptions = {},
): Promise<SeriesResult[]> {
  const { responses } = await fetchSeriesBatches(client, seriesIds, options);
  const results: SeriesResult[] = [];
  for (const response of responses) {
    results.push(...parseSeries(response));
  }
  return results;
}

/**
 * `fetchSeriesObservations`, plus the merged cache info across every batch (#325) — so a handler
 * can surface `hit`/`ageSeconds` to the provenance envelope the way QCEW and Census do for their
 * own fetches.
 */
export async function fetchSeriesObservationsWithCache(
  client: HttpClient,
  seriesIds: readonly string[],
  options: SeriesFetchOptions = {},
): Promise<{ results: SeriesResult[]; cache: CacheInfo }> {
  const { responses, cache } = await fetchSeriesBatches(client, seriesIds, options);
  const results: SeriesResult[] = [];
  for (const response of responses) {
    results.push(...parseSeries(response));
  }
  return { results, cache };
}

/**
 * Fetch the *unprocessed* BLS response for the given series ids, any program (the `bls_get_raw`
 * escape hatch). Returns one raw response object per ≤50-series batch, for transparency/debugging.
 */
export async function fetchSeriesRaw(
  client: HttpClient,
  seriesIds: readonly string[],
  options: SeriesFetchOptions = {},
): Promise<unknown[]> {
  const { responses } = await fetchSeriesBatches(client, seriesIds, options);
  return responses;
}

/** `fetchSeriesRaw`, plus the merged cache info across every batch (#325). */
export async function fetchSeriesRawWithCache(
  client: HttpClient,
  seriesIds: readonly string[],
  options: SeriesFetchOptions = {},
): Promise<{ responses: unknown[]; cache: CacheInfo }> {
  return fetchSeriesBatches(client, seriesIds, options);
}

/**
 * How an indicator fetches observations for its series keys (ADR-011 §2). This is the seam that
 * lets a non-timeseries program — QCEW's CSV area slices (#124) — plug into `bls_get_indicator`
 * and `bls_compare_places` alongside the timeseries default, without either tool knowing which.
 * A "series id" here is just the program's opaque key; the timeseries default treats it as a real
 * BLS series id, a CSV program would treat it as an area code.
 */
export type { IndicatorFetch };

/** The default capability: the five timeseries programs fetch through the BLS Public Data API. */
export const timeseriesFetch: IndicatorFetch = (client, seriesIds, options) =>
  fetchSeriesObservations(client, seriesIds, options);
