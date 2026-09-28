import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createHttpClient,
  GeographyCatalog,
  MemoryBudgetStore,
  MemoryCacheStore,
  type PlaceCandidate,
  resolvePlace,
} from "@federal-mcps/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFixtureCatalog } from "./__fixtures__/build-fixture.js";
import { buildBeaDefinition } from "./definition.js";
import { gdpIndicatorDefinitions } from "./gdp-indicators.js";

/** A resolved-place stand-in: only the fields the indicator's own functions read (mirrors HUD's). */
const place = (sumlevel: string, geoid: string): PlaceCandidate =>
  ({ geoid, kind: { sumlevel, label: "" }, agencyCodes: [] }) as unknown as PlaceCandidate;

const ST_JOSEPH = place("050", "18141");
const INDIANA = place("040", "18");
const SOUTH_BEND_METRO = place("310", "43780");

const gdpDef = gdpIndicatorDefinitions.find((d) => d.name === "gdp");
const realGdpDef = gdpIndicatorDefinitions.find((d) => d.name === "real_gdp");
if (!gdpDef || !realGdpDef) throw new Error("gdpIndicatorDefinitions is missing gdp/real_gdp");

describe("gdp/real_gdp definition shape (#260, ADR-019 §2, §5)", () => {
  it("is exactly two indicators, program GDP, each with one industry dimension defaulting to all", () => {
    expect(gdpIndicatorDefinitions).toHaveLength(2);
    for (const def of [gdpDef, realGdpDef]) {
      expect(def.program).toBe("GDP");
      expect(def.dimensions?.map((d) => d.argument)).toEqual(["industry"]);
      expect(def.dimensions?.[0]?.default).toBe("all");
    }
  });

  it("the industry vocabulary carries all/private plus NAICS codes built from the vendored line list", () => {
    const codes = gdpDef.dimensions?.[0]?.vocabulary.map((v) => v.code) ?? [];
    expect(codes).toContain("all");
    expect(codes).toContain("private");
    expect(codes).toContain("23"); // construction
    expect(codes).toContain("31-33"); // manufacturing
    // Lines with no NAICS parenthetical besides "all"/"private" (91/92) are not vocabulary codes.
    expect(codes).not.toContain("91");
  });

  it("agencyCodeOf: a county is its FIPS, a state SS000, a metro undefined (no BEA metro tables)", () => {
    expect(gdpDef.agencyCodeOf(ST_JOSEPH)).toBe("18141");
    expect(gdpDef.agencyCodeOf(INDIANA)).toBe("18000");
    expect(gdpDef.agencyCodeOf(SOUTH_BEND_METRO)).toBeUndefined();
  });

  it("buildSeriesId: gdp uses CAGDP2/SAGDP2, real_gdp uses CAGDP9/SAGDP9, by geography level", () => {
    expect(
      gdpDef.buildSeriesId("18141", { seasonallyAdjusted: false, dimensions: { industry: "all" } }),
    ).toBe("CAGDP2|1|18141");
    expect(
      gdpDef.buildSeriesId("18000", { seasonallyAdjusted: false, dimensions: { industry: "all" } }),
    ).toBe("SAGDP2|1|18000");
    expect(
      realGdpDef.buildSeriesId("18141", {
        seasonallyAdjusted: false,
        dimensions: { industry: "all" },
      }),
    ).toBe("CAGDP9|1|18141");
    expect(
      realGdpDef.buildSeriesId("18000", {
        seasonallyAdjusted: false,
        dimensions: { industry: "all" },
      }),
    ).toBe("SAGDP9|1|18000");
  });

  it("buildSeriesId: an industry pick resolves to the table's own LineCode (construction → 11)", () => {
    expect(
      gdpDef.buildSeriesId("18141", {
        seasonallyAdjusted: false,
        dimensions: { industry: "23" },
      }),
    ).toBe("CAGDP2|11|18141");
    expect(
      realGdpDef.buildSeriesId("48301", {
        seasonallyAdjusted: false,
        dimensions: { industry: "23" },
      }),
    ).toBe("CAGDP9|11|48301");
  });
});

