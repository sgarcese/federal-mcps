import { ucgidOf } from "@federal-mcps/core";
import { describe, expect, it } from "vitest";
import { parseGeocorr } from "./geocorr.js";

const CSV = [
  "geo_pair,child_geoid,child_name,parent_geoid,parent_name,afact,pop20",
  'place_county,1304000,"Atlanta city, GA",13121,"Fulton County, GA",0.930,392230',
  'place_county,1304000,"Atlanta city, GA",13089,"DeKalb County, GA",0.070,29520',
  'cousub_cbsa,0937000,"Hartford town, CT",25540,"Hartford-East Hartford-Middletown, CT",1.000,121054',
  'zcta_tract,42101036900,"Census Tract 369, Philadelphia County, PA",19104,"ZCTA5 19104",0.550,9840',
].join("\n");

describe("parseGeocorr", () => {
  it("reads afact as share, filtered to the requested geo_pair", () => {
    const rows = parseGeocorr(CSV, "place_county");
    expect(rows).toEqual([
      { childUcgid: ucgidOf("160", "1304000"), parentUcgid: ucgidOf("050", "13121"), share: 0.93 },
      { childUcgid: ucgidOf("160", "1304000"), parentUcgid: ucgidOf("050", "13089"), share: 0.07 },
    ]);
  });

  it("a place crossing counties has share < 1 in each county", () => {
    const rows = parseGeocorr(CSV, "place_county");
    expect(rows.every((r) => r.share < 1)).toBe(true);
  });

  it("filters out other geo_pairs", () => {
    expect(parseGeocorr(CSV, "cousub_cbsa")).toEqual([
      { childUcgid: ucgidOf("060", "0937000"), parentUcgid: ucgidOf("310", "25540"), share: 1 },
    ]);
    expect(parseGeocorr(CSV, "zcta_tract")).toEqual([
      {
        childUcgid: ucgidOf("140", "42101036900"),
        parentUcgid: ucgidOf("860", "19104"),
        share: 0.55,
      },
    ]);
  });

  it("handles quoted fields containing commas", () => {
    const rows = parseGeocorr(CSV, "place_county");
    expect(rows).toHaveLength(2); // parse didn't split "Atlanta city, GA" into extra fields
  });

  it("returns [] for an unknown geo_pair", () => {
    expect(parseGeocorr(CSV, "nonexistent")).toEqual([]);
  });
});
