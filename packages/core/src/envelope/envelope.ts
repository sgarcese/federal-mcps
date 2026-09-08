import { CACHE_MISS, type CacheInfo } from "../cache.js";
import type { Footnote, PlaceRef, Source } from "./types.js";

/** The provenance envelope every family tool returns (docs/architecture.md "The shared core"). */
export interface Envelope<T> {
  data: T;
  place?: PlaceRef;
  source: Source;
  /** ISO 8601 timestamp of when `data` was fetched (or served from cache). */
  retrievedAt: string;
  /** The data vintage, e.g. a release year or "2024Q3" — distinct from `retrievedAt`. */
  vintage?: string;
  footnotes: Footnote[];
  limitations: string[];
  cache: CacheInfo;
}

export interface EnvelopeInput<T> {
  data: T;
  place?: PlaceRef;
  source: Source;
  vintage?: string;
  footnotes?: Footnote[];
  limitations?: string[];
  cache?: CacheInfo;
  /** Clock override for tests; defaults to `new Date()`. */
  now?: Date;
}

/**
 * Builds an `Envelope<T>`. Defaults `footnotes`/`limitations` to `[]` and
 * `cache` to `CACHE_MISS`, and never drops footnotes or limitations that were
 * passed in.
 */
export function envelope<T>(input: EnvelopeInput<T>): Envelope<T> {
  const { data, place, source, vintage, footnotes, limitations, cache, now } = input;
  const result: Envelope<T> = {
    data,
    source,
    retrievedAt: (now ?? new Date()).toISOString(),
    footnotes: footnotes ?? [],
    limitations: limitations ?? [],
    cache: cache ?? CACHE_MISS,
  };
  if (place !== undefined) {
    result.place = place;
  }
  if (vintage !== undefined) {
    result.vintage = vintage;
  }
  return result;
}