describe("gdpFetch over recorded fixtures (verified live 2026-09-28)", () => {
  const FIXTURES = fileURLToPath(new URL("../fixtures", import.meta.url));
  const replay = () =>
    createHttpClient({
      source: "bea",
      budget: new MemoryBudgetStore(100),
      cache: new MemoryCacheStore(),
      fixtures: { mode: "replay", dir: FIXTURES },
    });
  const fetchGdp = gdpDef.fetch;
  const fetchRealGdp = realGdpDef.fetch;
  if (!fetchGdp || !fetchRealGdp) throw new Error("gdp/real_gdp have no fetch capability");

  it("St. Joseph County: current-dollar GDP, all industries, newest first", async () => {
    const [result] = await fetchGdp(replay(), ["CAGDP2|1|18141"], { apiKey: "test-key" });
    expect(result?.observations.map((o) => [o.year, o.value])).toEqual([
      ["2024", 19493411],
      ["2023", 18715757],
      ["2022", 17373173],
      ["2021", 16027910],
      ["2020", 14655763],
    ]);
    expect(result?.notes).toContainEqual("Unit: Thousands of dollars.");
  });

  it("St. Joseph County: real GDP, all industries — 2023 is 15,118,595 (thousands of chained 2017 $)", async () => {
    const [result] = await fetchRealGdp(replay(), ["CAGDP9|1|18141"], { apiKey: "test-key" });
    const at2023 = result?.observations.find((o) => o.year === "2023");
    expect(at2023?.value).toBe(15_118_595);
    expect(result?.notes).toContainEqual("Unit: Thousands of chained 2017 dollars.");
    expect(result?.notes).toContainEqual(
      "Real GDP is chain-weighted (2017 dollars); never sum it across industries or across places.",
    );
  });

  it("an industry pick: St. Joseph County construction (current-dollar GDP)", async () => {
    const [result] = await fetchGdp(replay(), ["CAGDP2|11|18141"], { apiKey: "test-key" });
    expect(result?.observations).toHaveLength(5);
    expect(result?.observations.every((o) => typeof o.value === "number")).toBe(true);
  });

  it("Loving County TX construction, real GDP: suppressed (D) → null value with BEA's note, never zero", async () => {
    const [result] = await fetchRealGdp(replay(), ["CAGDP9|11|48301"], { apiKey: "test-key" });
    const at2023 = result?.observations.find((o) => o.year === "2023");
    expect(at2023?.value).toBeNull();
    expect(at2023?.footnotes).toEqual([
      {
        code: "(D)",
        text: "Not shown to avoid disclosure of confidential information; estimates are included in higher-level totals.",
      },
    ]);
    // every year is suppressed for this cell
    expect(result?.observations.every((o) => o.value === null)).toBe(true);
  });

  it("state: Indiana current-dollar GDP, all industries", async () => {
    const [result] = await fetchGdp(replay(), ["SAGDP2|1|18000"], { apiKey: "test-key" });
    const at2023 = result?.observations.find((o) => o.year === "2023");
    expect(at2023?.value).toBe(496_849.5);
    expect(result?.notes).toContainEqual("Unit: Millions of current dollars.");
  });

  it("history: an explicit 2019-2023 range, newest first", async () => {
    const [result] = await fetchGdp(replay(), ["CAGDP2|1|18141"], {
      startYear: 2019,
      endYear: 2023,
      explicitYears: true,
      apiKey: "test-key",
    });
    expect(result?.observations.map((o) => [o.year, o.value])).toEqual([
      ["2023", 18715757],
      ["2022", 17373173],
      ["2021", 16027910],
      ["2020", 14655763],
      ["2019", 15214680],
    ]);
  });

  it("Virginia combination: Albemarle + Charlottesville (51901), current-dollar GDP", async () => {
    const [result] = await fetchGdp(replay(), ["CAGDP2|1|51901"], { apiKey: "test-key" });
    expect(result?.observations).toHaveLength(5);
    const at2023 = result?.observations.find((o) => o.year === "2023");
    expect(at2023?.value).toBe(16_519_881);
  });

  it("compare batching: St. Joseph + Cook in ONE beaGetData call (only that fixture is recorded)", async () => {
    const results = await fetchGdp(replay(), ["CAGDP2|1|18141", "CAGDP2|1|17031"], {
      apiKey: "test-key",
    });
    const byKey = new Map(results.map((r) => [r.seriesId, r]));
    const stJoseph2023 = byKey.get("CAGDP2|1|18141")?.observations.find((o) => o.year === "2023");
    const cook2023 = byKey.get("CAGDP2|1|17031")?.observations.find((o) => o.year === "2023");
    expect(stJoseph2023?.value).toBe(18715757);
    expect(cook2023?.value).toBe(522373564);
  });

  it("sourceOf: the exact key-less GetData URL, with a readable label", () => {
    const src = gdpDef.sourceOf?.("CAGDP2|1|18141", {
      year: "2023",
      period: "A01",
      periodName: "2023",
      value: 18715757,
      footnotes: [],
    });
    expect(src?.url).toBe(
      "https://apps.bea.gov/api/data?method=GetData&datasetname=Regional&TableName=CAGDP2&LineCode=1&GeoFips=18141&Year=2023&ResultFormat=JSON",
    );
    expect(src?.label).toContain("CAGDP2");
    expect(src?.label).toContain("All industry total");
    expect(src?.label).toContain("18141");
  });
});

