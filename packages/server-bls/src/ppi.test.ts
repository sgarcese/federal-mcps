import { describe, expect, it } from "vitest";
import { buildWpuSeriesId, isWpuSeriesId, PPI_FINAL_DEMAND } from "./ppi.js";

/**
 * PPI commodity series ids, verified against the live BLS API on 2026-09-17 (registered key, all
 * REQUEST_SUCCEEDED with 2026-M08 data): WPUFD4 final demand 157.604; WPU00000000 all commodities
 * 287.928; WPUIP2311001 inputs to residential construction, goods 348.993; WPU1017 steel mill
 * products 381.162.
 */
describe("buildWpuSeriesId", () => {
  it("builds the final-demand headline (WPU + item), not seasonally adjusted by default", () => {
    expect(buildWpuSeriesId(PPI_FINAL_DEMAND)).toBe("WPUFD4");
    expect(buildWpuSeriesId("00000000")).toBe("WPU00000000");
    expect(buildWpuSeriesId("IP2311001")).toBe("WPUIP2311001");
    expect(buildWpuSeriesId("1017")).toBe("WPU1017");
  });

  it("uses the WPS prefix when seasonally adjusted", () => {
    expect(buildWpuSeriesId("FD4", { seasonallyAdjusted: true })).toBe("WPSFD4");
  });

  it("rejects a malformed item code", () => {
    expect(() => buildWpuSeriesId("")).toThrow(/item/);
    expect(() => buildWpuSeriesId("fd 4")).toThrow(/item/);
  });

  it("recognises well-formed PPI commodity ids", () => {
    expect(isWpuSeriesId("WPUFD4")).toBe(true);
    expect(isWpuSeriesId("WPSFD49104")).toBe(true);
    expect(isWpuSeriesId("LAUCN080310000000003")).toBe(false);
  });
});
