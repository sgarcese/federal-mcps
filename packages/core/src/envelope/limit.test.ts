import { describe, expect, it } from "vitest";
import { envelope } from "./envelope.js";
import { EnvelopeSchema, LimitBlockSchema } from "./schema.js";

/**
 * The envelope's `limit` block (ADR-020 §4, #323): present only on refusals, it says whose share
 * was spent, of what, how much, and when it resets.
 */
const source = {
  agency: "bls",
  program: "bls_get_indicator",
  ids: [],
  url: "https://www.bls.gov",
  citation: "x",
};
const limit = {
  scope: "network" as const,
  kind: "upstream" as const,
  source: "bls",
  limit: 100,
  used: 100,
  resetsAt: "2026-10-06T00:00:00.000Z",
};

describe("the envelope limit block", () => {
  it("is absent from an ordinary envelope", () => {
    const env = envelope({ data: 1, source });
    expect("limit" in env).toBe(false);
    expect(EnvelopeSchema.parse(env)).not.toHaveProperty("limit");
  });

  it("travels in the envelope and survives schema parsing", () => {
    const env = envelope({ data: null, source, limit });
    expect(env.limit).toEqual(limit);
    expect(EnvelopeSchema.parse(env).limit).toEqual(limit);
  });

  it("accepts every scope and both kinds", () => {
    for (const scope of ["network", "pool", "service"] as const) {
      for (const kind of ["upstream", "toolCalls"] as const) {
        expect(LimitBlockSchema.safeParse({ ...limit, scope, kind }).success).toBe(true);
      }
    }
  });

  it("allows the counts to be absent when the agency refused without saying them", () => {
    const { limit: _l, used: _u, ...noCounts } = limit;
    expect(LimitBlockSchema.safeParse({ ...noCounts, scope: "service" }).success).toBe(true);
  });

  it("rejects an unknown scope, a negative count or a non-ISO reset time", () => {
    expect(LimitBlockSchema.safeParse({ ...limit, scope: "user" }).success).toBe(false);
    expect(LimitBlockSchema.safeParse({ ...limit, used: -1 }).success).toBe(false);
    expect(LimitBlockSchema.safeParse({ ...limit, resetsAt: "tomorrow" }).success).toBe(false);
  });
});
