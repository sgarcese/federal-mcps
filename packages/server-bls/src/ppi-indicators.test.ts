import { describe, expect, it } from "vitest";
import { blsIndicatorDefinitions } from "./indicators.js";
import { ppiIndicatorDefinitions } from "./ppi-indicators.js";

describe("ppiIndicatorDefinitions (#155, ADR-013 §7)", () => {
  const def = ppiIndicatorDefinitions[0];

  it("registers producer_price_index over the PPI program with national scope", () => {
    expect(ppiIndicatorDefinitions.map((d) => d.name)).toEqual(["producer_price_index"]);
    expect(def).toMatchObject({ program: "PPI", scope: "national", defaultSeasonallyAdjusted: false });
  });

  it("declares an item dimension defaulting to final demand, with the construction inputs", () => {
    const item = def?.dimensions?.find((d) => d.argument === "item");
    expect(item?.default).toBe("FD4");
    const codes = item?.vocabulary.map((v) => v.code) ?? [];
    for (const c of ["FD4", "00000000", "IP2311001", "IP2312001", "081", "1017", "133"]) {
      expect(codes).toContain(c);
    }
    expect(codes.length).toBeGreaterThanOrEqual(15);
  });

  it("builds the series id from the item dimension and ignores the place code", () => {
    expect(
      def?.buildSeriesId("US", { seasonallyAdjusted: false, dimensions: { item: "IP2311001" } }),
    ).toBe("WPUIP2311001");
  });

  it("is included in the aggregate blsIndicatorDefinitions seam", () => {
    expect(blsIndicatorDefinitions.map((d) => d.name)).toContain("producer_price_index");
  });
});
