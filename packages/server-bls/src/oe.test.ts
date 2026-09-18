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
