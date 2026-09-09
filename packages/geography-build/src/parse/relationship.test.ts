import { describe, expect, it } from "vitest";
import {
  parseCdCounty,
  parseCdPlace,
  parsePlaceCounty,
  parseTractLineage,
  parseZctaCounty,
  parseZctaPlace,
  parseZctaTract,
} from "./relationship.js";

const ZCTA_TRACT_HEADER =
  "OID_ZCTA5_20|GEOID_ZCTA5_20|NAMELSAD_ZCTA5_20|AREALAND_ZCTA5_20|AREAWATER_ZCTA5_20|MTFCC_ZCTA5_20|CLASSFP_ZCTA5_20|FUNCSTAT_ZCTA5_20|OID_TRACT_20|GEOID_TRACT_20|NAMELSAD_TRACT_20|AREALAND_TRACT_20|AREAWATER_TRACT_20|MTFCC_TRACT_20|FUNCSTAT_TRACT_20|AREALAND_PART|AREAWATER_PART";

/** 17 distinct 2020 tracts overlapping ZCTA 19104 (Philadelphia) — the A01 ground truth. */
function zctaTractFixture19104(): string {
  const rows = [ZCTA_TRACT_HEADER];
  const zctaTotalArea = 17_000_000;
  for (let i = 0; i < 17; i++) {
    const tract = `4210100${String(3600 + i).padStart(4, "0")}`;
    const part = 1_000_000;
    rows.push(
      `1|19104|ZCTA5 19104|${zctaTotalArea}|0|G6350|B5|S|1|${tract}|Census Tract ${i}|2000000|0|G5020|S|${part}|0`,
    );
  }
  // A second ZCTA, 19103, should not be counted for the 19104 query.
  rows.push(
    `2|19103|ZCTA5 19103|5000000|0|G6350|B5|S|2|42101003700|Census Tract 37|1000000|0|G5020|S|500000|0`,
  );
  return rows.join("\n");
}

describe("parseZctaTract", () => {
  it("A01: ZCTA 19104 overlaps 17 distinct 2020 tracts", () => {
    const rows = parseZctaTract(zctaTractFixture19104());
    const forZcta = rows.filter((r) => r.parentGeoid === "19104");
    const distinctTracts = new Set(forZcta.map((r) => r.childGeoid));
    expect(distinctTracts.size).toBe(17);
  });

  it("shares are the fraction of the ZCTA's area covered by each tract", () => {
    const rows = parseZctaTract(zctaTractFixture19104());
    const forZcta = rows.filter((r) => r.parentGeoid === "19104");
    for (const r of forZcta) {
      expect(r.share).toBeCloseTo(1_000_000 / 17_000_000, 6);
    }
  });

  it("skips rows with no ZCTA (water-only tract remainder)", () => {
    const text = [
      ZCTA_TRACT_HEADER,
      "1||||||||1|42101036900|Census Tract|2000000|0|G5020|S|500000|0",
    ].join("\n");
    expect(parseZctaTract(text)).toEqual([]);
  });

  it("maps columns by header name, not position", () => {
    const reordered = [
      "GEOID_TRACT_20|AREALAND_PART|GEOID_ZCTA5_20|AREALAND_ZCTA5_20",
      "42101036900|500000|19104|1000000",
    ].join("\n");
    expect(parseZctaTract(reordered)).toEqual([
      { childGeoid: "42101036900", parentGeoid: "19104", share: 0.5 },
    ]);
  });
});

describe("parseZctaCounty and parseZctaPlace", () => {
  it("parseZctaCounty anchors on the ZCTA", () => {
    const text = [
      "GEOID_ZCTA5_20|AREALAND_ZCTA5_20|GEOID_COUNTY_20|AREALAND_PART",
      "19104|1000000|42101|1000000",
    ].join("\n");
    expect(parseZctaCounty(text)).toEqual([
      { childGeoid: "42101", parentGeoid: "19104", share: 1 },
    ]);
  });

  it("parseZctaPlace anchors on the ZCTA", () => {
    const text = [
      "GEOID_ZCTA5_20|AREALAND_ZCTA5_20|GEOID_PLACE_20|AREALAND_PART",
      "19104|1000000|4260000|750000",
    ].join("\n");
    expect(parseZctaPlace(text)).toEqual([
      { childGeoid: "4260000", parentGeoid: "19104", share: 0.75 },
    ]);
  });
});

describe("parseCdCounty and parseCdPlace", () => {
  it("parseCdCounty anchors on the congressional district", () => {
    const text = [
      "GEOID_CD119_20|AREALAND_CD119_20|GEOID_COUNTY_20|AREALAND_PART",
      "0101|2000000|01003|1000000",
    ].join("\n");
    expect(parseCdCounty(text)).toEqual([{ childGeoid: "01003", parentGeoid: "0101", share: 0.5 }]);
  });

  it("parseCdPlace anchors on the congressional district", () => {
    const text = [
      "GEOID_CD119_20|AREALAND_CD119_20|GEOID_PLACE_20|AREALAND_PART",
      "0101|2000000|0103220|1500000",
    ].join("\n");
    expect(parseCdPlace(text)).toEqual([
      { childGeoid: "0103220", parentGeoid: "0101", share: 0.75 },
    ]);
  });
});

describe("parsePlaceCounty", () => {
  it("anchors on the PLACE (fraction of the place within each county), unlike the ZCTA/CD parsers", () => {
    // Atlanta, GA crosses Fulton and DeKalb counties.
    const text = [
      "GEOID_PLACE_20|AREALAND_PLACE_20|GEOID_COUNTY_20|AREALAND_PART",
      "1304000|340000000|13121|316000000",
      "1304000|340000000|13089|24000000",
    ].join("\n");
    const rows = parsePlaceCounty(text);
    const fulton = rows.find((r) => r.parentGeoid === "13121");
    const dekalb = rows.find((r) => r.parentGeoid === "13089");
    expect(fulton?.share).toBeCloseTo(316_000_000 / 340_000_000, 6);
    expect(dekalb?.share).toBeCloseTo(24_000_000 / 340_000_000, 6);
    expect((fulton?.share ?? 0) < 1).toBe(true);
    expect((dekalb?.share ?? 0) < 1).toBe(true);
  });
});

describe("parseTractLineage", () => {
  it("a split 2010 tract maps to multiple 2020 successors whose shares sum to ~1", () => {
    const text = [
      "GEOID_TRACT_10|AREALAND_TRACT_10|GEOID_TRACT_20|AREALAND_PART",
      "42101036800|4000000|42101036801|2500000",
      "42101036800|4000000|42101036802|1500000",
    ].join("\n");
    const rows = parseTractLineage(text);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.fromVintage === 2010 && r.toVintage === 2020)).toBe(true);
    const shares = rows.map((r) => r.share);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(rows.map((r) => r.toGeoid).sort()).toEqual(["42101036801", "42101036802"]);
  });

  it("an unchanged tract maps to itself with share 1", () => {
    const text = [
      "GEOID_TRACT_10|AREALAND_TRACT_10|GEOID_TRACT_20|AREALAND_PART",
      "42101036900|1000000|42101036900|1000000",
    ].join("\n");
    expect(parseTractLineage(text)).toEqual([
      {
        fromGeoid: "42101036900",
        toGeoid: "42101036900",
        fromVintage: 2010,
        toVintage: 2020,
        share: 1,
      },
    ]);
  });
});
