import { describe, expect, it } from "vitest";
import { buildJtSeriesId, isJtSeriesId } from "./jt.js";

describe("buildJtSeriesId", () => {
  it("builds the statewide job openings series id (Colorado, NSA) — a known-good published id", () => {
    // Verified against the live BLS API: Colorado job openings, Dec 2023 = 188 thousand (NSA).
    expect(buildJtSeriesId("08", "JO")).toBe("JTU000000080000000JOL");
    expect(buildJtSeriesId("08", "JO", { seasonallyAdjusted: false })).toBe(
      "JTU000000080000000JOL",
    );
  });

  it("builds the other data elements by swapping only the data-element code", () => {
    // Verified against the live BLS API: Colorado, Dec 2023, NSA, in thousands.
    expect(buildJtSeriesId("08", "HI")).toBe("JTU000000080000000HIL"); // hires = 81
    expect(buildJtSeriesId("08", "QU")).toBe("JTU000000080000000QUL"); // quits = 59
    expect(buildJtSeriesId("08", "LD")).toBe("JTU000000080000000LDL"); // layoffs and discharges = 31
  });

  it("switches the seasonal flag to S when adjusted", () => {
    expect(buildJtSeriesId("08", "JO", { seasonallyAdjusted: true })).toBe("JTS000000080000000JOL");
  });

  it("is always 21 characters and passes isJtSeriesId", () => {
    for (const fips of ["08", "06", "36", "01"]) {
      const id = buildJtSeriesId(fips, "JO");
      expect(id).toHaveLength(21);
      expect(isJtSeriesId(id)).toBe(true);
    }
  });

  it("throws on a malformed state FIPS rather than emitting a bad id", () => {
    expect(() => buildJtSeriesId("8", "JO")).toThrow();
    expect(() => buildJtSeriesId("008", "JO")).toThrow();
    expect(() => buildJtSeriesId("CO", "JO")).toThrow();
  });

  it("isJtSeriesId rejects non-JT ids and malformed input", () => {
    expect(isJtSeriesId("LAUCN080310000000003")).toBe(false); // LAUS
    expect(isJtSeriesId("SMU08000000000000001")).toBe(false); // CES/SM
    expect(isJtSeriesId("OEU080000000000000000")).toBe(false); // OEWS-shaped, not JT
    expect(isJtSeriesId("JTX000000080000000JOL")).toBe(false); // bad seasonal flag
    expect(isJtSeriesId("JTU00000008000000JOL")).toBe(false); // 20 chars
  });
});
