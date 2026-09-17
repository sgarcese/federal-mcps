import { ucgidOf } from "@federal-mcps/core";
import { describe, expect, it } from "vitest";
import { parseGeocorr } from "../../parse/geocorr.js";
import { loadVendoredGeocorr } from "./vendored.js";

/**
 * Regression for #141: the national place→county crosswalk must ship in the package, so a
 * below-threshold city anywhere in the country finds its county (ADR-009 §6 fallback).
 */
describe("loadVendoredGeocorr", () => {
  const text = loadVendoredGeocorr();
  const placeCounty = parseGeocorr(text, "place_county");

  it("carries the full national place→county crosswalk, not a sample", () => {
    expect(placeCounty.length).toBeGreaterThan(36_000);
  });

  it("resolves Sedona, AZ (below threshold) to Yavapai County as its majority county", () => {
    const sedona = placeCounty
      .filter((r) => r.childUcgid === ucgidOf("160", "0465350"))
      .sort((a, b) => b.share - a.share);
    expect(sedona[0]).toEqual({
      childUcgid: ucgidOf("160", "0465350"),
      parentUcgid: ucgidOf("050", "04025"),
      share: 0.737,
    });
    expect(sedona[1]?.parentUcgid).toBe(ucgidOf("050", "04005")); // Coconino, the minority
  });

  it("allocation factors sum to ~1 across the counties of every place", () => {
    const sums = new Map<string, number>();
    for (const r of placeCounty) sums.set(r.childUcgid, (sums.get(r.childUcgid) ?? 0) + r.share);
    const off = [...sums.entries()].filter(([, s]) => Math.abs(s - 1) > 0.01);
    expect(off).toEqual([]);
  });

  it("still carries the sample's other crosswalks (cousub↔CBSA, ZCTA↔tract)", () => {
    expect(parseGeocorr(text, "cousub_cbsa").length).toBeGreaterThan(0);
    expect(parseGeocorr(text, "zcta_tract").length).toBeGreaterThan(0);
  });
});
