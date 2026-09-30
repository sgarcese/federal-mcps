import { describe, expect, it } from "vitest";
import { buildCpsSeriesId, isCpsSeriesId } from "./cps.js";

describe("buildCpsSeriesId (#290): the nation's labor force, from the Current Population Survey", () => {
  it("builds the published national unemployment rate ids, NSA and SA", () => {
    // Recorded 2026-09-30 (fixtures/bls): LNU04000000 Dec 2025 = 4.1; LNS14000000 = 4.4.
    expect(buildCpsSeriesId("unemployment_rate")).toBe("LNU04000000");
    expect(buildCpsSeriesId("unemployment_rate", { seasonallyAdjusted: true })).toBe("LNS14000000");
  });

  it("builds the unemployed, employed and labor force level ids", () => {
    // Recorded 2026-09-30: Dec 2025 NSA 7,003 / 163,720 / 170,723 thousand.
    expect(buildCpsSeriesId("unemployment")).toBe("LNU03000000");
    expect(buildCpsSeriesId("employment")).toBe("LNU02000000");
    expect(buildCpsSeriesId("labor_force")).toBe("LNU01000000");
    expect(buildCpsSeriesId("unemployment", { seasonallyAdjusted: true })).toBe("LNS13000000");
    expect(buildCpsSeriesId("employment", { seasonallyAdjusted: true })).toBe("LNS12000000");
    expect(buildCpsSeriesId("labor_force", { seasonallyAdjusted: true })).toBe("LNS11000000");
  });

  it("is always 11 characters and passes isCpsSeriesId", () => {
    for (const m of ["unemployment_rate", "unemployment", "employment", "labor_force"] as const) {
      for (const seasonallyAdjusted of [false, true]) {
        const id = buildCpsSeriesId(m, { seasonallyAdjusted });
        expect(id).toHaveLength(11);
        expect(isCpsSeriesId(id)).toBe(true);
      }
    }
    expect(isCpsSeriesId("LAUCN080310000000003")).toBe(false);
  });
});
