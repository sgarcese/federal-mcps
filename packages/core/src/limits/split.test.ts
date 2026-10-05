import { describe, expect, it } from "vitest";
import type { LimitsConfig } from "./config.js";
import { splitUpstreamPerMinute } from "./split.js";

describe("splitUpstreamPerMinute (#324, ADR-020 §2)", () => {
  it("returns the fallback when no limits config is set at all", () => {
    expect(splitUpstreamPerMinute(undefined, "upstreamPerMinute", "hud", 60)).toBe(60);
  });

  it("splits HUD's 60/min across 2 reserved containers to 30", () => {
    const limits: LimitsConfig = { upstreamPerMinute: { hud: 60 }, reservedConcurrency: 2 };
    expect(splitUpstreamPerMinute(limits, "upstreamPerMinute", "hud", 60)).toBe(30);
  });

  it("splits BEA's 90/min across 2 reserved containers to 45", () => {
    const limits: LimitsConfig = { upstreamPerMinute: { bea: 90 }, reservedConcurrency: 2 };
    expect(splitUpstreamPerMinute(limits, "upstreamPerMinute", "bea", 90)).toBe(45);
  });

  it("splits BEA's 30 errors/min across 2 reserved containers to 15", () => {
    const limits: LimitsConfig = { upstreamErrorsPerMinute: { bea: 30 }, reservedConcurrency: 2 };
    expect(splitUpstreamPerMinute(limits, "upstreamErrorsPerMinute", "bea", 30)).toBe(15);
  });

  it("falls back when the config is set but has no value for this source", () => {
    const limits: LimitsConfig = { upstreamPerMinute: { hud: 60 }, reservedConcurrency: 2 };
    expect(splitUpstreamPerMinute(limits, "upstreamPerMinute", "bea", 90)).toBe(90);
  });

  it("falls back when the config has a value but no reservedConcurrency", () => {
    const limits: LimitsConfig = { upstreamPerMinute: { hud: 60 } };
    expect(splitUpstreamPerMinute(limits, "upstreamPerMinute", "hud", 60)).toBe(60);
  });

  it("floors the result and never returns less than 1", () => {
    const limits: LimitsConfig = { upstreamPerMinute: { hud: 1 }, reservedConcurrency: 5 };
    expect(splitUpstreamPerMinute(limits, "upstreamPerMinute", "hud", 60)).toBe(1);
  });

  it("floors a non-exact division", () => {
    const limits: LimitsConfig = { upstreamPerMinute: { hud: 100 }, reservedConcurrency: 3 };
    expect(splitUpstreamPerMinute(limits, "upstreamPerMinute", "hud", 60)).toBe(33);
  });
});
