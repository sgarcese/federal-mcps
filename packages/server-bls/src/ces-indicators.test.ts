import { describe, expect, it } from "vitest";
import { cesIndicatorDefinitions, cesStateCode } from "./ces-indicators.js";
import { blsIndicatorDefinitions } from "./indicators.js";

// Minimal PlaceCandidate stand-ins: cesStateCode reads only kind.sumlevel and geoid.
// biome-ignore lint/suspicious/noExplicitAny: only the two fields cesStateCode reads matter here.
const place = (sumlevel: string, geoid: string): any => ({ geoid, kind: { sumlevel } });

describe("cesStateCode", () => {
  it("returns a state's FIPS geoid", () => {
    expect(cesStateCode(place("040", "08"))).toBe("08");
  });

  it("returns undefined for non-state places (metro, county, city) — no fabrication", () => {
    expect(cesStateCode(place("310", "19740"))).toBeUndefined();
    expect(cesStateCode(place("050", "08031"))).toBeUndefined();
    expect(cesStateCode(place("160", "0820000"))).toBeUndefined();
  });
});

describe("cesIndicatorDefinitions", () => {
  it("registers payroll_employment over the SM program, NSA by default", () => {
    const def = cesIndicatorDefinitions.find((d) => d.name === "payroll_employment");
    expect(def).toBeDefined();
    expect(def?.program).toBe("SM");
    expect(def?.defaultSeasonallyAdjusted).toBe(false);
    expect(def?.description.length).toBeGreaterThan(0);
  });

  it("builds the statewide SM series id from a state code", () => {
    const def = cesIndicatorDefinitions.find((d) => d.name === "payroll_employment");
    expect(def?.buildSeriesId("08", { seasonallyAdjusted: false })).toBe("SMU08000000000000001");
  });

  it("is included in the aggregate blsIndicatorDefinitions seam", () => {
    expect(blsIndicatorDefinitions.map((d) => d.name)).toContain("payroll_employment");
  });
});
