import { describe, expect, it } from "vitest";
import { buildCuSeriesId, CPI_US_CITY_AVERAGE_AREA, isCuSeriesId } from "./cpi.js";

describe("buildCuSeriesId", () => {
  it("builds the U.S. city average all-items id (NSA monthly) — a known-good published id", () => {
    // Verified against the live BLS API: U.S. city average all items = 315.6 (2024).
    expect(buildCuSeriesId(CPI_US_CITY_AVERAGE_AREA)).toBe("CUUR0000SA0");
  });

  it("builds a published-metro id (Denver area S48B) — verified live at 348.0 (2024)", () => {
    expect(buildCuSeriesId("S48B")).toBe("CUURS48BSA0");
  });

  it("switches the seasonal flag to S when adjusted", () => {
    expect(buildCuSeriesId("0000", { seasonallyAdjusted: true })).toBe("CUSR0000SA0");
  });

  it("throws on a malformed area code", () => {
    expect(() => buildCuSeriesId("000")).toThrow();
    expect(() => buildCuSeriesId("S48BX")).toThrow();
  });

  it("isCuSeriesId accepts CPI ids and rejects others", () => {
    expect(isCuSeriesId("CUUR0000SA0")).toBe(true);
    expect(isCuSeriesId("CUURS48BSA0")).toBe(true);
    expect(isCuSeriesId("LAUCN080310000000003")).toBe(false);
  });

  it("builds an item id for food (SAF1) — verified live REQUEST_SUCCEEDED, 2026-09-17", () => {
    expect(buildCuSeriesId(CPI_US_CITY_AVERAGE_AREA, { item: "SAF1" })).toBe("CUUR0000SAF1");
  });

  it("builds an item id for housing (SAH) — verified live REQUEST_SUCCEEDED, 2026-09-17", () => {
    expect(buildCuSeriesId(CPI_US_CITY_AVERAGE_AREA, { item: "SAH" })).toBe("CUUR0000SAH");
  });

  it("builds an item id for medical care (SAM) at a published metro (Denver S48B) — verified live, 2026-09-17", () => {
    expect(buildCuSeriesId("S48B", { item: "SAM" })).toBe("CUURS48BSAM");
  });

  it("isCuSeriesId accepts any 3+ char item code, not only all-items", () => {
    expect(isCuSeriesId("CUUR0000SAF1")).toBe(true);
    expect(isCuSeriesId("CUURS48BSAH")).toBe(true);
    expect(isCuSeriesId("CUUR0000SA")).toBe(false); // item too short
  });
});
