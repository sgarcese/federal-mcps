import { ucgidOf } from "@federal-mcps/core";
import { describe, expect, it } from "vitest";
import { parseGazetteer, stripLsad } from "./gazetteer.js";

// A 2-row counties gazetteer fixture (tab-delimited, real column set).
const COUNTIES = [
  "USPS\tGEOID\tANSICODE\tNAME\tALAND\tAWATER\tALAND_SQMI\tAWATER_SQMI\tINTPTLAT\tINTPTLONG",
  "CO\t08031\t00198131\tDenver County\t396915495\t7387001\t153.2\t2.9\t39.762075\t-104.876578",
  "CA\t06075\t00277302\tSan Francisco County\t121455305\t479107241\t46.9\t185.0\t37.752350\t-122.482170",
].join("\n");

describe("parseGazetteer", () => {
  // The 2025 national gazetteers are pipe-delimited with a GEOIDFQ column (Census changed
  // the format); older vintages were tab-delimited. The parser must handle both (#73).
  const STATE_2025_PIPE = [
    "USPS|GEOID|GEOIDFQ|NAME|ALAND|AWATER|ALAND_SQMI|AWATER_SQMI|INTPTLAT|INTPTLONG",
    "AL|01|0400000US01|Alabama|131186429591|4590079330|50651.6|1772.2|32.7794|-86.8287",
    "CO|08|0400000US08|Colorado|268418796417|1181621591|103641.9|456.2|38.9979|-105.5479",
  ].join("\n");

  it("parses the 2025 pipe-delimited gazetteer (with a GEOIDFQ column)", () => {
    const { entities } = parseGazetteer(STATE_2025_PIPE, "040");
    expect(entities).toHaveLength(2);
    const co = entities.find((e) => e.geoid === "08");
    expect(co).toMatchObject({ sumlevel: "040", name: "Colorado", aland: 268_418_796_417 });
    expect(co?.lat).toBeCloseTo(38.9979, 3);
  });

  it("names a ZCTA by its GEOID when the gazetteer has no NAME column (#73)", () => {
    const ZCTA_2025 = [
      "GEOID|GEOIDFQ|ALAND|AWATER|ALAND_SQMI|AWATER_SQMI|INTPTLAT|INTPTLONG",
      "02134|860Z200US02134|4200000|100000|1.6|0.0|42.3552|-71.1289",
    ].join("\n");
    const { entities } = parseGazetteer(ZCTA_2025, "860");
    expect(entities).toHaveLength(1);
    expect(entities[0]).toMatchObject({ geoid: "02134", name: "02134", sumlevel: "860" });
  });

  it("parses entities with derived state FIPS, centroid and land area", () => {
    const { entities } = parseGazetteer(COUNTIES, "050");
    expect(entities).toHaveLength(2);
    const denver = entities.find((e) => e.geoid === "08031");
    expect(denver).toMatchObject({
      sumlevel: "050",
      name: "Denver County",
      stateFips: "08",
      gnis: "00198131",
      aland: 396_915_495,
    });
    expect(denver?.lat).toBeCloseTo(39.762075, 4);
    expect(denver?.lon).toBeCloseTo(-104.876578, 4);
  });

  it("emits an LSAD-stripped alias so the bare name is searchable", () => {
    const { aliases } = parseGazetteer(COUNTIES, "050");
    expect(aliases).toContainEqual({
      ucgid: ucgidOf("050", "08031"),
      alias: "Denver",
      source: "lsad-stripped",
    });
    expect(aliases).toContainEqual({
      ucgid: ucgidOf("050", "06075"),
      alias: "San Francisco",
      source: "lsad-stripped",
    });
  });

  it("maps columns by header name, not position", () => {
    const reordered = [
      "GEOID\tNAME\tINTPTLAT\tINTPTLONG\tALAND",
      "08031\tDenver County\t39.76\t-104.88\t396915495",
    ].join("\n");
    const { entities } = parseGazetteer(reordered, "050");
    expect(entities[0]?.aland).toBe(396_915_495);
    expect(entities[0]?.lat).toBeCloseTo(39.76, 2);
  });
});

describe("stripLsad", () => {
  it.each([
    ["Denver County", "Denver"],
    ["Denver city", "Denver"],
    ["San Francisco County", "San Francisco"],
    [
      "Nashville-Davidson metropolitan government (balance)",
      "Nashville-Davidson metropolitan government (balance)",
    ],
    ["Colorado", "Colorado"],
  ])("%s → %s", (input, expected) => {
    expect(stripLsad(input)).toBe(expected);
  });
});
