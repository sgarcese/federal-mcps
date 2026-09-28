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
import { beaBodyError, sanitizeBeaBody } from "./bea-api.js";
import { BEA_REQUIRED_SENTENCE } from "./describe-source.js";
import { buildBeaDefinition } from "./definition.js";
import { piIndicatorDefinitions } from "./pi-indicators.js";

/** A resolved-place stand-in: only the fields the indicator's own functions read. */
const place = (
  sumlevel: string,
  geoid: string,
  agencyCodes?: { agency: string; program: string; code: string; note?: string }[],
): PlaceCandidate =>
  ({ geoid, kind: { sumlevel, label: "" }, agencyCodes }) as unknown as PlaceCandidate;

const ST_JOSEPH = place("050", "18141");
const INDIANA = place("040", "18");
const SOUTH_BEND_METRO = place("310", "43780");
const ALBEMARLE = place("050", "51003", [
  { agency: "bea", program: "GEOFIPS", code: "51901", note: "BEA publishes this area combined." },
]);

const [personalIncome, perCapita] = piIndicatorDefinitions;
if (!personalIncome || !perCapita)
  throw new Error("piIndicatorDefinitions is missing an indicator");

describe("personal income definition shape (#259, ADR-019 §2, §5, §6)", () => {
  it("is two indicators, program PI, each with a frequency dimension defaulting to annual", () => {
    expect(piIndicatorDefinitions).toHaveLength(2);
    expect(piIndicatorDefinitions.map((d) => d.name)).toEqual([
      "personal_income",
      "per_capita_personal_income",
    ]);
    for (const def of piIndicatorDefinitions) {
      expect(def.program).toBe("PI");
      expect(def.dimensions?.map((d) => d.argument)).toEqual(["frequency"]);
      expect(def.dimensions?.[0]?.default).toBe("annual");
      expect(def.dimensions?.[0]?.vocabulary.map((v) => v.code)).toEqual(["annual", "quarterly"]);
    }
  });

  it("agencyCodeOf: county → its FIPS, state → SS000, metro → undefined (out of scope)", () => {
    expect(personalIncome.agencyCodeOf(ST_JOSEPH)).toBe("18141");
    expect(personalIncome.agencyCodeOf(INDIANA)).toBe("18000");
    expect(personalIncome.agencyCodeOf(SOUTH_BEND_METRO)).toBeUndefined();
  });

  it("buildSeriesId: table follows the geoFips shape and the resolved frequency", () => {
    expect(
      personalIncome.buildSeriesId("18141", { seasonallyAdjusted: false, dimensions: {} }),
    ).toBe("CAINC1|1|18141|annual");
    expect(
      personalIncome.buildSeriesId("18000", {
        seasonallyAdjusted: false,
        dimensions: { frequency: "annual" },
      }),
    ).toBe("SAINC1|1|18000|annual");
    expect(
      personalIncome.buildSeriesId("18000", {
        seasonallyAdjusted: false,
        dimensions: { frequency: "quarterly" },
      }),
    ).toBe("SQINC1|1|18000|quarterly");
    // A county asking quarterly is tagged with the sentinel table, not silently answered annual.
    expect(
      personalIncome.buildSeriesId("18141", {
        seasonallyAdjusted: false,
        dimensions: { frequency: "quarterly" },
      }),
    ).toBe("COUNTY_QUARTERLY_UNAVAILABLE|1|18141|quarterly");
  });

  it("caveatOf: a Virginia combination county carries its note; an uncombined place does not", () => {
    expect(personalIncome.caveatOf?.(ALBEMARLE, {})).toBe("BEA publishes this area combined.");
    expect(personalIncome.caveatOf?.(ST_JOSEPH, {})).toBeUndefined();
  });

  it("unavailableNote: names why a metro area has no series", () => {
    expect(personalIncome.unavailableNote?.(SOUTH_BEND_METRO)).toMatch(/metropolitan area/);
    expect(personalIncome.unavailableNote?.(ST_JOSEPH)).toBeUndefined();
  });
});

describe("fallback: a city or town answers with its county (#259)", () => {
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

  it("South Bend city falls back to St. Joseph County with a caveat", () => {
    const southBend = resolveOne("South Bend", "city", "IN");
    const fb = personalIncome.fallback?.(catalog, southBend);
    expect(fb).toMatchObject({
      geoid: "18141",
      name: "St. Joseph County",
      sumlevel: "050",
      code: "18141",
    });
    expect(fb?.caveat).toMatch(/by county, not by city or town/);
  });

  it("Albemarle County resolved directly carries its combination code and caveat", () => {
    const albemarle = resolveOne("Albemarle", "county", "VA");
    expect(personalIncome.agencyCodeOf(albemarle)).toBe("51901");
    expect(personalIncome.caveatOf?.(albemarle, {})).toMatch(/51901/);
  });
});

