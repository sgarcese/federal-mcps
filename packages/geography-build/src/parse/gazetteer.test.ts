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
