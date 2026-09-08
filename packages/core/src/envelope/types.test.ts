import { describe, expect, it } from "vitest";
import { buildCitation, footnoteFlagsFromCode, placeRef } from "./types.js";

describe("placeRef", () => {
  it("derives ucgid and dcid for a county (Denver County example from #4)", () => {
    const denver = placeRef({
      geoid: "08031",
      sumlevel: "050",
      label: "County",
      name: "Denver County, Colorado",
    });

    expect(denver.geoid).toBe("08031");
    expect(denver.ucgid).toBe("0500000US08031");
    expect(denver.dcid).toBe("geoId/08031");
    expect(denver.kind).toEqual({ sumlevel: "050", label: "County" });
    expect(denver.parents).toEqual([]);
  });

  it("derives a CBSA dcid with the C prefix", () => {
    const denverMetro = placeRef({
      geoid: "19740",
      sumlevel: "310",
      label: "Metropolitan Statistical Area",
      name: "Denver-Aurora-Lakewood, CO",
    });

    expect(denverMetro.ucgid).toBe("3100000US19740");
    expect(denverMetro.dcid).toBe("geoId/C19740");
  });

  it("derives a ZCTA dcid using the zip/ prefix", () => {
    const zcta = placeRef({
      geoid: "80202",
      sumlevel: "860",
      label: "ZIP Code Tabulation Area",
      name: "ZCTA5 80202",
    });

    expect(zcta.ucgid).toBe("8600000US80202");
    expect(zcta.dcid).toBe("zip/80202");
  });

  it("keeps parents shallow (parents of parents are empty)", () => {
    const colorado = placeRef({
      geoid: "08",
      sumlevel: "040",
      label: "State",
      name: "Colorado",
    });
    const denver = placeRef({
      geoid: "08031",
      sumlevel: "050",
      label: "County",
      name: "Denver County, Colorado",
      parents: [colorado],
    });

    expect(denver.parents).toEqual([colorado]);
    expect(denver.parents[0]?.parents).toEqual([]);
  });

  it("carries an optional caveat", () => {
    const place = placeRef({
      geoid: "08031",
      sumlevel: "050",
      label: "County",
      name: "Denver County, Colorado",
      caveat: "Below the LAUS 25,000 threshold",
    });
    expect(place.caveat).toBe("Below the LAUS 25,000 threshold");
  });

  it("allows explicit ucgid/dcid overrides", () => {
    const place = placeRef({
      geoid: "99999",
      sumlevel: "050",
      label: "County",
      name: "Made Up County",
      ucgid: "0500000US99999X",
      dcid: "geoId/99999X",
    });
    expect(place.ucgid).toBe("0500000US99999X");
    expect(place.dcid).toBe("geoId/99999X");
  });
});

describe("buildCitation", () => {
  it("builds a ready-to-paste citation for BLS LAUS", () => {
    const citation = buildCitation(
      {
        agency: "bls",
        program: "Local Area Unemployment Statistics",
        ids: ["LAUCN080310000000003"],
        url: "https://api.bls.gov/publicAPI/v2/timeseries/data/",
        citation: "",
      },
      new Date("2026-09-08T12:00:00Z"),
    );

    expect(citation).toBe(
      "U.S. Bureau of Labor Statistics, Local Area Unemployment Statistics, series LAUCN080310000000003. " +
        "Retrieved 2026-09-08 from https://api.bls.gov/publicAPI/v2/timeseries/data/",
    );
  });

  it("joins multiple series ids", () => {
    const citation = buildCitation(
      {
        agency: "census",
        program: "American Community Survey",
        ids: ["B01001_001E", "B01001_002E"],
        url: "https://api.census.gov/data",
        citation: "",
      },
      new Date("2026-09-08T00:00:00Z"),
    );
    expect(citation).toContain("series B01001_001E, B01001_002E");
    expect(citation).toContain("U.S. Census Bureau, American Community Survey");
  });

  it("falls back to the agency code when the agency is unknown", () => {
    const citation = buildCitation(
      {
        agency: "hud",
        program: "Fair Market Rents",
        ids: ["X"],
        url: "https://example.gov",
        citation: "",
      },
      new Date("2026-09-08T00:00:00Z"),
    );
    expect(citation.startsWith("hud, Fair Market Rents")).toBe(true);
  });
});

describe("footnoteFlagsFromCode", () => {
  it("maps BLS P to preliminary", () => {
    expect(footnoteFlagsFromCode("P")).toEqual(["preliminary"]);
  });

  it("maps BLS R to revised", () => {
    expect(footnoteFlagsFromCode("R")).toEqual(["revised"]);
  });

  it("maps a dash to unavailable", () => {
    expect(footnoteFlagsFromCode("-")).toEqual(["unavailable"]);
  });

  it("maps (D) to suppressed", () => {
    expect(footnoteFlagsFromCode("(D)")).toEqual(["suppressed"]);
  });

  it("maps an unknown code to no flags", () => {
    expect(footnoteFlagsFromCode("Z")).toEqual([]);
  });
});
