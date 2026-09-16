import { describe, expect, it } from "vitest";
import { buildSmSeriesId, isSmSeriesId } from "./ces.js";

describe("buildSmSeriesId", () => {
  it("builds the statewide total-nonfarm id (Colorado, NSA) — a known-good published id", () => {
    // Verified live: Colorado all-employees 2989.6k (2024). state 08 + statewide area 00000.
    expect(buildSmSeriesId("0800000")).toBe("SMU08000000000000001");
  });

  it("builds a single-state metro id (Denver, state+area 0819740) — verified live 1650.0k", () => {
    expect(buildSmSeriesId("0819740")).toBe("SMU08197400000000001");
  });

  it("switches the seasonal flag to S when adjusted", () => {
    expect(buildSmSeriesId("0800000", { seasonallyAdjusted: true })).toBe("SMS08000000000000001");
  });

  it("is always 20 characters and passes isSmSeriesId", () => {
    for (const key of ["0800000", "0819740", "3600000", "0616980"]) {
      const id = buildSmSeriesId(key);
      expect(id).toHaveLength(20);
      expect(isSmSeriesId(id)).toBe(true);
    }
  });

  it("throws on a malformed state+area key rather than emitting a bad id", () => {
    expect(() => buildSmSeriesId("08")).toThrow(); // old 2-char form no longer valid
    expect(() => buildSmSeriesId("081974")).toThrow(); // 6 digits
    expect(() => buildSmSeriesId("0819740X")).toThrow();
  });

  it("isSmSeriesId rejects non-SM ids", () => {
    expect(isSmSeriesId("LAUCN080310000000003")).toBe(false);
    expect(isSmSeriesId("SMX08000000000000001")).toBe(false); // bad seasonal flag
    expect(isSmSeriesId("SMU0800000000000001")).toBe(false); // 19 chars
  });
});
