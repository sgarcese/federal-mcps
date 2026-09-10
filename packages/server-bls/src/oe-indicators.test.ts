import { describe, expect, it } from "vitest";
import { blsIndicatorDefinitions } from "./indicators.js";
import { oewsIndicatorDefinitions, oewsStateCode } from "./oe-indicators.js";

// Minimal PlaceCandidate stand-ins: oewsStateCode reads only kind.sumlevel and geoid.
// biome-ignore lint/suspicious/noExplicitAny: only the two fields oewsStateCode reads matter here.
const place = (sumlevel: string, geoid: string): any => ({ geoid, kind: { sumlevel } });

describe("oewsStateCode", () => {
  it("returns a state's FIPS geoid", () => {
    expect(oewsStateCode(place("040", "08"))).toBe("08");
  });

  it("returns undefined for non-state places (metro, county, city) — no fabrication", () => {
    expect(oewsStateCode(place("310", "19740"))).toBeUndefined();
    expect(oewsStateCode(place("050", "08031"))).toBeUndefined();
    expect(oewsStateCode(place("160", "0820000"))).toBeUndefined();
  });
});

describe("oewsIndicatorDefinitions", () => {
  it("registers occupational_wage over the OEWS program, NSA by default", () => {
    const def = oewsIndicatorDefinitions.find((d) => d.name === "occupational_wage");
    expect(def).toBeDefined();
    expect(def?.program).toBe("OEWS");
    expect(def?.defaultSeasonallyAdjusted).toBe(false);
    expect(def?.description.length).toBeGreaterThan(0);
  });

  it("builds the statewide OE series id from a state code", () => {
    const def = oewsIndicatorDefinitions.find((d) => d.name === "occupational_wage");
    expect(def?.buildSeriesId("08", { seasonallyAdjusted: false })).toBe(
      "OEUS080000000000000000004",
    );
  });

  it("is included in the aggregate blsIndicatorDefinitions seam", () => {
    expect(blsIndicatorDefinitions.map((d) => d.name)).toContain("occupational_wage");
  });
});
