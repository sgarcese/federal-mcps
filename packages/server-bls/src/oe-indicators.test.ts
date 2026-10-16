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

  it("declares a statistic dimension of wage-only codes, defaulting to annual mean wage (#359)", () => {
    const def = oewsIndicatorDefinitions.find((d) => d.name === "occupational_wage");
    const statistic = def?.dimensions?.find((d) => d.argument === "statistic");
    expect(statistic?.default).toBe("04");
    expect(statistic?.vocabulary.map((v) => v.code).sort()).toEqual(
      ["03", "04", "08", "11", "12", "13", "14", "15"].sort(),
    );
  });

  it("builds a series id for a non-default statistic (annual median wage)", () => {
    const def = oewsIndicatorDefinitions.find((d) => d.name === "occupational_wage");
    expect(
      def?.buildSeriesId("S:18", {
        seasonallyAdjusted: false,
        dimensions: { occupation: "000000", statistic: "13" },
      }),
    ).toBe("OEUS180000000000000000013");
  });

  it("accepts a detailed 6-digit SOC occupation code beyond the curated major-group vocabulary", () => {
    const def = oewsIndicatorDefinitions.find((d) => d.name === "occupational_wage");
    const occupation = def?.dimensions?.find((d) => d.argument === "occupation");
    expect(occupation?.acceptsCode?.("472031")).toBe(true);
    expect(
      def?.buildSeriesId("S:18", {
        seasonallyAdjusted: false,
        dimensions: { occupation: "472031", statistic: "04" },
      }),
    ).toBe("OEUS180000000000047203104");
  });

  it("names BLS's detailed occupation list in openCodes rather than enumerating ~830 codes", () => {
    const def = oewsIndicatorDefinitions.find((d) => d.name === "occupational_wage");
    const occupation = def?.dimensions?.find((d) => d.argument === "occupation");
    expect(occupation?.vocabulary).toHaveLength(23); // unchanged: the 22 major groups + all-occ
    expect(occupation?.openCodes).toMatch(/6-digit/);
  });
});

describe("occupational_employment — split from wages for correct units (#359)", () => {
  it("is registered, over the same OEWS program, with a count/ratio statistic dimension", () => {
    const def = oewsIndicatorDefinitions.find((d) => d.name === "occupational_employment");
    expect(def).toBeDefined();
    expect(def?.program).toBe("OEWS");
    const statistic = def?.dimensions?.find((d) => d.argument === "statistic");
    expect(statistic?.default).toBe("01");
    expect(statistic?.vocabulary.map((v) => v.code).sort()).toEqual(["01", "16", "17"]);
  });

  it("builds the default employment series id", () => {
    const def = oewsIndicatorDefinitions.find((d) => d.name === "occupational_employment");
    expect(
      def?.buildSeriesId("S:18", {
        seasonallyAdjusted: false,
        dimensions: { occupation: "000000", statistic: "01" },
      }),
    ).toBe("OEUS180000000000000000001");
  });

  it("builds the location-quotient series id for a metro and a detailed occupation", () => {
    const def = oewsIndicatorDefinitions.find((d) => d.name === "occupational_employment");
    expect(
      def?.buildSeriesId("M:0019740", {
        seasonallyAdjusted: false,
        dimensions: { occupation: "291141", statistic: "17" },
      }),
    ).toBe("OEUM001974000000029114117");
  });

  it("is included in the aggregate blsIndicatorDefinitions seam", () => {
    expect(blsIndicatorDefinitions.map((d) => d.name)).toContain("occupational_employment");
  });
});
