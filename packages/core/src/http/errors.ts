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

  constructor(params: { source: string; resetsAt: string }) {
    super(`${params.source}: daily quota exceeded, resets at ${params.resetsAt}`, params.source);
    this.resetsAt = params.resetsAt;
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
