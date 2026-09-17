import { ucgidOf } from "@federal-mcps/core";
import { describe, expect, it } from "vitest";
import { parseGeocorr, transformGeocorrPlaceCounty } from "./geocorr.js";

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

/** Raw MCDC broker output: two header rows (names, labels), trailing blank after `afact`. */
const RAW = [
  '"state","place","county","stab","CountyName","PlaceName","pop20","afact"',
  '"State code","Place code","County code","State abbr.","County name","Place name","Total population (2020 Census)","place-to-county allocation factor"',
  '"04","65350","04005","AZ","Coconino AZ","Sedona city, AZ",2547,0.263 ',
  '"04","65350","04025","AZ","Yavapai AZ","Sedona city, AZ",7137,0.737 ',
  '"01","00124","01067","AL","Henry AL","Abbeville city, AL",2358,1 ',
].join("\n");

describe("transformGeocorrPlaceCounty", () => {
  it("rewrites the broker's native columns into the vendored schema, one header row", () => {
    const out = transformGeocorrPlaceCounty(RAW).split("\n");
    expect(out[0]).toBe("geo_pair,child_geoid,child_name,parent_geoid,parent_name,afact,pop20");
    expect(out).toHaveLength(4);
    expect(out[1]).toBe('place_county,0465350,"Sedona city, AZ",04005,"Coconino AZ",0.263,2547');
  });

  it("builds the 7-digit place GEOID from state + place and keeps the 5-digit county", () => {
    const rows = parseGeocorr(transformGeocorrPlaceCounty(RAW), "place_county");
    expect(rows).toContainEqual({
      childUcgid: ucgidOf("160", "0465350"),
      parentUcgid: ucgidOf("050", "04025"),
      share: 0.737,
    });
    expect(rows).toContainEqual({
      childUcgid: ucgidOf("160", "0100124"),
      parentUcgid: ucgidOf("050", "01067"),
      share: 1,
    });
  });

  it("rejects input whose header is not the broker's place→county layout", () => {
    expect(() => transformGeocorrPlaceCounty("a,b,c\n1,2,3")).toThrow(/header/);
  });
});
