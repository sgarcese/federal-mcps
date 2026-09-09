import { createHash } from "node:crypto";

/**
 * Two-tier response cache store (issue #5). In-memory only in M1; the M3
 * DynamoDB store implements the same `CacheStore` interface.
 */
export interface CacheEntry {
  readonly value: unknown;
  readonly status: number;
  /** Epoch milliseconds the entry was stored, per the client's injected `now`. */
  readonly storedAt: number;
}

export interface CacheStore {
  get(key: string): Promise<CacheEntry | undefined>;
  set(key: string, entry: CacheEntry): Promise<void>;
}

export class MemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, CacheEntry>();

  async get(key: string): Promise<CacheEntry | undefined> {
    return this.entries.get(key);
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    this.entries.set(key, entry);
  }
}

/**
 * Cache key = sha256 of the method, URL and sorted content-relevant headers.
 * Header order never affects the key.
 */
export function cacheKey(
  method: string,
  url: string,
  headers: Record<string, string> = {},
  body?: string,
): string {
  const sortedHeaders = Object.keys(headers)
    .sort()
    .map((name) => `${name.toLowerCase()}:${headers[name] ?? ""}`)
    .join("\n");
  // The request body distinguishes POST queries that share a URL (e.g. two BLS timeseries
  // requests with different series lists). Absent for GET, so GET keys are unchanged.
  const bodyPart = body === undefined ? "" : `\n${body}`;
  return createHash("sha256")
    .update(`${method.toUpperCase()}\n${url}\n${sortedHeaders}${bodyPart}`)
    .digest("hex");
}
