/**
 * Retry and backoff policy shared by the HTTP client (issue #5).
 *
 * Base 500ms, factor 2, full jitter, max 3 attempts total. 502/503/504 and
 * 429 are retried; 4xx other than 429 is never retried.
 */
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 502, 503, 504]);

export interface BackoffOptions {
  readonly baseMs: number;
  readonly factor: number;
  readonly maxAttempts: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = { baseMs: 500, factor: 2, maxAttempts: 3 };

export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUSES.has(status);
}

/**
 * Full-jitter delay before the attempt after `attempt` (1-based): a random
 * value in `[0, baseMs * factor^(attempt-1))`. `random` is injectable for
 * deterministic tests.
 */
export function computeDelayMs(
  attempt: number,
  options: BackoffOptions,
  random: () => number = Math.random,
): number {
  const cap = options.baseMs * options.factor ** (attempt - 1);
  return Math.floor(random() * cap);
}

/**
 * Parses a `Retry-After` header value, which is either a whole number of
 * seconds or an HTTP-date. Returns milliseconds to wait from `now()`, or
 * `undefined` when the header is absent or unparseable.
 */
export function parseRetryAfter(value: string | null, now: () => Date): number | undefined {
  if (!value) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return seconds * 1000;
  }
  const dateMs = Date.parse(value);
  if (Number.isNaN(dateMs)) {
    return undefined;
  }
  return Math.max(0, dateMs - now().getTime());
}