describe("piFetch over recorded fixtures (verified live 2026-09-28)", () => {
  const FIXTURES = fileURLToPath(new URL("../fixtures", import.meta.url));
  const replay = () =>
    createHttpClient({
      source: "bea",
      budget: new MemoryBudgetStore(100),
      cache: new MemoryCacheStore(),
      fixtures: { mode: "replay", dir: FIXTURES },
      sanitize: sanitizeBeaBody,
      bodyError: beaBodyError,
    });
  const fetchPi = personalIncome.fetch;
  const fetchPerCapita = perCapita.fetch;
  if (!fetchPi || !fetchPerCapita) throw new Error("a PI indicator has no fetch capability");

  it("St. Joseph County, personal_income, no explicit years: keeps only the newest (2024)", async () => {
    const [result] = await fetchPi(
      replay(),
      [personalIncome.buildSeriesId("18141", { seasonallyAdjusted: false, dimensions: {} })],
      { apiKey: "test-key" },
    );
    expect(result?.observations).toEqual([
      { year: "2024", period: "A01", periodName: "2024", value: 16159152, footnotes: [] },
    ]);
    expect(result?.notes?.some((n) => n.startsWith("BEA: Last updated"))).toBe(true);
    expect(result?.notes).toContainEqual("Unit: Thousands of dollars.");
  });

  it("St. Joseph County, per_capita_personal_income, 2021-2024: newest first, matches verified figures", async () => {
    const [result] = await fetchPerCapita(
      replay(),
      [perCapita.buildSeriesId("18141", { seasonallyAdjusted: false, dimensions: {} })],
      { startYear: 2021, endYear: 2024, explicitYears: true, apiKey: "test-key" },
    );
    expect(result?.observations.map((o) => [o.year, o.value])).toEqual([
      ["2024", 59030],
      ["2023", 56869],
      ["2022", 56225],
      ["2021", 55841],
    ]);
  });

  it("Indiana, personal_income, annual, no explicit years: SAINC1, newest year kept", async () => {
    const [result] = await fetchPi(
      replay(),
      [personalIncome.buildSeriesId("18000", { seasonallyAdjusted: false, dimensions: {} })],
      { apiKey: "test-key" },
    );
    expect(result?.observations).toEqual([
      { year: "2025", period: "A01", periodName: "2025", value: 462278.6, footnotes: [] },
    ]);
  });

  it("Indiana, per_capita_personal_income, quarterly, 2026: SQINC1, 2026Q1 = 67272", async () => {
    const [result] = await fetchPerCapita(
      replay(),
      [
        perCapita.buildSeriesId("18000", {
          seasonallyAdjusted: false,
          dimensions: { frequency: "quarterly" },
        }),
      ],
      { startYear: 2026, endYear: 2026, explicitYears: true, apiKey: "test-key" },
    );
    expect(result?.observations).toEqual([
      { year: "2026", period: "Q01", periodName: "2026 Q1", value: 67272, footnotes: [] },
    ]);
  });

  it("Albemarle + Charlottesville, VA (Virginia combination, 51901): personal_income", async () => {
    const [result] = await fetchPi(
      replay(),
      [personalIncome.buildSeriesId("51901", { seasonallyAdjusted: false, dimensions: {} })],
      { apiKey: "test-key" },
    );
    expect(result?.observations).toEqual([
      { year: "2024", period: "A01", periodName: "2024", value: 17850944, footnotes: [] },
    ]);
  });

  it("Connecticut's Capitol Planning Region, 2020-2024: pre-2024 years are null, with a note", async () => {
    const [result] = await fetchPi(
      replay(),
      [personalIncome.buildSeriesId("09110", { seasonallyAdjusted: false, dimensions: {} })],
      { startYear: 2020, endYear: 2024, explicitYears: true, apiKey: "test-key" },
    );
    expect(result?.observations.map((o) => [o.year, o.value])).toEqual([
      ["2024", 82016501],
      ["2023", null],
      ["2022", null],
      ["2021", null],
      ["2020", null],
    ]);
    expect(result?.notes?.some((n) => /planning regions from 2024/.test(n))).toBe(true);
  });

  it("a county asking quarterly is unavailable — no BEA call, a clear note, never a silent annual", async () => {
    const [result] = await fetchPi(
      replay(),
      [
        personalIncome.buildSeriesId("18141", {
          seasonallyAdjusted: false,
          dimensions: { frequency: "quarterly" },
        }),
      ],
      { apiKey: "test-key" },
    );
    expect(result?.observations).toEqual([]);
    expect(result?.notes).toEqual([
      expect.stringContaining("quarterly personal income for states only"),
    ]);
  });

  it("compare batching: St. Joseph + Cook County in ONE upstream call", async () => {
    const stJosephId = personalIncome.buildSeriesId("18141", {
      seasonallyAdjusted: false,
      dimensions: {},
    });
    const cookId = personalIncome.buildSeriesId("17031", {
      seasonallyAdjusted: false,
      dimensions: {},
    });
    const results = await fetchPi(replay(), [stJosephId, cookId], { apiKey: "test-key" });
    const byId = new Map(results.map((r) => [r.seriesId, r]));
    // Only the fixture recorded for BOTH counties in one GeoFips list exists for 17031 alone; a
    // second, separate call for Cook County would throw MissingFixtureError, failing this test.
    expect(byId.get(stJosephId)?.observations).toEqual([
      { year: "2024", period: "A01", periodName: "2024", value: 16159152, footnotes: [] },
    ]);
    expect(byId.get(cookId)?.observations).toEqual([
      { year: "2024", period: "A01", periodName: "2024", value: 414425134, footnotes: [] },
    ]);
  });

  it("sourceOf cites the exact GetData URL actually read, key-less", () => {
    const key = personalIncome.buildSeriesId("18141", {
      seasonallyAdjusted: false,
      dimensions: {},
    });
    const src = personalIncome.sourceOf?.(key, {
      year: "2024",
      period: "A01",
      periodName: "2024",
      value: 16159152,
      footnotes: [],
    });
    expect(src?.url).toBe(
      "https://apps.bea.gov/api/data?method=GetData&datasetname=Regional&TableName=CAINC1&LineCode=1&GeoFips=18141&Year=2024&ResultFormat=JSON",
    );
    expect(src?.label).toContain("CAINC1 line 1");
  });
});

