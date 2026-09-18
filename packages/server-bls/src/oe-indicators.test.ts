import { describe, expect, it } from "vitest";
import { blsIndicatorDefinitions } from "./indicators.js";
import { oewsCodeOf, oewsIndicatorDefinitions } from "./oe-indicators.js";

// Minimal PlaceCandidate stand-ins: oewsCodeOf reads only kind.sumlevel, geoid and agencyCodes.
// biome-ignore lint/suspicious/noExplicitAny: only the fields oewsCodeOf reads matter here.
const place = (sumlevel: string, geoid: string, agencyCodes: any[] = []): any => ({
  geoid,
  kind: { sumlevel },
  agencyCodes,
});

describe("oewsCodeOf", () => {
  it("returns a state's FIPS geoid, prefixed S:", () => {
    expect(oewsCodeOf(place("040", "08"))).toBe("S:08");
  });

  it("returns the catalog's OEWS metro area code, prefixed M:, for a metro candidate", () => {
    expect(
      oewsCodeOf(
        place("310", "19740", [
          { agency: "bls", program: "OEWS", code: "0019740" },
          { agency: "bls", program: "CPI", code: "S48B" },
        ]),
      ),
    ).toBe("M:0019740");
  });

  it("returns undefined for a metro with no stored OEWS code — no fabrication", () => {
    expect(
      oewsCodeOf(place("310", "12345", [{ agency: "bls", program: "CPI", code: "X" }])),
    ).toBeUndefined();
  });

  it("returns undefined for non-state, non-metro places (county, city) — no fabrication", () => {
    expect(oewsCodeOf(place("050", "08031"))).toBeUndefined();
    expect(oewsCodeOf(place("160", "0820000"))).toBeUndefined();
  });
});

describe("oewsIndicatorDefinitions", () => {
  it("registers occupational_wage over the OEWS program, NSA by default, with an occupation dimension", () => {
    const def = oewsIndicatorDefinitions.find((d) => d.name === "occupational_wage");
    expect(def).toBeDefined();
    expect(def?.program).toBe("OEWS");
    expect(def?.defaultSeasonallyAdjusted).toBe(false);
    expect(def?.description.length).toBeGreaterThan(0);
    expect(def?.dimensions?.[0]?.argument).toBe("occupation");
    expect(def?.dimensions?.[0]?.default).toBe("000000");
    // 22 SOC major groups plus the "all occupations" default (ADR-013 §2).
    expect(def?.dimensions?.[0]?.vocabulary).toHaveLength(23);
  });

  it("builds the statewide OE series id from a state code, defaulting to all occupations", () => {
    const def = oewsIndicatorDefinitions.find((d) => d.name === "occupational_wage");
    expect(
      def?.buildSeriesId("S:08", {
        seasonallyAdjusted: false,
        dimensions: { occupation: "000000" },
      }),
    ).toBe("OEUS080000000000000000004");
  });

  it("builds a statewide OE series id for an explicit occupation code", () => {
    const def = oewsIndicatorDefinitions.find((d) => d.name === "occupational_wage");
    expect(
      def?.buildSeriesId("S:08", {
        seasonallyAdjusted: false,
        dimensions: { occupation: "470000" },
      }),
    ).toBe("OEUS080000000000047000004");
  });

  it("builds a metro OE series id from the catalog's OEWS area code", () => {
    const def = oewsIndicatorDefinitions.find((d) => d.name === "occupational_wage");
    expect(
      def?.buildSeriesId("M:0019740", {
        seasonallyAdjusted: false,
        dimensions: { occupation: "000000" },
      }),
    ).toBe("OEUM001974000000000000004");
  });

  it("is included in the aggregate blsIndicatorDefinitions seam", () => {
    expect(blsIndicatorDefinitions.map((d) => d.name)).toContain("occupational_wage");
  });
});
