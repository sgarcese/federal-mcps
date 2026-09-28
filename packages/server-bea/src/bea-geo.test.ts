import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { GeographyCatalog, type PlaceCandidate, resolvePlace } from "@federal-mcps/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFixtureCatalog } from "./__fixtures__/build-fixture.js";
import {
  beaCountyFallback,
  beaCountyFips,
  beaMetroFallback,
  beaMetroFips,
  beaStateFips,
  combinationCaveat,
  connecticutNote,
} from "./bea-geo.js";

let path: string;
let catalog: GeographyCatalog;
beforeAll(() => {
  path = buildFixtureCatalog();
  catalog = new GeographyCatalog(path);
});
afterAll(() => {
  catalog.close();
  rmSync(dirname(path), { recursive: true, force: true });
});

const one = (name: string, kind: string, state?: string): PlaceCandidate => {
  const r = resolvePlace(catalog, name, { kind, ...(state ? { state } : {}) });
  const top = r.candidates[0];
  if (!top) throw new Error(`fixture: ${name} did not resolve`);
  return top;
};

describe("GeoFips from the catalog (#253 seam, ADR-019 §6)", () => {
  it("a county is its FIPS; a state SS000; a metro its CBSA", () => {
    expect(beaCountyFips(one("St. Joseph County", "county", "IN"))).toBe("18141");
    expect(beaStateFips(one("Indiana", "state", "IN"))).toBe("18000");
    expect(beaMetroFips(one("South Bend", "metro"))).toBe("43780");
    expect(beaCountyFips(one("Indiana", "state", "IN"))).toBeUndefined();
  });

  it("a Virginia component county or city answers as its combination, with a caveat naming it", () => {
    const albemarle = one("Albemarle County", "county", "VA");
    expect(beaCountyFips(albemarle)).toBe("51901");
    expect(combinationCaveat(albemarle)).toMatch(/Albemarle \+ Charlottesville/);
    expect(beaCountyFips(one("Charlottesville", "county", "VA"))).toBe("51901");
    expect(combinationCaveat(one("St. Joseph County", "county", "IN"))).toBeUndefined();
  });
});

describe("fallbacks", () => {
  it("a city answers with its county, said in the caveat", () => {
    const fb = beaCountyFallback(catalog, one("South Bend", "city", "IN"), "personal income");
    expect(fb).toMatchObject({ geoid: "18141", code: "18141", sumlevel: "050" });
    expect(fb?.caveat).toMatch(/by county, not by city.*St\. Joseph County/);
  });

  it("a Virginia independent city's place answers with the combination", () => {
    const fb = beaCountyFallback(catalog, one("Charlottesville", "city", "VA"), "personal income");
    expect(fb?.code).toBe("51901");
    expect(fb?.caveat).toMatch(/only combined/);
  });

  it("a county or a city answers with its metro for metro-only statistics", () => {
    expect(
      beaMetroFallback(
        catalog,
        one("St. Joseph County", "county", "IN"),
        "regional price parities",
      ),
    ).toMatchObject({ code: "43780", sumlevel: "310" });
    expect(
      beaMetroFallback(catalog, one("Denver", "city", "CO"), "regional price parities")?.code,
    ).toBe("19740");
    expect(
      beaMetroFallback(catalog, one("Loving County", "county", "TX"), "regional price parities"),
    ).toBeUndefined();
  });

  it("a micropolitan county has no metro fallback (BEA's metro tables cover metropolitan areas only)", () => {
    expect(
      beaMetroFallback(catalog, one("Marshall County", "county", "IN"), "regional price parities"),
    ).toBeUndefined();
    expect(
      beaMetroFallback(catalog, one("Cook County", "county", "IL"), "regional price parities")
        ?.code,
    ).toBe("16980");
  });

  it("no fallback for a county (county statistics) or a state", () => {
    expect(
      beaCountyFallback(catalog, one("St. Joseph County", "county", "IN"), "x"),
    ).toBeUndefined();
    expect(beaMetroFallback(catalog, one("Indiana", "state", "IN"), "x")).toBeUndefined();
  });
});

describe("Connecticut from 2024 (ADR-019 §6)", () => {
  it("years before 2024 for a planning region earn the note; 2024 on, or other places, do not", () => {
    expect(connecticutNote("09110", 2020)).toMatch(/from 2024.*former counties end in 2023/);
    expect(connecticutNote("09110", 2024)).toBeUndefined();
    expect(connecticutNote("18141", 2020)).toBeUndefined();
    expect(connecticutNote("09110", undefined)).toBeUndefined();
  });
});
