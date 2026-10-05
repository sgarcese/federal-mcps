/**
 * Typed errors thrown by the shared HTTP client (issue #5).
 *
 * Every error carries `source` (the agency key, e.g. "bls") and a message that
 * names the source and, where relevant, the URL involved — never a stack
 * trace. Callers can `instanceof HttpClientError` to catch the whole family,
 * or narrow to a specific subtype.
 */
export abstract class HttpClientError extends Error {
  readonly source: string;

  protected constructor(message: string, source: string) {
    super(message);
    this.source = source;
    this.name = new.target.name;
  }
}

/** A request that ultimately failed with a non-2xx status (after any retries). */
export class HttpError extends HttpClientError {
  readonly status: number;
  readonly url: string;
  readonly attempts: number;

  constructor(params: { source: string; status: number; url: string; attempts: number }) {
    super(
      `${params.source}: request to ${params.url} failed with HTTP ${params.status} after ${params.attempts} attempt(s)`,
      params.source,
    );
    this.status = params.status;
    this.url = params.url;
    this.attempts = params.attempts;
  }
}

/** A request that never completed within its timeout budget. */
export class TimeoutError extends HttpClientError {
  readonly url: string;
  readonly timeoutMs: number;

  constructor(params: { source: string; url: string; timeoutMs: number }) {
    super(
      `${params.source}: request to ${params.url} timed out after ${params.timeoutMs}ms`,
      params.source,
    );
    this.url = params.url;
    this.timeoutMs = params.timeoutMs;
  }
}

/** The per-source daily budget is exhausted; `fetch` was never invoked. */
export class QuotaExceededError extends HttpClientError {
  readonly resetsAt: string;
  /** The daily budget, when known (core's budget store knows it; an agency's own refusal does not). */
  readonly limit?: number;
  /** Queries counted today, when known. */
  readonly used?: number;

  constructor(params: { source: string; resetsAt: string; limit?: number; used?: number }) {
    super(`${params.source}: daily quota exceeded, resets at ${params.resetsAt}`, params.source);
    this.resetsAt = params.resetsAt;
    if (params.limit !== undefined) this.limit = params.limit;
    if (params.used !== undefined) this.used = params.used;
  }
}

/** Fixture replay found no recorded fixture for this request. */
export class MissingFixtureError extends HttpClientError {
  readonly url: string;
  readonly path: string;

  constructor(params: { source: string; url: string; path: string }) {
    super(
      `${params.source}: no recorded fixture for ${params.url} at ${params.path}`,
      params.source,
    );
    this.url = params.url;
    this.path = params.path;
  }
}

/** A request failed at the network layer (not an HTTP status) after any retries. */
export class NetworkError extends HttpClientError {
  readonly url: string;

  constructor(params: { source: string; url: string; cause: unknown }) {
    super(`${params.source}: network error requesting ${params.url}`, params.source);
    this.url = params.url;
    this.cause = params.cause;
  }
}

/**
 * The per-client rate limiter (`HttpClientOptions.perMinute`, ADR-018 §5) had no token
 * available and waiting for a refill would exceed `maxWaitMs`. `fetch` was never invoked.
 */
export class RateLimitWaitError extends HttpClientError {
  readonly perMinute: number;
  readonly waitMs: number;
  readonly maxWaitMs: number;

  constructor(params: { source: string; perMinute: number; waitMs: number; maxWaitMs: number }) {
    super(
      `${params.source}: rate limit of ${params.perMinute}/min would require waiting ` +
        `${params.waitMs}ms, exceeding maxWaitMs ${params.maxWaitMs}ms`,
      params.source,
    );
    this.perMinute = params.perMinute;
    this.waitMs = params.waitMs;
    this.maxWaitMs = params.maxWaitMs;
  }
}

/**
 * The per-client upstream error budget (`HttpClientOptions.errorsPerMinute`, #324, ADR-020 §2)
 * had no room left for another failure this minute. BEA allows 30 errors/minute and may block
 * the key past that, so the client refuses the call itself, without ever reaching BEA.
 */
export class UpstreamErrorLimitError extends HttpClientError {
  readonly errorsPerMinute: number;
  readonly resetsAt: string;

  constructor(params: { source: string; errorsPerMinute: number; resetsAt: string }) {
    super(
      `${params.source}: upstream error limit of ${params.errorsPerMinute}/min reached; ` +
        `refusing further calls until ${params.resetsAt}`,
      params.source,
    );
    this.errorsPerMinute = params.errorsPerMinute;
    this.resetsAt = params.resetsAt;
  }
}

/**
 * An agency reported an error inside a successful HTTP response (#256, ADR-019 §4): BEA answers a
 * bad parameter with HTTP 200 and `APIErrorCode` in the body. Carries the agency's own code and
 * text; never the request's credentials (the body is sanitized before it is read).
 */
export class AgencyApiError extends HttpClientError {
  readonly code: string;
  readonly url: string;
  readonly attempts: number;

  constructor(params: {
    source: string;
    code: string;
    message: string;
    url: string;
    attempts: number;
  }) {
    super(
      `${params.source}: ${params.url} answered with agency error ${params.code}: ${params.message} (after ${params.attempts} attempt(s))`,
      params.source,
    );
    this.code = params.code;
    this.url = params.url;
    this.attempts = params.attempts;
  }
}
