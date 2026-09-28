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
    // Gazetteer entities plus the 4 regions and 9 divisions the build always adds (#154).
    const gazetteer = rows.entities.filter((e) => !["020", "030"].includes(e.sumlevel));
    expect(gazetteer.map((e) => e.geoid).sort()).toEqual(["08", "08031", "0820000"]);
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

  it("adds Census regions (020) and divisions (030) with state → division → region nesting (#154)", () => {
    const west = rows.entities.find((e) => e.ucgid === ucgidOf("020", "4"));
    const mountain = rows.entities.find((e) => e.ucgid === ucgidOf("030", "8"));
    expect(west).toMatchObject({ sumlevel: "020", name: "West", stateFips: null });
    expect(mountain).toMatchObject({ sumlevel: "030", name: "Mountain" });
    expect(rows.entities.filter((e) => e.sumlevel === "020")).toHaveLength(4);
    expect(rows.entities.filter((e) => e.sumlevel === "030")).toHaveLength(9);
    expect(rows.containment).toContainEqual({
      childUcgid: ucgidOf("040", "08"),
      parentUcgid: ucgidOf("030", "8"),
      share: 1,
      relation: "nests",
    });
    expect(rows.containment).toContainEqual({
      childUcgid: ucgidOf("030", "8"),
      parentUcgid: ucgidOf("020", "4"),
      share: 1,
      relation: "nests",
    });
    expect(rows.aliases).toContainEqual({
      ucgid: ucgidOf("030", "8"),
      alias: "Mountain division",
      source: "hand",
    });
  });

  it("attaches QCEW metro C-codes from area_titles.csv when supplied (#153)", () => {
    const withQcew = assemble({
      gazetteers: { "040": STATES, "050": COUNTIES, "160": PLACES },
      qcewArea: '"area_fips","area_title"\n"C1974","Denver-Aurora-Centennial, CO MSA"',
    });
    expect(withQcew.agencyCodes).toContainEqual(
      expect.objectContaining({ ucgid: ucgidOf("310", "19740"), program: "QCEW", code: "C1974" }),
    );
  });

  it("has no lineage or weighted overlap when no #55 sources are supplied", () => {
    expect(rows.lineage).toEqual([]);
  });
});

