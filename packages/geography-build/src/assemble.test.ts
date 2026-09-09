import { ucgidOf } from "@federal-mcps/core";
import { describe, expect, it } from "vitest";
import { assemble } from "./assemble.js";

const STATES = [
  "USPS\tGEOID\tANSICODE\tNAME\tALAND\tAWATER\tINTPTLAT\tINTPTLONG",
  "CO\t08\t01779779\tColorado\t1\t1\t39\t-105",
].join("\n");
const COUNTIES = [
  "USPS\tGEOID\tANSICODE\tNAME\tALAND\tAWATER\tINTPTLAT\tINTPTLONG",
  "CO\t08031\t00198131\tDenver County\t1\t1\t39\t-104",
].join("\n");
const PLACES = [
  "USPS\tGEOID\tANSICODE\tNAME\tLSAD\tFUNCSTAT\tALAND\tAWATER\tINTPTLAT\tINTPTLONG",
  "CO\t0820000\t02412049\tDenver city\t25\tF\t1\t1\t39\t-104",
].join("\n");
const LA_AREA = [
  "area_type_code\tarea_code\tarea_text\tdisplay_level\tselectable\tsort_sequence",
  "A\tST0800000000000\tColorado\t0\tT\t1",
  "F\tCN0803100000000\tDenver County, CO\t2\tT\t2",
].join("\n");

describe("assemble", () => {
  const rows = assemble({
    gazetteers: { "040": STATES, "050": COUNTIES, "160": PLACES },
    lausArea: LA_AREA,
  });

  it("collects entities and aliases across gazetteer files", () => {
    expect(rows.entities.map((e) => e.geoid).sort()).toEqual(["08", "08031", "0820000"]);
    expect(rows.aliases).toContainEqual({
      ucgid: ucgidOf("050", "08031"),
      alias: "Denver",
      source: "lsad-stripped",
    });
  });

  it("derives strict geoid nesting (county→state, place→state) only for present parents", () => {
    expect(rows.containment).toContainEqual({
      childUcgid: ucgidOf("050", "08031"),
      parentUcgid: ucgidOf("040", "08"),
      share: 1,
      relation: "nests",
    });
    expect(rows.containment).toContainEqual({
      childUcgid: ucgidOf("160", "0820000"),
      parentUcgid: ucgidOf("040", "08"),
      share: 1,
      relation: "nests",
    });
    // No place→county here (that is weighted containment, #55).
    expect(
      rows.containment.some(
        (c) =>
          c.childUcgid === ucgidOf("160", "0820000") && c.parentUcgid === ucgidOf("050", "08031"),
      ),
    ).toBe(false);
  });

  it("loads BLS agency codes and the static publishes_at / county_change tables", () => {
    expect(rows.agencyCodes.map((a) => a.ucgid).sort()).toEqual(
      [ucgidOf("040", "08"), ucgidOf("050", "08031")].sort(),
    );
    expect(rows.publishesAt.some((p) => p.program === "LAUS" && p.sumlevel === "160")).toBe(true);
    expect(rows.countyChange.some((c) => c.oldUcgid === ucgidOf("050", "09001"))).toBe(true);
  });

  it("has no lineage or weighted overlap when no #55 sources are supplied", () => {
    expect(rows.lineage).toEqual([]);
  });
});

const ZCTA_TRACT = [
  "GEOID_ZCTA5_20|AREALAND_ZCTA5_20|GEOID_TRACT_20|AREALAND_PART",
  "19104|1000000|42101036900|500000",
  "19104|1000000|42101038800|500000",
].join("\n");
const TRACT_LINEAGE = [
  "GEOID_TRACT_10|AREALAND_TRACT_10|GEOID_TRACT_20|AREALAND_PART",
  "42101036800|4000000|42101036801|2500000",
  "42101036800|4000000|42101036802|1500000",
].join("\n");
const GEOCORR = [
  "geo_pair,child_geoid,child_name,parent_geoid,parent_name,afact,pop20",
  // Overrides the 0.5 relationship-file share above with a population-weighted 0.55.
  'zcta_tract,42101036900,"Census Tract 369",19104,"ZCTA5 19104",0.550,9840',
  'place_county,1304000,"Atlanta city, GA",13121,"Fulton County, GA",0.930,392230',
  'place_county,1304000,"Atlanta city, GA",13089,"DeKalb County, GA",0.070,29520',
].join("\n");

describe("assemble: weighted overlap and lineage (#55)", () => {
  const rows = assemble({
    gazetteers: {},
    zctaTract: ZCTA_TRACT,
    tractLineage: TRACT_LINEAGE,
    geocorr: GEOCORR,
  });

  it("loads area-weighted ZCTA-tract containment from the relationship file", () => {
    const forZcta = rows.containment.filter((c) => c.parentUcgid === ucgidOf("860", "19104"));
    const distinctTracts = new Set(forZcta.map((c) => c.childUcgid));
    expect(distinctTracts.size).toBe(2);
  });

  it("Geocorr's population-weighted share wins over the relationship file for the same edge", () => {
    const row = rows.containment.find(
      (c) =>
        c.childUcgid === ucgidOf("140", "42101036900") && c.parentUcgid === ucgidOf("860", "19104"),
    );
    expect(row?.share).toBe(0.55); // not the relationship file's 0.5
  });

  it("a place crossing counties gets Geocorr shares summing to < 1 per county", () => {
    const fulton = rows.containment.find(
      (c) =>
        c.childUcgid === ucgidOf("160", "1304000") && c.parentUcgid === ucgidOf("050", "13121"),
    );
    const dekalb = rows.containment.find(
      (c) =>
        c.childUcgid === ucgidOf("160", "1304000") && c.parentUcgid === ucgidOf("050", "13089"),
    );
    expect(fulton?.share).toBe(0.93);
    expect(dekalb?.share).toBe(0.07);
  });

  it("a split 2010 tract maps to its 2020 successors", () => {
    const successors = rows.lineage.filter((l) => l.fromUcgid === ucgidOf("140", "42101036800"));
    expect(successors.map((l) => l.toUcgid).sort()).toEqual([
      ucgidOf("140", "42101036801"),
      ucgidOf("140", "42101036802"),
    ]);
    expect(successors.every((l) => l.fromVintage === 2010 && l.toVintage === 2020)).toBe(true);
    expect(successors.reduce((sum, l) => sum + l.share, 0)).toBeCloseTo(1, 6);
  });
});