describe("bea_get_indicator / bea_compare_places: personal income through the mounted tools", () => {
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
      sanitize: sanitizeBeaBody,
      bodyError: beaBodyError,
    });
  const build = () =>
    buildBeaDefinition({
      catalog,
      httpClient: replay(),
      apiKey: () => "test-key",
      now: () => new Date("2026-09-28"),
    });

  const tool = (name: string) => {
    const t = build().tools.find((x) => x.name === name);
    if (!t) throw new Error(`${name} not mounted`);
    return t;
  };

  it("mounts bea_get_indicator, bea_compare_places and bea_list_indicators once PI exists", () => {
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

  it("St. Joseph County, IN: personal_income = 16,159,152 thousand dollars, cited and flagged", async () => {
    const res = await tool("bea_get_indicator").handler({
      place: "St. Joseph County",
      state: "IN",
      kind: "county",
      indicator: "personal_income",
    });
    const data = res.data as { latest: { value: number } | null };
    expect(data.latest?.value).toBe(16159152);
    expect(res.source.citation).toContain("apps.bea.gov");
    expect(res.source.citation.endsWith(BEA_REQUIRED_SENTENCE)).toBe(true);
  });

  it("South Bend city: county-fallback caveat travels as a limitation, value from St. Joseph County", async () => {
    const res = await tool("bea_get_indicator").handler({
      place: "South Bend",
      state: "IN",
      kind: "city",
      indicator: "personal_income",
    });
    const data = res.data as { latest: { value: number } | null };
    expect(data.latest?.value).toBe(16159152);
    expect(res.limitations?.join(" ")).toMatch(/by county, not by city or town/);
  });

  it("Albemarle County, VA: the Virginia combination caveat travels as a limitation", async () => {
    const res = await tool("bea_get_indicator").handler({
      place: "Albemarle",
      state: "VA",
      kind: "county",
      indicator: "personal_income",
    });
    const data = res.data as { latest: { value: number } | null };
    expect(data.latest?.value).toBe(17850944);
    expect(res.limitations?.join(" ")).toContain("51901");
  });

  it("Capitol Planning Region, CT, 2020-2024: pre-2024 nulls plus the planning-region note", async () => {
    const res = await tool("bea_get_indicator").handler({
      place: "Capitol",
      state: "CT",
      kind: "county",
      indicator: "personal_income",
      startYear: 2020,
      endYear: 2024,
    });
    const data = res.data as { observations: { year: string; value: number | null }[] };
    expect(data.observations.map((o) => o.value)).toEqual([82016501, null, null, null, null]);
    expect(res.limitations?.join(" ")).toMatch(/planning regions from 2024/);
  });

  it("St. Joseph County asking quarterly: unavailable, never a silent annual figure", async () => {
    const res = await tool("bea_get_indicator").handler({
      place: "St. Joseph County",
      state: "IN",
      kind: "county",
      indicator: "personal_income",
      frequency: "quarterly",
    });
    const data = res.data as { latest: { value: number } | null };
    expect(data.latest).toBeNull();
    expect(res.limitations?.join(" ")).toMatch(/quarterly personal income for states only/);
  });

  it("Indiana, quarterly per_capita_personal_income, 2026: value 67,272 (2026 Q1)", async () => {
    const res = await tool("bea_get_indicator").handler({
      place: "Indiana",
      kind: "state",
      indicator: "per_capita_personal_income",
      frequency: "quarterly",
      startYear: 2026,
      endYear: 2026,
    });
    const data = res.data as { latest: { period: string; value: number } | null };
    expect(data.latest).toEqual({ period: "2026-Q01", value: 67272 });
  });

  it("bea_compare_places: St. Joseph County vs Cook County, one upstream call", async () => {
    const res = await tool("bea_compare_places").handler({
      indicator: "personal_income",
      places: ["St. Joseph County, IN", "Cook County, IL"],
    });
    const data = res.data as { rows: { query: string; value: number | null }[] };
    const byQuery = new Map(data.rows.map((r) => [r.query, r.value]));
    expect(byQuery.get("St. Joseph County, IN")).toBe(16159152);
    expect(byQuery.get("Cook County, IL")).toBe(414425134);
  });
});