describe("assemble: ACS population (#172)", () => {
  it("sets population and populationVintage from sources.acsPopulation, by summary level", () => {
    const stateJson = JSON.stringify([
      ["NAME", "B01003_001E", "state"],
      ["Colorado", "5957493", "08"],
    ]);
    const countyJson = JSON.stringify([
      ["NAME", "B01003_001E", "state", "county"],
      ["Denver County, Colorado", "715522", "08", "031"],
    ]);
    const rows = assemble({
      gazetteers: { "040": STATES, "050": COUNTIES, "160": PLACES },
      acsPopulation: { "040": stateJson, "050": countyJson },
    });
    const colorado = rows.entities.find((e) => e.ucgid === ucgidOf("040", "08"));
    expect(colorado).toMatchObject({ population: 5_957_493, populationVintage: "2024" });
    const denverCounty = rows.entities.find((e) => e.ucgid === ucgidOf("050", "08031"));
    expect(denverCounty).toMatchObject({ population: 715_522, populationVintage: "2024" });
  });

  it("leaves entities with no matching ACS row at null population", () => {
    const stateJson = JSON.stringify([
      ["NAME", "B01003_001E", "state"],
      ["Colorado", "5957493", "08"],
    ]);
    const rows = assemble({
      gazetteers: { "040": STATES, "050": COUNTIES, "160": PLACES },
      acsPopulation: { "040": stateJson },
    });
    const denverCounty = rows.entities.find((e) => e.ucgid === ucgidOf("050", "08031"));
    expect(denverCounty?.population ?? null).toBeNull();
  });

  it("carries a null population through for a sentinel ACS row", () => {
    const stateJson = JSON.stringify([
      ["NAME", "B01003_001E", "state"],
      ["Colorado", "-666666666", "08"],
    ]);
    const rows = assemble({
      gazetteers: { "040": STATES, "050": COUNTIES, "160": PLACES },
      acsPopulation: { "040": stateJson },
    });
    const colorado = rows.entities.find((e) => e.ucgid === ucgidOf("040", "08"));
    expect(colorado).toMatchObject({ population: null, populationVintage: "2024" });
  });

  it("does not touch population when no acsPopulation source is supplied", () => {
    const rows = assemble({
      gazetteers: { "040": STATES, "050": COUNTIES, "160": PLACES },
    });
    const colorado = rows.entities.find((e) => e.ucgid === ucgidOf("040", "08"));
    expect(colorado?.population ?? null).toBeNull();
    expect(colorado?.populationVintage ?? null).toBeNull();
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

describe("assemble: county subdivisions (#241)", () => {
  const H =
    "USPS|GEOID|GEOIDFQ|ANSICODE|NAME|FUNCSTAT|ALAND|AWATER|ALAND_SQMI|AWATER_SQMI|INTPTLAT|INTPTLONG";
  const cs = (
    usps: string,
    geoid: string,
    ansi: string,
    name: string,
    func: string,
    aland: number,
  ) => `${usps}|${geoid}|0600000US${geoid}|${ansi}|${name}|${func}|${aland}|0|0|0|0|0`;
  const COUSUBS = [
    H,
    cs("MA", "2502507000", "00619463", "Boston city", "A", 125_000_000),
    cs("CT", "0911037070", "00213442", "Hartford town", "C", 45_093_709),
    cs("CT", "0911022630", "00213424", "East Hartford town", "A", 46_638_315),
    cs("OH", "3904918000", "01086101", "Columbus city", "A", 540_000_000),
    cs("OH", "3904518000", "01086102", "Columbus city", "A", 60_000_000),
    cs("PA", "4201916920", "01216544", "Cranberry township", "A", 59_000_000),
    cs("CO", "0803190000", "01935000", "Denver CCD", "S", 396_000_000),
  ].join("\n");
  const COUSUBS_2020 = [
    "USPS\tGEOID\tANSICODE\tNAME\tFUNCSTAT\tALAND\tAWATER\tALAND_SQMI\tAWATER_SQMI\tINTPTLAT\tINTPTLONG",
    "CT\t0900337070\t00213442\tHartford town\tC\t45012647\t0\t0\t0\t0\t0",
    "CT\t0900322630\t00213424\tEast Hartford town\tA\t46638316\t0\t0\t0\t0\t0",
    "MA\t2502507000\t00619463\tBoston city\tA\t125000000\t0\t0\t0\t0\t0",
  ].join("\n");
  const ST = [
    "USPS\tGEOID\tANSICODE\tNAME\tALAND\tAWATER\tINTPTLAT\tINTPTLONG",
    "MA\t25\t1\tMassachusetts\t1\t1\t0\t0",
    "CT\t09\t1\tConnecticut\t1\t1\t0\t0",
    "OH\t39\t1\tOhio\t1\t1\t0\t0",
    "PA\t42\t1\tPennsylvania\t1\t1\t0\t0",
    "CO\t08\t1\tColorado\t1\t1\t0\t0",
  ].join("\n");
  const CO = [
    "USPS\tGEOID\tANSICODE\tNAME\tALAND\tAWATER\tINTPTLAT\tINTPTLONG",
    "MA\t25025\t1\tSuffolk County\t1\t1\t0\t0",
    "CT\t09110\t1\tCapitol Planning Region\t1\t1\t0\t0",
    "OH\t39049\t1\tFranklin County\t1\t1\t0\t0",
    "OH\t39045\t1\tFairfield County\t1\t1\t0\t0",
    "PA\t42019\t1\tButler County\t1\t1\t0\t0",
    "CO\t08031\t1\tDenver County\t1\t1\t0\t0",
  ].join("\n");
  const PL = [
    "USPS\tGEOID\tANSICODE\tNAME\tLSAD\tFUNCSTAT\tALAND\tAWATER\tINTPTLAT\tINTPTLONG",
    "MA\t2507000\t1\tBoston city\t25\tA\t125000000\t1\t0\t0",
    "CT\t0937000\t1\tHartford city\t25\tA\t45000000\t1\t0\t0",
    "OH\t3918000\t1\tColumbus city\t25\tA\t600000000\t1\t0\t0",
    "CO\t0820000\t1\tDenver city\t25\tA\t396000000\t1\t0\t0",
  ].join("\n");
  const LA = [
    "area_type_code\tarea_code\tarea_text\tdisplay_level\tselectable\tsort_sequence",
    "G\tCS4216920000000\tCranberry township (Butler County), PA\t0\tT\t1",
    "G\tCS2507000000000\tBoston city, MA\t0\tT\t2",
    "H\tCS2599999000000\tNowhere town, MA\t0\tT\t3",
  ].join("\n");
  const rows = assemble({
    gazetteers: { "040": ST, "050": CO, "160": PL, "060": COUSUBS },
    cousubs2020: COUSUBS_2020,
    lausArea: LA,
  });
  const edge = (child: string, parent: string) =>
    rows.containment.find((c) => c.childUcgid === child && c.parentUcgid === parent);
  const T = (g: string) => ucgidOf("060", g);
  const P = (g: string) => ucgidOf("160", g);

  it("adds every county subdivision with its functional status and a bare-name alias", () => {
    const cranberry = rows.entities.find((e) => e.ucgid === T("4201916920"));
    expect(cranberry).toMatchObject({
      sumlevel: "060",
      name: "Cranberry township",
      funcstat: "A",
      stateFips: "42",
    });
    expect(rows.aliases).toContainEqual({
      ucgid: T("4201916920"),
      alias: "Cranberry",
      source: "lsad-stripped",
    });
    expect(rows.aliases).toContainEqual({
      ucgid: T("0911037070"),
      alias: "Hartford",
      source: "lsad-stripped",
    });
  });

  it("does not strip 'CCD': a statistical county division never becomes a bare-name match", () => {
    expect(rows.aliases.some((a) => a.ucgid === T("0803190000"))).toBe(false);
  });

  it("nests every county subdivision in its county and state (share 1)", () => {
    expect(edge(T("4201916920"), ucgidOf("050", "42019"))).toMatchObject({
      share: 1,
      relation: "nests",
    });
    expect(edge(T("4201916920"), ucgidOf("040", "42"))).toMatchObject({
      share: 1,
      relation: "nests",
    });
  });

  it("links a place to the county subdivision that shares its state and code (Boston)", () => {
    expect(edge(P("2507000"), T("2502507000"))).toMatchObject({ share: 1, relation: "nests" });
  });

  it("splits a city across its same-code county subdivisions by land share (Columbus, OH)", () => {
    expect(edge(P("3918000"), T("3904918000"))?.share).toBeCloseTo(0.9, 6);
    expect(edge(P("3918000"), T("3904518000"))?.share).toBeCloseTo(0.1, 6);
  });

  it("pairs a consolidated town with its city when the state has exactly one of each by name (Hartford)", () => {
    expect(edge(P("0937000"), T("0911037070"))).toMatchObject({ share: 1, relation: "nests" });
    // East Hartford town is not consolidated and has no city twin: no edge from Hartford city.
    expect(edge(P("0937000"), T("0911022630"))).toBeUndefined();
  });

  it("maps LAUS county-subdivision codes (CS + state + town code, no county) onto the town (#241)", () => {
    const laus = (g: string) =>
      rows.agencyCodes.find((a) => a.ucgid === T(g) && a.program === "LAUS");
    expect(laus("4201916920")?.code).toBe("CS4216920000000");
    expect(laus("2502507000")?.code).toBe("CS2507000000000");
    // A CS code with no matching town maps to nothing, never to a guess.
    expect(rows.agencyCodes.some((a) => a.code === "CS2599999000000")).toBe(false);
  });

  it("carries a recoded county subdivision's 2020 GEOID, joined by ANSI code (Connecticut)", () => {
    expect(rows.agencyCodes).toContainEqual(
      expect.objectContaining({
        ucgid: T("0911037070"),
        agency: "census",
        program: "GEOID2020",
        code: "0900337070",
        codeVintage: 2020,
      }),
    );
    // An unchanged GEOID (Boston) carries no 2020 row.
    expect(
      rows.agencyCodes.some((a) => a.ucgid === T("2502507000") && a.program === "GEOID2020"),
    ).toBe(false);
  });
});

describe("assemble: BEA combination codes (#257)", () => {
  const CO = [
    "USPS\tGEOID\tANSICODE\tNAME\tALAND\tAWATER\tINTPTLAT\tINTPTLONG",
    "VA\t51003\t1\tAlbemarle County\t1\t1\t0\t0",
    "VA\t51540\t1\tCharlottesville city\t1\t1\t0\t0",
  ].join("\n");
  const rows = assemble({
    gazetteers: { "050": CO },
    beaGeoFips: JSON.stringify({
      BEAAPI: {
        Results: { ParamValue: [{ Key: "51901", Desc: "Albemarle + Charlottesville, VA*" }] },
      },
    }),
  });
  it("attaches the combination code to each component", () => {
    const codes = rows.agencyCodes.filter((a) => a.agency === "bea");
    expect(codes.map((a) => [a.ucgid, a.code]).sort()).toEqual([
      [ucgidOf("050", "51003"), "51901"],
      [ucgidOf("050", "51540"), "51901"],
    ]);
  });
});
