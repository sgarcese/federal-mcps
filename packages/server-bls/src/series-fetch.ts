import { BLS_TIMESERIES_ENDPOINT } from "./describe-source.js";

/**
 * Fetch observations for any BLS program's series from the BLS Public Data API v2 through the
 * core HTTP client
 * (retry/backoff, timeout, budget counter, two-tier cache, fixtures — #5). No direct
 * `fetch` (CLAUDE.md). The registration key (ADR-006) rides in the POST body and is sent
 * only in production; fixtures are recorded unregistered, so no key ever enters a committed
 * fixture and the cache/fixture identity is keyless.
 */
export const BLS_SERIES_ENDPOINT = BLS_TIMESERIES_ENDPOINT;

/** BLS API limits: 50 series/query with a key (unregistered is lower). */
const MAX_SERIES_PER_REQUEST = 50;

export type { SeriesFetchOptions, SeriesObservation, SeriesResult } from "@federal-mcps/core";
import type {
  HttpClient,
  IndicatorFetch,
  RequestOptions,
  SeriesFetchOptions,
  SeriesResult,
} from "@federal-mcps/core";

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

/**
 * Fetch observations for one or more BLS series ids (any program), batching into ≤50-series
 * requests. Returns one result per series id (in request order across batches).
 */
/** POST each ≤50-series batch and return the raw BLS responses (one per batch). Shared by the
 *  parsed fetch and `fetchSeriesRaw`. Keyless body unless a production key is supplied. */
async function fetchSeriesBatches(
  client: HttpClient,
  seriesIds: readonly string[],
  options: SeriesFetchOptions,
): Promise<BlsApiResponse[]> {
  const responses: BlsApiResponse[] = [];
  for (const batch of chunk(seriesIds, MAX_SERIES_PER_REQUEST)) {
    const body = {
      seriesid: batch,
      ...(options.startYear === undefined ? {} : { startyear: String(options.startYear) }),
      ...(options.endYear === undefined ? {} : { endyear: String(options.endYear) }),
      ...(options.apiKey ? { registrationkey: options.apiKey } : {}),
    };
    const reqOptions: RequestOptions =
      options.freshTtlSeconds === undefined ? {} : { freshTtlSeconds: options.freshTtlSeconds };
    const { value } = await client.postJson<BlsApiResponse>(BLS_SERIES_ENDPOINT, body, reqOptions);
    responses.push(value);
  }
  return responses;
}

export async function fetchSeriesObservations(
  client: HttpClient,
  seriesIds: readonly string[],
  options: SeriesFetchOptions = {},
): Promise<SeriesResult[]> {
  const results: SeriesResult[] = [];
  for (const response of await fetchSeriesBatches(client, seriesIds, options)) {
    results.push(...parseSeries(response));
  }
  return results;
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
  return fetchSeriesBatches(client, seriesIds, options);
}

/**
 * How an indicator fetches observations for its series keys (ADR-011 §2). This is the seam that
 * lets a non-timeseries program — QCEW's CSV area slices (#124) — plug into `bls_get_indicator`
 * and `bls_compare_places` alongside the timeseries default, without either tool knowing which.
 * A "series id" here is just the program's opaque key; the timeseries default treats it as a real
 * BLS series id, a CSV program would treat it as an area code.
 */
export type { IndicatorFetch } from "@federal-mcps/core";

/** The default capability: the five timeseries programs fetch through the BLS Public Data API. */
export const timeseriesFetch: IndicatorFetch = (client, seriesIds, options) =>
  fetchSeriesObservations(client, seriesIds, options);
