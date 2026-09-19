import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createHttpClient,
  GeographyCatalog,
  MemoryBudgetStore,
  MemoryCacheStore,
} from "@federal-mcps/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFixtureCatalog } from "./__fixtures__/build-fixture.js";
import { acsIndicatorDefinitions } from "./acs-indicators.js";
import { buildCensusDefinition } from "./definition.js";
import { describeSource } from "./describe-source.js";
import { censusIndicatorDefinitions } from "./indicators.js";

const FIXTURES = fileURLToPath(new URL("../fixtures", import.meta.url));
const replay = () =>
  createHttpClient({
    source: "census",
    budget: new MemoryBudgetStore(100),
    cache: new MemoryCacheStore(),
    fixtures: { mode: "replay", dir: FIXTURES },
  });

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
const NOW = () => new Date("2026-09-19T00:00:00Z");
const tool = (name: string) => {
  const t = buildCensusDefinition({ catalog, httpClient: replay(), now: NOW }).tools.find(
    (x) => x.name === name,
  );
  if (!t) throw new Error(`no tool ${name}`);
  return t;
};
const go = (name: string, args: Record<string, unknown>) =>
  // biome-ignore lint/suspicious/noExplicitAny: reading the envelope's untyped data in tests.
  tool(name).handler(args as any, {} as any);

describe("acsIndicatorDefinitions (ADR-014 §1): the thirteen headline indicators", () => {
  it("registers each indicator with its verified variable, family and a product dimension", () => {
    const byName = Object.fromEntries(acsIndicatorDefinitions.map((d) => [d.name, d]));
    const expected: Record<string, [string, string]> = {
      population: ["B01003_001", "detailed"],
      median_age: ["B01002_001", "detailed"],
      median_household_income: ["B19013_001", "detailed"],
      per_capita_income: ["B19301_001", "detailed"],
      poverty_rate: ["S1701_C03_001", "subject"],
      unemployment_rate_acs: ["S2301_C04_001", "subject"],
      bachelors_or_higher: ["S1501_C02_015", "subject"],
      uninsured_rate: ["S2701_C05_001", "subject"],
      mean_commute_minutes: ["S0801_C01_046", "subject"],
      median_gross_rent: ["B25064_001", "detailed"],
      median_home_value: ["B25077_001", "detailed"],
      owner_occupied_share: ["DP04_0046P", "profile"],
      median_housing_cost: ["S2503_C01_024", "subject"],
    };
    expect(Object.keys(byName).sort()).toEqual(Object.keys(expected).sort());
    for (const [name, [variable, family]] of Object.entries(expected)) {
      const def = byName[name];
      expect(def?.program).toBe("ACS");
      expect(
        def?.buildSeriesId("1600000US0820000|729019|160", {
          seasonallyAdjusted: false,
          dimensions: { product: "5-year" },
        }),
      ).toBe(`acs:2024:5-year:${family}:${variable}:1600000US0820000`);
      expect(
        def?.dimensions?.find((d) => d.argument === "product")?.vocabulary.map((v) => v.code),
      ).toEqual(["auto", "1-year", "5-year"]);
    }
  });

  it("the aggregate seam carries the thirteen plus decennial_population", () => {
    expect(censusIndicatorDefinitions.map((d) => d.name)).toContain("decennial_population");
    expect(censusIndicatorDefinitions).toHaveLength(14);
  });
});

describe("census_get_indicator end to end over recorded fixtures", () => {
  it("Denver city population: 1-year by population, controlled estimate with no margin, product stated", async () => {
    const res = await go("census_get_indicator", {
      place: "Denver",
      kind: "city",
      indicator: "population",
    });
    expect(res.source.ids).toEqual(["acs:2024:1-year:detailed:B01003_001:1600000US0820000"]);
    const data = res.data as {
      latest: { period: string; value: number };
      observations: { marginOfError: number | null }[];
    };
    expect(data.latest).toEqual({ period: "2024-A01", value: 729019 });
    expect(data.observations[0]?.marginOfError).toBeNull();
    expect(res.limitations?.join(" ")).toMatch(/1-year.*729,019.*65,000/);
    expect(res.source.citation).toMatch(/Census Bureau/);
  });

  it("Sedona median household income: falls to the 5-year product by population, with margin and grade", async () => {
    const res = await go("census_get_indicator", {
      place: "Sedona",
      kind: "city",
      indicator: "median_household_income",
    });
    expect(res.source.ids).toEqual(["acs:2024:5-year:detailed:B19013_001:1600000US0465350"]);
    const data = res.data as {
      latest: { period: string; value: number };
      observations: { marginOfError: number; reliability: string }[];
    };
    expect(data.latest).toEqual({ period: "2024-5Y", value: 73738 });
    expect(data.observations[0]).toMatchObject({ marginOfError: 12737, reliability: "high" });
    expect(res.limitations?.join(" ")).toMatch(/5-year.*9,777.*below.*65,000/);
  });

  it("a 1-year request below the threshold answers with the 5-year figure and says why", async () => {
    const res = await go("census_get_indicator", {
      place: "Sedona",
      kind: "city",
      indicator: "median_household_income",
      product: "1-year",
    });
    expect(res.source.ids[0]).toContain(":5-year:");
    expect(res.limitations?.join(" ")).toMatch(/1-year.*requested.*below/);
  });

  it("Denver County poverty rate from a subject table on an explicit 5-year request", async () => {
    const res = await go("census_get_indicator", {
      place: "Denver",
      kind: "county",
      indicator: "poverty_rate",
      product: "5-year",
    });
    expect((res.data as { latest: { value: number } }).latest.value).toBe(11.2);
    expect(res.limitations?.join(" ")).toMatch(/5-year.*requested/);
  });

  it("an uncomputable tract median is null with the Census meaning; a low-reliability tract is graded", async () => {
    const bad = await go("census_get_indicator", {
      place: "Census Tract 9800.01",
      indicator: "median_household_income",
    });
    expect(
      (bad.data as { latest: { value: number | null } | null }).latest?.value ?? null,
    ).toBeNull();
    expect(bad.footnotes?.map((f) => f.text).join(" ")).toMatch(/could not be computed/);
    const low = await go("census_get_indicator", {
      place: "Census Tract 5.03",
      indicator: "median_household_income",
    });
    expect(
      (low.data as { observations: { reliability: string }[] }).observations[0]?.reliability,
    ).toBe("low");
    expect(low.footnotes?.map((f) => f.text).join(" ")).toMatch(/low reliability/);
  });

  it("decennial_population reads the 2020 redistricting count with no margin", async () => {
    const res = await go("census_get_indicator", {
      place: "Denver",
      kind: "county",
      indicator: "decennial_population",
    });
    expect(res.source.ids).toEqual(["dec:2020:P1_001N:0500000US08031"]);
    expect((res.data as { latest: { value: number } }).latest.value).toBe(715522);
    expect(res.source.program).toBe("DEC");
  });

  it("census_list_indicators lists all fourteen with the product vocabulary; describe_source is available", async () => {
    const res = await go("census_list_indicators", {});
    const data = res.data as {
      indicators: { indicator: string; dimensions?: { argument: string }[] }[];
    };
    expect(data.indicators).toHaveLength(14);
    expect(
      data.indicators.find((i) => i.indicator === "population")?.dimensions?.[0]?.argument,
    ).toBe("product");
    const d = describeSource();
    for (const code of ["ACS1", "ACS5", "DEC"])
      expect(d.programs.find((p) => p.code === code)?.status).toBe("available");
  });
});