describe("fallback and caveats over the fixture catalog", () => {
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

  const resolveOne = (name: string, kind: string, state?: string): PlaceCandidate => {
    const resolved = resolvePlace(catalog, name, { kind, ...(state ? { state } : {}) });
    if (resolved.status === "ambiguous" || !resolved.candidates[0]) {
      throw new Error(`fixture catalog: could not resolve ${name}`);
    }
    return resolved.candidates[0];
  };

  it("South Bend city falls back to St. Joseph County with a caveat naming the substitution", () => {
    const southBend = resolveOne("South Bend", "city", "IN");
    const fb = gdpDef.fallback?.(catalog, southBend);
    expect(fb).toMatchObject({
      geoid: "18141",
      name: "St. Joseph County",
      sumlevel: "050",
      code: "18141",
    });
    expect(fb?.caveat).toContain(
      "BEA publishes GDP and real GDP by industry by county, not by city or town",
    );
  });

  it("has no fallback for a direct county, state or metro", () => {
    expect(gdpDef.fallback?.(catalog, ST_JOSEPH)).toBeUndefined();
    expect(gdpDef.fallback?.(catalog, INDIANA)).toBeUndefined();
    expect(gdpDef.fallback?.(catalog, SOUTH_BEND_METRO)).toBeUndefined();
  });

  it("Albemarle County VA: agencyCodeOf and buildSeriesId use the 51901 combination code, and caveatOf names it", () => {
    const albemarle = resolveOne("Albemarle", "county", "VA");
    const code = gdpDef.agencyCodeOf(albemarle);
    expect(code).toBe("51901");
    expect(gdpDef.buildSeriesId(code ?? "", { seasonallyAdjusted: false, dimensions: {} })).toBe(
      "CAGDP2|1|51901",
    );
    expect(gdpDef.caveatOf?.(albemarle, {})).toContain("Albemarle + Charlottesville, VA");
  });
});

describe("bea_get_indicator and bea_compare_places: gdp through the mounted tools (#260 contract examples)", () => {
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

  const FIXTURES = fileURLToPath(new URL("../fixtures", import.meta.url));
  const replay = () =>
    createHttpClient({
      source: "bea",
      budget: new MemoryBudgetStore(100),
      cache: new MemoryCacheStore(),
      fixtures: { mode: "replay", dir: FIXTURES },
    });
  const build = () =>
    buildBeaDefinition({ catalog, httpClient: replay(), apiKey: () => "test-key" });
  const tool = (name: string) => {
    const t = build().tools.find((x) => x.name === name);
    if (!t) throw new Error(`no tool ${name}`);
    return t;
  };
  // biome-ignore lint/suspicious/noExplicitAny: handler args are untyped in tests.
  type AnyArgs = any;
  const go = (name: string, args: Record<string, unknown>) =>
    tool(name).handler(args as AnyArgs, {} as AnyArgs);

  it("mounts bea_get_indicator, bea_compare_places and bea_list_indicators now that gdp exists", () => {
    const names = build().tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "bea_resolve_place",
        "bea_get_indicator",
        "bea_compare_places",
        "bea_list_indicators",
      ]),
    );
  });

  it("bea_get_indicator: St. Joseph County, IN, gdp — value 18,715,757 (2023), required sentence cited", async () => {
    const res = await go("bea_get_indicator", {
      place: "St. Joseph County",
      state: "IN",
      kind: "county",
      indicator: "gdp",
    });
    const data = res.data as { observations: { year: string; value: number | null }[] };
    const at2023 = data.observations.find((o) => o.year === "2023");
    expect(at2023?.value).toBe(18715757);
    expect(res.source.citation).toContain("not endorsed or certified");
  });

  it("bea_compare_places: St. Joseph County, IN vs Cook County, IL, gdp — one row each", async () => {
    const res = await go("bea_compare_places", {
      indicator: "gdp",
      places: ["St. Joseph County, IN", "Cook County, IL"],
    });
    const data = res.data as { rows: { query: string; value: number | null }[] };
    expect(data.rows).toHaveLength(2);
    expect(data.rows.every((r) => typeof r.value === "number")).toBe(true);
  });
});
