import { describe, expect, it } from "vitest";
import { EnvelopeSchema } from "../envelope/index.js";
import { QuotaExceededError } from "../http/index.js";
import { type LimitInfo, LimitExceededError } from "../limits/limiter.js";
import { toToolError } from "./errors.js";

/**
 * The refusal shape (ADR-020 §4, #323): a refusal is an `isError` result whose text is one plain
 * sentence and whose `structuredContent` is an envelope with `data: null` and a `limit` block.
 */
const RESET = "2026-10-06T00:00:00.000Z";
const context = {
  agency: "bls",
  toolName: "bls_get_indicator",
  homepage: "https://www.bls.gov",
  tools: ["bls_resolve_place", "bls_list_indicators", "bls_get_indicator", "bls_describe_source"],
  now: new Date("2026-10-05T12:00:00.000Z"),
};
const STILL_WORK =
  " Tools that need no new query (bls_resolve_place, bls_list_indicators, bls_describe_source) still work.";

function refuse(info: LimitInfo) {
  return toToolError(new LimitExceededError(info), context);
}

describe("toToolError: refusals", () => {
  it("names this network's share of upstream queries, the number, the reset and the tools that still work", () => {
    const result = refuse({
      scope: "network",
      kind: "upstream",
      source: "bls",
      limit: 100,
      used: 100,
      resetsAt: RESET,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      `bls: this network has used its 100 BLS queries for today; resets at ${RESET}.${STILL_WORK}`,
    );
  });

  it("names the claude.ai pool's shared tool calls, with no still-works sentence", () => {
    const result = refuse({
      scope: "pool",
      kind: "toolCalls",
      limit: 2000,
      used: 2000,
      resetsAt: RESET,
    });
    expect(result.content[0].text).toBe(
      `bls: all claude.ai users together have used their shared 2000 tool calls for today; resets at ${RESET}.`,
    );
  });

  it("names the whole service's daily budget", () => {
    const result = refuse({
      scope: "service",
      kind: "upstream",
      source: "bls",
      limit: 490,
      used: 490,
      resetsAt: RESET,
    });
    expect(result.content[0].text).toBe(
      `bls: the whole service has used its daily budget of 490 BLS queries; resets at ${RESET}.${STILL_WORK}`,
    );
  });

  it("carries an envelope with data null, the sentence as its limitation and the limit block", () => {
    const info: LimitInfo = {
      scope: "network",
      kind: "upstream",
      source: "bls",
      limit: 100,
      used: 100,
      resetsAt: RESET,
    };
    const result = refuse(info);
    const env = EnvelopeSchema.parse(result.structuredContent);
    expect(env.data).toBeNull();
    expect(env.source).toMatchObject({
      agency: "bls",
      program: "bls_get_indicator",
      ids: [],
      url: "https://www.bls.gov",
    });
    expect(env.limitations).toEqual([result.content[0].text]);
    expect(env.limit).toEqual(info);
    expect(env.retrievedAt).toBe("2026-10-05T12:00:00.000Z");
  });

  it("names only the still-working tools the server has", () => {
    const result = toToolError(
      new LimitExceededError({
        scope: "network",
        kind: "upstream",
        source: "hud",
        limit: 50,
        used: 50,
        resetsAt: RESET,
      }),
      { ...context, agency: "hud", toolName: "hud_get_raw", tools: ["hud_get_raw"] },
    );
    expect(result.content[0].text).toContain(
      "Tools that need no new query (hud_describe_source) still work.",
    );
  });

  it("renders core's QuotaExceededError the same way, as the service's budget", () => {
    const result = toToolError(
      new QuotaExceededError({ source: "bls", resetsAt: RESET, limit: 490, used: 490 }),
      context,
    );
    expect(result.content[0].text).toBe(
      `bls: the whole service has used its daily budget of 490 BLS queries; resets at ${RESET}.${STILL_WORK}`,
    );
    const env = EnvelopeSchema.parse(result.structuredContent);
    expect(env.limit).toEqual({
      scope: "service",
      kind: "upstream",
      source: "bls",
      limit: 490,
      used: 490,
      resetsAt: RESET,
    });
  });

  it("renders an agency's own refusal, which has no counts, without inventing a number", () => {
    const result = toToolError(new QuotaExceededError({ source: "bls", resetsAt: RESET }), context);
    expect(result.content[0].text).toBe(
      `bls: the whole service's daily budget of BLS queries is spent; resets at ${RESET}.${STILL_WORK}`,
    );
    const env = EnvelopeSchema.parse(result.structuredContent);
    expect(env.limit).toEqual({ scope: "service", kind: "upstream", source: "bls", resetsAt: RESET });
  });

  it("gives other errors no structuredContent", () => {
    expect(toToolError(new Error("boom"), context)).not.toHaveProperty("structuredContent");
  });
});
