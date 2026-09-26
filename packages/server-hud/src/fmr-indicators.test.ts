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
import { buildHudDefinition } from "./definition.js";
import { HUD_USER_REQUIRED_SENTENCE } from "./describe-source.js";
import { fmrIndicatorDefinitions } from "./fmr-indicators.js";

/** A resolved-place stand-in: only the fields the indicator's own functions read. */
const place = (sumlevel: string, geoid: string): PlaceCandidate =>
  ({ geoid, kind: { sumlevel, label: "" } }) as unknown as PlaceCandidate;

const ST_JOSEPH = place("050", "18141");
const SOUTH_BEND_METRO = place("310", "43780");
const INDIANA = place("040", "18");

const def = fmrIndicatorDefinitions[0];
if (!def) throw new Error("fmrIndicatorDefinitions is empty");

describe("fair_market_rent definition shape (#233, ADR-018 §3)", () => {
  it("is the one FMR indicator, program FMR, with a bedrooms dimension defaulting to two-bedroom", () => {
    expect(fmrIndicatorDefinitions).toHaveLength(1);
    expect(def.name).toBe("fair_market_rent");
    expect(def.program).toBe("FMR");
    expect(def.dimensions?.map((d) => d.argument)).toEqual(["bedrooms"]);
    expect(def.dimensions?.[0]?.default).toBe("2");
    expect(def.dimensions?.[0]?.vocabulary.map((v) => v.code)).toEqual(["0", "1", "2", "3", "4"]);
  });

  it("agencyCodeOf: a county resolves directly; a metro or state does not (no FMR-area catalog column)", () => {
    expect(def.agencyCodeOf(ST_JOSEPH)).toBe("1814199999");
    expect(def.agencyCodeOf(SOUTH_BEND_METRO)).toBeUndefined();
    expect(def.agencyCodeOf(INDIANA)).toBeUndefined();
  });

  it("buildSeriesId encodes the entity and the resolved bedroom code", () => {
    expect(
      def.buildSeriesId("1814199999", { seasonallyAdjusted: false, dimensions: { bedrooms: "3" } }),
    ).toBe("1814199999|3");
    expect(def.buildSeriesId("1814199999", { seasonallyAdjusted: false, dimensions: {} })).toBe(
      "1814199999|2",
    );
  });
});

describe("fallback: a city answers with its county's FMR area (#233, ADR-018 §3)", () => {
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

  it("South Bend city falls back to St. Joseph County with a caveat naming the area", () => {
    const southBend = resolveOne("South Bend", "city", "IN");
    const fb = def.fallback?.(catalog, southBend);
    expect(fb).toEqual({
      geoid: "18141",
      name: "St. Joseph County",
      sumlevel: "050",
      code: "1814199999",
      caveat:
        "HUD sets Fair Market Rents per FMR area, not by city: this is St. Joseph County's area rate, covering South Bend city.",
    });
  });

  it("has no fallback for a county, state or metro (not a city)", () => {
    expect(def.fallback?.(catalog, ST_JOSEPH)).toBeUndefined();
    expect(def.fallback?.(catalog, SOUTH_BEND_METRO)).toBeUndefined();
    expect(def.fallback?.(catalog, INDIANA)).toBeUndefined();
  });
});

describe("fmrFetch over recorded fixtures (verified live 2026-09-24)", () => {
  const FIXTURES = fileURLToPath(new URL("../fixtures", import.meta.url));
  const replay = () =>
    createHttpClient({
      source: "hud",
      budget: new MemoryBudgetStore(100),
      cache: new MemoryCacheStore(),
      fixtures: { mode: "replay", dir: FIXTURES },
    });
  const fetchFmr = def.fetch;
  if (!fetchFmr) throw new Error("fair_market_rent has no fetch capability");

  it("St. Joseph County, default two-bedroom: FY2027, area name and effective-date note", async () => {
    const [result] = await fetchFmr(
      replay(),
      [
        def.buildSeriesId("1814199999", {
          seasonallyAdjusted: false,
          dimensions: { bedrooms: "2" },
        }),
      ],
      { apiKey: "test-token" },
    );
    expect(result?.observations).toEqual([
      { year: "2027", period: "A01", periodName: "FY2027", value: 1276, footnotes: [] },
    ]);
    expect(result?.notes).toContainEqual(
      expect.stringContaining(
        "South Bend-Mishawaka, IN HUD Metro FMR Area: FY2027 takes effect October 1, 2026.",
      ),
    );
  });

  it("St. Joseph County, three-bedroom: reads the Three-Bedroom key from the same current response", async () => {
    const [result] = await fetchFmr(
      replay(),
      [
        def.buildSeriesId("1814199999", {
          seasonallyAdjusted: false,
          dimensions: { bedrooms: "3" },
        }),
      ],
      { apiKey: "test-token" },
    );
    expect(result?.observations).toEqual([
      { year: "2027", period: "A01", periodName: "FY2027", value: 1545, footnotes: [] },
    ]);
  });

  it("explicit years 2025-2026: one call per year, newest first", async () => {
    const [result] = await fetchFmr(
      replay(),
      [
        def.buildSeriesId("1814199999", {
          seasonallyAdjusted: false,
          dimensions: { bedrooms: "2" },
        }),
      ],
      { startYear: 2025, endYear: 2026, explicitYears: true, apiKey: "test-token" },
    );
    expect(result?.observations).toEqual([
      { year: "2026", period: "A01", periodName: "FY2026", value: 1292, footnotes: [] },
      { year: "2025", period: "A01", periodName: "FY2025", value: 1095, footnotes: [] },
    ]);
  });

  it("floors an out-of-range start year at FY2017 with a note, and still fetches it", async () => {
    const [result] = await fetchFmr(
      replay(),
      [
        def.buildSeriesId("1814199999", {
          seasonallyAdjusted: false,
          dimensions: { bedrooms: "2" },
        }),
      ],
      { startYear: 2010, endYear: 2017, explicitYears: true, apiKey: "test-token" },
    );
    expect(result?.observations).toEqual([
      { year: "2017", period: "A01", periodName: "FY2017", value: 792, footnotes: [] },
    ]);
    expect(result?.notes).toContainEqual(
      expect.stringContaining("HUD Fair Market Rent data begins at FY2017"),
    );
  });

  it("Cook County (Small Area FMR): reads the MSA-level row and notes the ZIP count", async () => {
    const [result] = await fetchFmr(
      replay(),
      [
        def.buildSeriesId("1703199999", {
          seasonallyAdjusted: false,
          dimensions: { bedrooms: "2" },
        }),
      ],
      { apiKey: "test-token" },
    );
    expect(result?.observations).toEqual([
      { year: "2027", period: "A01", periodName: "FY2027", value: 2011, footnotes: [] },
    ]);
    expect(result?.notes).toContainEqual(
      expect.stringContaining(
        'Small Area FMRs by ZIP apply in Chicago-Joliet-Naperville, IL HUD Metro FMR Area (370 ZIP codes); this answer uses the county-wide "MSA level" rate.',
      ),
    );
  });

  it("sourceOf cites the entity/bedroom URL actually read", () => {
    const key = def.buildSeriesId("1814199999", {
      seasonallyAdjusted: false,
      dimensions: { bedrooms: "2" },
    });
    const src = def.sourceOf?.(key, {
      year: "2026",
      period: "A01",
      periodName: "FY2026",
      value: 1292,
      footnotes: [],
    });
    expect(src?.url).toBe("https://www.huduser.gov/hudapi/public/fmr/data/1814199999?year=2026");
    expect(src?.label).toContain("two-bedroom");
  });
});

