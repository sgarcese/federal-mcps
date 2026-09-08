import { describe, expect, it } from "vitest";
import {
  HttpClientError,
  HttpError,
  MissingFixtureError,
  NetworkError,
  QuotaExceededError,
  TimeoutError,
} from "./errors.js";

describe("HttpClientError family", () => {
  it("HttpError names the source, status and url without a stack trace in the message", () => {
    const err = new HttpError({
      source: "bls",
      status: 503,
      url: "https://api.bls.gov/x",
      attempts: 3,
    });
    expect(err).toBeInstanceOf(HttpClientError);
    expect(err.source).toBe("bls");
    expect(err.status).toBe(503);
    expect(err.url).toBe("https://api.bls.gov/x");
    expect(err.attempts).toBe(3);
    expect(err.message).toContain("bls");
    expect(err.message).toContain("https://api.bls.gov/x");
    expect(err.message).not.toContain("\n    at ");
  });

  it("TimeoutError carries source, url and timeoutMs", () => {
    const err = new TimeoutError({ source: "bls", url: "https://api.bls.gov/x", timeoutMs: 15000 });
    expect(err).toBeInstanceOf(HttpClientError);
    expect(err.timeoutMs).toBe(15000);
    expect(err.message).toContain("bls");
    expect(err.message).toContain("https://api.bls.gov/x");
  });

  it("QuotaExceededError names the source and when the quota resets", () => {
    const err = new QuotaExceededError({ source: "bls", resetsAt: "2026-09-09T00:00:00.000Z" });
    expect(err).toBeInstanceOf(HttpClientError);
    expect(err.resetsAt).toBe("2026-09-09T00:00:00.000Z");
    expect(err.message).toContain("bls");
    expect(err.message).toContain("2026-09-09T00:00:00.000Z");
  });

  it("MissingFixtureError names the exact missing fixture path", () => {
    const err = new MissingFixtureError({
      source: "bls",
      url: "https://api.bls.gov/x",
      path: "fixtures/bls/deadbeef.json",
    });
    expect(err).toBeInstanceOf(HttpClientError);
    expect(err.path).toBe("fixtures/bls/deadbeef.json");
    expect(err.message).toContain("fixtures/bls/deadbeef.json");
  });

  it("NetworkError carries the causing error", () => {
    const cause = new Error("ECONNRESET");
    const err = new NetworkError({ source: "bls", url: "https://api.bls.gov/x", cause });
    expect(err).toBeInstanceOf(HttpClientError);
    expect(err.cause).toBe(cause);
    expect(err.message).toContain("bls");
  });
});
