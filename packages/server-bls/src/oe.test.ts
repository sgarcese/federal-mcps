import { describe, expect, it } from "vitest";
import { buildOeSeriesId, isOeSeriesId } from "./oe.js";

describe("buildOeSeriesId", () => {
  it("builds the statewide annual-mean-wage series id (Colorado, NSA) — a known-good published id", () => {
    // Verified against the live BLS API: Colorado all-occupations annual mean wage, 2025 = $77,190.
    expect(buildOeSeriesId("08")).toBe("OEUS080000000000000000004");
    expect(buildOeSeriesId("08", { seasonallyAdjusted: false })).toBe(
      "OEUS080000000000000000004",
    );
  });

  it("stays unadjusted (U) even when seasonallyAdjusted is requested — OEWS is annual, unadjusted", () => {
    expect(buildOeSeriesId("08", { seasonallyAdjusted: true })).toBe(
      "OEUS080000000000000000004",
    );
  });

  it("is always 25 characters and passes isOeSeriesId", () => {
    for (const fips of ["08", "06", "36", "01"]) {
      const id = buildOeSeriesId(fips);
      expect(id).toHaveLength(25);
      expect(isOeSeriesId(id)).toBe(true);
    }
  });

  it("throws on a malformed state FIPS rather than emitting a bad id", () => {
    expect(() => buildOeSeriesId("8")).toThrow();
    expect(() => buildOeSeriesId("008")).toThrow();
    expect(() => buildOeSeriesId("CO")).toThrow();
  });

  it("isOeSeriesId rejects non-OE ids", () => {
    expect(isOeSeriesId("LAUCN080310000000003")).toBe(false);
    expect(isOeSeriesId("SMU08000000000000001")).toBe(false); // CES SM id
    expect(isOeSeriesId("OEUX080000000000000000004")).toBe(false); // bad area type flag
    expect(isOeSeriesId("OEUS08000000000000000004")).toBe(false); // 24 chars
  });
});