describe("hud_get_indicator: fair_market_rent through the mounted tool", () => {
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
      source: "hud",
      budget: new MemoryBudgetStore(100),
      cache: new MemoryCacheStore(),
      fixtures: { mode: "replay", dir: FIXTURES },
    });
  const build = () =>
    buildHudDefinition({
      catalog,
      httpClient: replay(),
      token: () => "test-token",
      now: () => new Date("2026-09-24"),
    });

  const getIndicatorTool = () => {
    const tool = build().tools.find((t) => t.name === "hud_get_indicator");
    if (!tool) throw new Error("hud_get_indicator not mounted");
    return tool;
  };

  it("mounts hud_get_indicator, hud_compare_places and hud_list_indicators once FMR exists", () => {
    const names = build().tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "hud_resolve_place",
        "hud_get_indicator",
        "hud_compare_places",
        "hud_list_indicators",
      ]),
    );
  });

  it("St. Joseph County, default bedrooms: value 1276, area cited, required sentence not silently dropped", async () => {
    const res = await getIndicatorTool().handler({
      place: "St. Joseph County",
      state: "IN",
      kind: "county",
      indicator: "fair_market_rent",
    });
    const data = res.data as { latest: { value: number } | null };
    expect(data.latest?.value).toBe(1276);
    expect(res.source.citation).toMatch(/^U\.S\. Department of Housing and Urban Development, FMR/);
    expect(res.source.citation).toMatch(/huduser\.gov/);
    expect(res.source.citation.endsWith(HUD_USER_REQUIRED_SENTENCE)).toBe(true);
  });

  it("St. Joseph County, bedrooms 3: value 1545", async () => {
    const res = await getIndicatorTool().handler({
      place: "St. Joseph County",
      state: "IN",
      kind: "county",
      indicator: "fair_market_rent",
      bedrooms: "3",
    });
    const data = res.data as { latest: { value: number } | null };
    expect(data.latest?.value).toBe(1545);
  });

  it("South Bend city: county-fallback caveat travels as a limitation, value still 1276", async () => {
    const res = await getIndicatorTool().handler({
      place: "South Bend",
      state: "IN",
      kind: "city",
      indicator: "fair_market_rent",
    });
    const data = res.data as { latest: { value: number } | null };
    expect(data.latest?.value).toBe(1276);
    expect(res.limitations?.join(" ")).toContain("HUD sets Fair Market Rents per FMR area");
  });

  it("Cook County: Small Area FMR note travels as a limitation", async () => {
    const res = await getIndicatorTool().handler({
      place: "Cook County",
      state: "IL",
      kind: "county",
      indicator: "fair_market_rent",
    });
    expect(res.limitations?.join(" ")).toMatch(/Small Area FMRs by ZIP apply/);
  });

  it("the metro: unavailable, no fabricated county-of-a-metro number", async () => {
    const res = await getIndicatorTool().handler({
      place: "South Bend-Mishawaka",
      kind: "metro",
      indicator: "fair_market_rent",
    });
    const data = res.data as { status?: string };
    expect(data.status).toBe("unavailable");
  });

  it("startYear/endYear 2025-2026: history newest first", async () => {
    const res = await getIndicatorTool().handler({
      place: "St. Joseph County",
      state: "IN",
      kind: "county",
      indicator: "fair_market_rent",
      startYear: 2025,
      endYear: 2026,
    });
    const data = res.data as { observations: { year: string; value: number }[] };
    expect(data.observations.map((o) => [o.year, o.value])).toEqual([
      ["2026", 1292],
      ["2025", 1095],
    ]);
  });
});
