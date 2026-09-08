import { describe, expect, it } from "vitest";
import { DEFAULT_BACKOFF, computeDelayMs, isRetryableStatus, parseRetryAfter } from "./retry.js";

describe("isRetryableStatus", () => {
  it("retries 502, 503, 504 and 429", () => {
    for (const status of [502, 503, 504, 429]) {
      expect(isRetryableStatus(status)).toBe(true);
    }
  });

  it("does not retry 400, 401, 403, 404 or a 2xx", () => {
    for (const status of [400, 401, 403, 404, 200]) {
      expect(isRetryableStatus(status)).toBe(false);
    }
  });
});

describe("computeDelayMs", () => {
  it("applies full jitter within [0, base * factor^(attempt-1)]", () => {
    const options = DEFAULT_BACKOFF;
    expect(computeDelayMs(1, options, () => 0)).toBe(0);
    expect(computeDelayMs(1, options, () => 0.999999)).toBeLessThan(500);
    expect(computeDelayMs(2, options, () => 0.999999)).toBeLessThan(1000);
    expect(computeDelayMs(2, options, () => 0.999999)).toBeGreaterThanOrEqual(500);
    expect(computeDelayMs(3, options, () => 0.999999)).toBeLessThan(2000);
  });
});

describe("parseRetryAfter", () => {
  const now = () => new Date("2026-09-08T12:00:00.000Z");

  it("parses a Retry-After given in seconds", () => {
    expect(parseRetryAfter("2", now)).toBe(2000);
  });

  it("parses a Retry-After given as an HTTP date, relative to now", () => {
    expect(parseRetryAfter("Tue, 08 Sep 2026 12:00:05 GMT", now)).toBe(5000);
  });

  it("returns undefined when absent or unparseable", () => {
    expect(parseRetryAfter(null, now)).toBeUndefined();
    expect(parseRetryAfter("not-a-value-at-all", now)).toBeUndefined();
  });
});
