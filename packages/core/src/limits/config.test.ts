import { describe, expect, it } from "vitest";
import { parseLimitsConfig } from "./config.js";

describe("parseLimitsConfig (ADR-020 §7: FEDERAL_MCPS_LIMITS)", () => {
  it("no variable means no limiter (stdio, local and self-hosted runs)", () => {
    expect(parseLimitsConfig(undefined)).toBeUndefined();
    expect(parseLimitsConfig("")).toBeUndefined();
  });

  it("reads the full shape Terraform writes", () => {
    const config = parseLimitsConfig(
      JSON.stringify({
        serviceDaily: { bls: 490 },
        network: { upstreamDaily: 100, toolCallsDaily: 500 },
        pool: { upstreamDaily: 250, toolCallsDaily: 5000 },
        upstreamPerMinute: { hud: 60 },
        upstreamErrorsPerMinute: { bea: 30 },
        reservedConcurrency: 2,
      }),
    );
    expect(config).toEqual({
      serviceDaily: { bls: 490 },
      network: { upstreamDaily: 100, toolCallsDaily: 500 },
      pool: { upstreamDaily: 250, toolCallsDaily: 5000 },
      upstreamPerMinute: { hud: 60 },
      upstreamErrorsPerMinute: { bea: 30 },
      reservedConcurrency: 2,
    });
  });

  it("every part is optional (geo has no upstream; the CDC portal is edge-only)", () => {
    expect(parseLimitsConfig(JSON.stringify({ network: { toolCallsDaily: 1000 } }))).toEqual({
      network: { toolCallsDaily: 1000 },
    });
  });

  it("refuses a malformed value loudly rather than running unprotected", () => {
    expect(() => parseLimitsConfig("{not json")).toThrow(/FEDERAL_MCPS_LIMITS/);
    expect(() => parseLimitsConfig(JSON.stringify({ serviceDaily: { bls: -1 } }))).toThrow(
      /FEDERAL_MCPS_LIMITS/,
    );
    expect(() => parseLimitsConfig(JSON.stringify({ network: { upstreamDaily: "100" } }))).toThrow(
      /FEDERAL_MCPS_LIMITS/,
    );
  });
});
