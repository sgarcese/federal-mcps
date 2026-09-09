import { describe, expect, it } from "vitest";
import {
  HttpError,
  MissingFixtureError,
  NetworkError,
  QuotaExceededError,
  TimeoutError,
} from "../http/index.js";
import { toToolError } from "./errors.js";

const context = { agency: "bls", toolName: "bls_get_unemployment" };

function textOf(result: ReturnType<typeof toToolError>): string {
  const [block] = result.content;
  return block.text;
}

describe("toToolError", () => {
  it("marks the result as an error with a single text block", () => {
    const result = toToolError(new Error("boom"), context);
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
  });

  it("names the agency, what failed and the failing URL", () => {
    const error = new HttpError({
      source: "bls",
      status: 503,
      url: "https://api.bls.gov/publicAPI/v2/timeseries/data/",
      attempts: 3,
    });
    const text = textOf(toToolError(error, context));
    expect(text).toBe(
      "bls: request failed with HTTP 503 after 3 attempt(s) " +
        "(https://api.bls.gov/publicAPI/v2/timeseries/data/)",
    );
  });

  it("tells the caller when the quota budget resets", () => {
    const error = new QuotaExceededError({ source: "bls", resetsAt: "2026-09-09T00:00:00.000Z" });
    const text = textOf(toToolError(error, context));
    expect(text).toContain("quota");
    expect(text).toContain("2026-09-09T00:00:00.000Z");
    expect(text).toContain("bls_get_unemployment");
  });

  it("reports timeouts, network failures and missing fixtures against their URL", () => {
    expect(
      textOf(toToolError(new TimeoutError({ source: "bls", url: "https://x/y", timeoutMs: 5000 }), context)),
    ).toBe("bls: request timed out after 5000ms (https://x/y)");
    expect(
      textOf(toToolError(new NetworkError({ source: "bls", url: "https://x/y", cause: new Error("ECONNRESET") }), context)),
    ).toBe("bls: network error reaching the agency (https://x/y)");
    expect(
      textOf(toToolError(new MissingFixtureError({ source: "bls", url: "https://x/y", path: "f.json" }), context)),
    ).toBe("bls: no recorded fixture for this request (https://x/y)");
  });

  it("falls back to the tool name for plain errors and non-errors", () => {
    expect(textOf(toToolError(new Error("series LAUCN08 is unknown"), context))).toBe(
      "bls: series LAUCN08 is unknown (bls_get_unemployment)",
    );
    expect(textOf(toToolError("nope", context))).toBe(
      "bls: the tool call failed (bls_get_unemployment)",
    );
  });

  it("never leaks a stack trace, and keeps the message to a single line", () => {
    const error = new Error("first line\n    at somewhere/in/the/code.ts:1:1\nsecond line");
    const text = textOf(toToolError(error, context));
    expect(text).toBe("bls: first line (bls_get_unemployment)");
    expect(text).not.toContain("\n");
    expect(error.stack).toBeDefined();
    expect(text).not.toContain("errors.test.ts");
  });
});
