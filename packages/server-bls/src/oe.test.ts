import { describe, expect, it } from "vitest";
import { buildOeSeriesId, isOeSeriesId } from "./oe.js";

describe("buildOeSeriesId", () => {
  it("builds the statewide all-occupations annual-mean-wage series id (Colorado, NSA) — a known-good published id", () => {
    // Verified against the live BLS API: Colorado all-occupations annual mean wage, 2025 = $77,190.
    expect(buildOeSeriesId("S:08")).toBe("OEUS080000000000000000004");
    expect(buildOeSeriesId("S:08", { seasonallyAdjusted: false })).toBe(
      "OEUS080000000000000000004",
    );
  });

  it("builds a statewide series id for an explicit occupation code — a known-good published id", () => {
    // Verified against the live BLS API: Colorado construction & extraction occupations
    // (470000) annual mean wage, 2025 = $65,880.
    expect(buildOeSeriesId("S:08", { occupation: "470000" })).toBe("OEUS080000000000047000004");
  });

  it("builds a metro series id from the catalog's OEWS area code — a known-good published id", () => {
    // Verified against the live BLS API: Denver-Aurora-Centennial metro (CBSA 19740, OEWS area
    // "0019740") all-occupations annual mean wage, 2025 = $81,690.
    expect(buildOeSeriesId("M:0019740")).toBe("OEUM001974000000000000004");
  });

  it("builds the national series id (area type N, area 0000000) — a known-good published id (#290)", () => {
    // Recorded 2026-09-30 (fixtures/bls): OEUN000000000000000000004, 2025 annual mean = $69,770.
    expect(buildOeSeriesId("N")).toBe("OEUN000000000000000000004");
    expect(buildOeSeriesId("N", { occupation: "470000" })).toBe("OEUN000000000000047000004");
    expect(() => buildOeSeriesId("N:00")).toThrow();
  });

  it("stays unadjusted (U) even when seasonallyAdjusted is requested — OEWS is annual, unadjusted", () => {
    expect(buildOeSeriesId("S:08", { seasonallyAdjusted: true })).toBe("OEUS080000000000000000004");
  });

  it("is always 25 characters and passes isOeSeriesId, for state and metro area specs", () => {
    for (const spec of ["S:08", "S:06", "S:36", "S:01", "M:0019740"]) {
      const id = buildOeSeriesId(spec);
      expect(id).toHaveLength(25);
      expect(isOeSeriesId(id)).toBe(true);
    }
  });

  it("throws on a malformed area spec rather than emitting a bad id", () => {
    expect(() => buildOeSeriesId("08")).toThrow(); // bare FIPS, no longer accepted
    expect(() => buildOeSeriesId("S:8")).toThrow();
    expect(() => buildOeSeriesId("S:008")).toThrow();
    expect(() => buildOeSeriesId("S:CO")).toThrow();
    expect(() => buildOeSeriesId("M:19740")).toThrow(); // only 5 digits, not 7
    expect(() => buildOeSeriesId("bogus")).toThrow();
  });

  it("throws on a malformed occupation code rather than emitting a bad id", () => {
    expect(() => buildOeSeriesId("S:08", { occupation: "47" })).toThrow();
    expect(() => buildOeSeriesId("S:08", { occupation: "4700000" })).toThrow();
    expect(() => buildOeSeriesId("S:08", { occupation: "abcdef" })).toThrow();
  });

  it("isOeSeriesId rejects non-OE ids", () => {
    expect(isOeSeriesId("LAUCN080310000000003")).toBe(false);
    expect(isOeSeriesId("SMU08000000000000001")).toBe(false); // CES SM id
    expect(isOeSeriesId("OEUX080000000000000000004")).toBe(false); // bad area type flag
    expect(isOeSeriesId("OEUS08000000000000000004")).toBe(false); // 24 chars
  });
});

describe("buildOeSeriesId — statistic (data type) picker (#359)", () => {
  // Every code verified live against the BLS API, 2026-10-15 (Indiana, state FIPS "18", all
  // occupations, 2025 data): 01 employment = 3,201,220 · 03 hourly mean = $29.25 · 08 hourly
  // median = $23.01 · 11 annual 10th pct = $29,120 · 12 annual 25th pct = $36,500 · 13 annual
  // median = $47,860 · 14 annual 75th pct = $72,000 · 15 annual 90th pct = $101,160 · 16
  // employment per 1,000 jobs = 1000.000 · 17 location quotient = 1.00 (statewide, always 1.00).
  it("defaults to annual mean wage (04), unchanged", () => {
    expect(buildOeSeriesId("S:08")).toBe("OEUS080000000000000000004");
  });

  it("builds a series id for each new statistic code", () => {
    const cases: [string, string][] = [
      ["01", "OEUS180000000000000000001"], // employment
      ["03", "OEUS180000000000000000003"], // hourly mean wage
      ["08", "OEUS180000000000000000008"], // hourly median wage
      ["11", "OEUS180000000000000000011"], // annual 10th percentile wage
      ["12", "OEUS180000000000000000012"], // annual 25th percentile wage
      ["13", "OEUS180000000000000000013"], // annual median wage
      ["14", "OEUS180000000000000000014"], // annual 75th percentile wage
      ["15", "OEUS180000000000000000015"], // annual 90th percentile wage
      ["16", "OEUS180000000000000000016"], // employment per 1,000 jobs
      ["17", "OEUS180000000000000000017"], // location quotient
    ];
    for (const [statistic, expected] of cases) {
      expect(buildOeSeriesId("S:18", { statistic })).toBe(expected);
    }
  });

  it("combines a statistic with an explicit occupation", () => {
    // Verified live 2026-10-15: carpenters (472031), Indiana, annual mean wage = $64,950.
    expect(buildOeSeriesId("S:18", { occupation: "472031", statistic: "04" })).toBe(
      "OEUS180000000000047203104",
    );
  });

  it("throws on an unrecognized statistic code rather than emitting a bad id", () => {
    expect(() => buildOeSeriesId("S:08", { statistic: "99" })).toThrow();
    expect(() => buildOeSeriesId("S:08", { statistic: "4" })).toThrow();
  });
});

describe("buildOeSeriesId — detailed 6-digit SOC occupations, built from BLS's own list (#359)", () => {
  it("accepts a published detailed occupation code (carpenters, 472031)", () => {
    // Verified live 2026-10-15: carpenters, Indiana, annual mean wage = $64,950.
    expect(buildOeSeriesId("S:18", { occupation: "472031" })).toBe(
      "OEUS180000000000047203104",
    );
  });

  it("accepts a published detailed occupation code for a metro and a non-default statistic", () => {
    // Verified live 2026-10-15: registered nurses (291141), Denver-Aurora-Centennial metro
    // (CBSA 19740, OEWS area "0019740"), annual median wage = $101,130; annual 90th percentile
    // = $125,870.
    expect(buildOeSeriesId("M:0019740", { occupation: "291141", statistic: "13" })).toBe(
      "OEUM001974000000029114113",
    );
    expect(buildOeSeriesId("M:0019740", { occupation: "291141", statistic: "15" })).toBe(
      "OEUM001974000000029114115",
    );
  });

  it("rejects a 6-digit code BLS does not publish, naming its nearest major group", () => {
    // "470000" (construction and extraction) is the major group for anything starting "47".
    expect(() => buildOeSeriesId("S:08", { occupation: "479999" })).toThrow(
      /470000.*construction and extraction/i,
    );
  });

  it("rejects an occupation code with no corresponding major group at all", () => {
    expect(() => buildOeSeriesId("S:08", { occupation: "999999" })).toThrow();
  });
});
