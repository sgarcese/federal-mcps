import { describe, expect, it } from "vitest";
import { buildLausSeriesId, isLausSeriesId, LAUS_MEASURES } from "./laus.js";

// Known-good series ids taken from the live BLS la.series file (not derived from the
// builder): Denver County/city CO (area CN0803100000000) and Colorado (ST0800000000000).
describe("buildLausSeriesId", () => {
  it("builds Denver County's four not-seasonally-adjusted measures", () => {
    const area = "CN0803100000000";
    expect(buildLausSeriesId(area, "unemployment_rate")).toBe("LAUCN080310000000003");
    expect(buildLausSeriesId(area, "unemployment")).toBe("LAUCN080310000000004");
    expect(buildLausSeriesId(area, "employment")).toBe("LAUCN080310000000005");
    expect(buildLausSeriesId(area, "labor_force")).toBe("LAUCN080310000000006");
  });

  it("swaps the seasonal code for a state series (S vs U)", () => {
    const co = "ST0800000000000";
    expect(buildLausSeriesId(co, "unemployment_rate", { seasonallyAdjusted: true })).toBe(
      "LASST080000000000003",
    );
    expect(buildLausSeriesId(co, "unemployment_rate", { seasonallyAdjusted: false })).toBe(
      "LAUST080000000000003",
    );
    expect(buildLausSeriesId(co, "unemployment_rate")).toBe("LAUST080000000000003"); // U default
  });

  it("produces a 20-character id that round-trips through isLausSeriesId", () => {
    const id = buildLausSeriesId("CN0603700000000", "unemployment_rate");
    expect(id).toBe("LAUCN060370000000003"); // Los Angeles County, CA
    expect(id).toHaveLength(20);
    expect(isLausSeriesId(id)).toBe(true);
  });

  it("rejects a malformed area code", () => {
    expect(() => buildLausSeriesId("08031", "unemployment_rate")).toThrow(/15 characters/);
    expect(() => buildLausSeriesId("LAUCN0803100000000", "unemployment_rate")).toThrow(
      /15 characters/,
    );
  });

  it("rejects an unknown measure", () => {
    // @ts-expect-error — exercising the runtime guard on a bad measure
    expect(() => buildLausSeriesId("CN0803100000000", "median_wage")).toThrow(
      /unknown LAUS measure/,
    );
  });

  it("exposes the four-measure vocabulary", () => {
    expect(LAUS_MEASURES).toEqual([
      "unemployment_rate",
      "unemployment",
      "employment",
      "labor_force",
    ]);
  });
});

describe("isLausSeriesId", () => {
  it("accepts well-formed ids and rejects others", () => {
    expect(isLausSeriesId("LAUCN080310000000003")).toBe(true);
    expect(isLausSeriesId("LASST080000000000003")).toBe(true);
    expect(isLausSeriesId("CN0803100000000")).toBe(false); // no LA prefix
    expect(isLausSeriesId("LAUCN08031000000000")).toBe(false); // missing measure
  });
});
