import { ucgidOf } from "@federal-mcps/core";
import { describe, expect, it } from "vitest";
import { parseAcsPopulation } from "./acs-population.js";

describe("parseAcsPopulation", () => {
  it("parses a state row (get=NAME,B01003_001E,for=state:*)", () => {
    const json = [
      ["NAME", "B01003_001E", "state"],
      ["Colorado", "5957493", "08"],
    ];
    expect(parseAcsPopulation(json, "040")).toEqual([
      { ucgid: ucgidOf("040", "08"), population: 5_957_493 },
    ]);
  });

  it("parses a county row, building the GEOID from state + county", () => {
    const json = [
      ["NAME", "B01003_001E", "state", "county"],
      ["Denver County, Colorado", "715522", "08", "031"],
    ];
    expect(parseAcsPopulation(json, "050")).toEqual([
      { ucgid: ucgidOf("050", "08031"), population: 715_522 },
    ]);
  });

  it("parses a place row, building the GEOID from state + place", () => {
    const json = [
      ["NAME", "B01003_001E", "state", "place"],
      ["Denver city, Colorado", "729019", "08", "20000"],
    ];
    expect(parseAcsPopulation(json, "160")).toEqual([
      { ucgid: ucgidOf("160", "0820000"), population: 729_019 },
    ]);
  });

  it("parses a CBSA row keyed by the metro/micro column", () => {
    const json = [
      ["NAME", "B01003_001E", "metropolitan statistical area/micropolitan statistical area"],
      ["Denver-Aurora-Centennial, CO Metro Area", "3005131", "19740"],
    ];
    expect(parseAcsPopulation(json, "310")).toEqual([
      { ucgid: ucgidOf("310", "19740"), population: 3_005_131 },
    ]);
  });

  it("parses a ZCTA row keyed by the zip code tabulation area column", () => {
    const json = [
      ["NAME", "B01003_001E", "zip code tabulation area"],
      ["ZCTA5 80202", "17820", "80202"],
    ];
    expect(parseAcsPopulation(json, "860")).toEqual([
      { ucgid: ucgidOf("860", "80202"), population: 17_820 },
    ]);
  });

  it("parses region and division rows", () => {
    const regionJson = [
      ["NAME", "B01003_001E", "region"],
      ["Region 4", "78588572", "4"],
    ];
    expect(parseAcsPopulation(regionJson, "020")).toEqual([
      { ucgid: ucgidOf("020", "4"), population: 78_588_572 },
    ]);
    const divisionJson = [
      ["NAME", "B01003_001E", "division"],
      ["Mountain Division", "14751527", "8"],
    ];
    expect(parseAcsPopulation(divisionJson, "030")).toEqual([
      { ucgid: ucgidOf("030", "8"), population: 14_751_527 },
    ]);
  });

  it("maps sentinel values to a null population", () => {
    const json = [
      ["NAME", "B01003_001E", "state"],
      ["Somewhere", "-666666666", "99"],
      ["Somewhere Else", "-999999999", "98"],
      ["Yet Another", "-888888888", "97"],
    ];
    expect(parseAcsPopulation(json, "040")).toEqual([
      { ucgid: ucgidOf("040", "99"), population: null },
      { ucgid: ucgidOf("040", "98"), population: null },
      { ucgid: ucgidOf("040", "97"), population: null },
    ]);
  });

  it("maps a JSON null value to a null population", () => {
    const json: (string | null)[][] = [
      ["NAME", "B01003_001E", "state"],
      ["Somewhere", null, "96"],
    ];
    expect(parseAcsPopulation(json, "040")).toEqual([
      { ucgid: ucgidOf("040", "96"), population: null },
    ]);
  });

  it("returns an empty array for an empty or header-only response", () => {
    expect(parseAcsPopulation([], "040")).toEqual([]);
    expect(parseAcsPopulation([["NAME", "B01003_001E", "state"]], "040")).toEqual([]);
  });

  it("throws when the header lacks B01003_001E", () => {
    expect(() => parseAcsPopulation([["NAME", "state"]], "040")).toThrow(/B01003_001E/);
  });
});
