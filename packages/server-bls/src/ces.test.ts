import { describe, expect, it } from "vitest";
import { buildSmSeriesId, isSmSeriesId } from "./ces.js";

describe("buildSmSeriesId", () => {
  it("builds the statewide total-nonfarm series id (Colorado, NSA) — a known-good published id", () => {
    // Verified against the live BLS API: Colorado all-employees, Dec 2024 = 2989.6k.
    expect(buildSmSeriesId("08")).toBe("SMU08000000000000001");
    expect(buildSmSeriesId("08", { seasonallyAdjusted: false })).toBe("SMU08000000000000001");
  });

  it("switches the seasonal flag to S when adjusted", () => {
    expect(buildSmSeriesId("08", { seasonallyAdjusted: true })).toBe("SMS08000000000000001");
  });

  it("is always 20 characters and passes isSmSeriesId", () => {
    for (const fips of ["08", "06", "36", "01"]) {
      const id = buildSmSeriesId(fips);
      expect(id).toHaveLength(20);
      expect(isSmSeriesId(id)).toBe(true);
    }
  });

  it("throws on a malformed state FIPS rather than emitting a bad id", () => {
    expect(() => buildSmSeriesId("8")).toThrow();
    expect(() => buildSmSeriesId("008")).toThrow();
    expect(() => buildSmSeriesId("CO")).toThrow();
  });

  it("isSmSeriesId rejects non-SM ids", () => {
    expect(isSmSeriesId("LAUCN080310000000003")).toBe(false);
    expect(isSmSeriesId("SMX08000000000000001")).toBe(false); // bad seasonal flag
    expect(isSmSeriesId("SMU0800000000000001")).toBe(false); // 19 chars
  });
});
