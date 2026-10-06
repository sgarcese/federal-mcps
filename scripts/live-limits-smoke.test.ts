import { describe, expect, it } from "vitest";
import {
  cacheBustingYear,
  extractNetworkToolCallsDaily,
  extractServiceUsed,
  hasLimitsBlock,
  isNetworkToolCallsRefusal,
  parseRefusal,
  TEST_LIMIT,
  testRunId,
} from "./live-limits-smoke.mjs";

/**
 * Unit tests for the pure parts of live-limits-smoke.mjs (#327): refusal recognition and
 * `describe_source` limits-block parsing, against recorded envelope shapes (the same shapes
 * `create-server.refusal.test.ts` exercises in packages/core). The script's network calls are
 * exercised only by a human running it live (LIVE_TESTS=1 --yes), per CLAUDE.md.
 */

const RESET = "2026-10-06T00:00:00.000Z";

describe("hasLimitsBlock", () => {
  it("is true when describe_source's data carries a limits object", () => {
    expect(
      hasLimitsBlock({
        agency: "bls",
        limits: {
          network: { upstreamDaily: 100, toolCallsDaily: 500 },
          pool: { upstreamDaily: 250, toolCallsDaily: 5000 },
          service: { bls: { daily: 490, used: 40, remaining: 450, resetsAt: RESET } },
        },
      }),
    ).toBe(true);
  });

  it("is false when there is no limits block (unconfigured server)", () => {
    expect(hasLimitsBlock({ agency: "bls", agencyName: "BLS", programs: [] })).toBe(false);
  });

  it("is false for null or non-object data", () => {
    expect(hasLimitsBlock(null)).toBe(false);
    expect(hasLimitsBlock(undefined)).toBe(false);
  });
});

describe("extractServiceUsed", () => {
  it("reads a service budget's used count", () => {
    const data = { limits: { service: { bls: { daily: 490, used: 40, resetsAt: RESET } } } };
    expect(extractServiceUsed(data, "bls")).toBe(40);
  });

  it("is undefined when the source has no service budget configured", () => {
    const data = { limits: { network: { toolCallsDaily: 500 } } };
    expect(extractServiceUsed(data, "bls")).toBeUndefined();
  });
});

describe("extractNetworkToolCallsDaily", () => {
  it("reads the configured per-network tool-call share", () => {
    expect(extractNetworkToolCallsDaily({ limits: { network: { toolCallsDaily: 1000 } } })).toBe(
      1000,
    );
  });

  it("is undefined without a configured network share", () => {
    expect(extractNetworkToolCallsDaily({ limits: {} })).toBeUndefined();
    expect(extractNetworkToolCallsDaily({})).toBeUndefined();
  });
});

describe("parseRefusal", () => {
  it("parses the sentence and limit block off an isError refusal", () => {
    const result = {
      isError: true,
      content: [
        {
          type: "text",
          text: `geo: this network has used its 1000 tool calls for today; resets at ${RESET}.`,
        },
      ],
      structuredContent: {
        data: null,
        limit: { scope: "network", kind: "toolCalls", limit: 1000, used: 1000, resetsAt: RESET },
      },
    };
    expect(parseRefusal(result)).toEqual({
      sentence: result.content[0].text,
      limit: result.structuredContent.limit,
    });
  });

  it("is undefined for a successful (non-isError) result", () => {
    expect(
      parseRefusal({ isError: false, content: [], structuredContent: { data: {} } }),
    ).toBeUndefined();
    expect(parseRefusal({ content: [] })).toBeUndefined();
  });

  it("is undefined for a non-limit tool error (no structuredContent)", () => {
    const result = { isError: true, content: [{ type: "text", text: "geo: not found" }] };
    expect(parseRefusal(result)).toEqual({ sentence: "geo: not found", limit: undefined });
  });
});

describe("isNetworkToolCallsRefusal", () => {
  it("is true for a network/toolCalls limit block", () => {
    expect(
      isNetworkToolCallsRefusal({
        sentence: "x",
        limit: { scope: "network", kind: "toolCalls", limit: 1000, used: 1000, resetsAt: RESET },
      }),
    ).toBe(true);
  });

  it("is false for the claude.ai pool scope", () => {
    expect(
      isNetworkToolCallsRefusal({
        sentence: "x",
        limit: { scope: "pool", kind: "toolCalls", limit: 5000, used: 5000, resetsAt: RESET },
      }),
    ).toBe(false);
  });

  it("is false for an upstream-query refusal (wrong kind)", () => {
    expect(
      isNetworkToolCallsRefusal({
        sentence: "x",
        limit: {
          scope: "network",
          kind: "upstream",
          source: "bls",
          limit: 100,
          used: 100,
          resetsAt: RESET,
        },
      }),
    ).toBe(false);
  });

  it("is false for no refusal at all", () => {
    expect(isNetworkToolCallsRefusal(undefined)).toBe(false);
  });
});

describe("cacheBustingYear", () => {
  it("returns a 4-digit year string within the rotating window", () => {
    const year = Number.parseInt(cacheBustingYear(new Date("2026-10-05T00:00:00.000Z")), 10);
    expect(year).toBeGreaterThanOrEqual(2015);
    expect(year).toBeLessThan(2025);
  });

  it("rotates across days (not the same value every day)", () => {
    const day0 = new Date("2026-01-01T00:00:00.000Z");
    const values = new Set(
      Array.from({ length: 10 }, (_, i) =>
        cacheBustingYear(new Date(day0.getTime() + i * 86_400_000)),
      ),
    );
    expect(values.size).toBeGreaterThan(1);
  });
});

describe("the isolated test counter's run id (#347)", () => {
  it("always matches the server's accepted shape, so the header is never silently ignored", () => {
    // identify.ts accepts `<1–10>:<8–64 of [A-Za-z0-9-]>`; a mismatch would fall back to a bypass.
    for (let i = 0; i < 50; i += 1) {
      expect(`${TEST_LIMIT}:${testRunId()}`).toMatch(/^([1-9]|10):[A-Za-z0-9-]{8,64}$/);
    }
  });

  it("differs per run, so each run starts a fresh counter", () => {
    expect(testRunId()).not.toBe(testRunId());
  });
});
