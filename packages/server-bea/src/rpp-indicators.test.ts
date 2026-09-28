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
import { buildBeaDefinition } from "./definition.js";
import { BEA_REQUIRED_SENTENCE } from "./describe-source.js";
import { rppIndicatorDefinitions } from "./rpp-indicators.js";

/** A resolved-place stand-in: only the fields the definition's own functions read. */
const place = (
  sumlevel: string,
  geoid: string,
  extra: Partial<PlaceCandidate> = {},
): PlaceCandidate =>
  ({
    geoid,
    name: extra.name ?? geoid,
    kind: { sumlevel, label: "" },
    stateFips: null,
    parents: [],
    ...extra,
  }) as unknown as PlaceCandidate;

const DENVER_METRO = place("310", "19740", { name: "Denver-Aurora-Centennial, CO" });
const INDIANA = place("040", "18", { name: "Indiana" });
const ST_JOSEPH = place("050", "18141", {
  name: "St. Joseph County",
  stateFips: "18",
  parents: [{ geoid: "18", name: "Indiana", kind: { sumlevel: "040", label: "state" } }],
});

const def = rppIndicatorDefinitions[0];
if (!def) throw new Error("rppIndicatorDefinitions is empty");

describe("regional_price_parity definition shape (#261, ADR-019 §2)", () => {
  it("is the one RPP indicator, program RPP, with an item dimension defaulting to all items", () => {
    expect(rppIndicatorDefinitions).toHaveLength(1);
    expect(def.name).toBe("regional_price_parity");
    expect(def.program).toBe("RPP");
    expect(def.dimensions?.map((d) => d.argument)).toEqual(["item"]);
    expect(def.dimensions?.[0]?.default).toBe("1");
    expect(def.dimensions?.[0]?.vocabulary.map((v) => v.code)).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("agencyCodeOf: a metro or state resolves directly; a county does not (no county-level RPP)", () => {
    expect(def.agencyCodeOf(DENVER_METRO)).toBe("metro:19740");
    expect(def.agencyCodeOf(INDIANA)).toBe("state:18000");
    expect(def.agencyCodeOf(ST_JOSEPH)).toBeUndefined();
  });

  it("buildSeriesId: table from the code's kind, the resolved item, then GeoFips", () => {
    expect(
      def.buildSeriesId("metro:19740", { seasonallyAdjusted: false, dimensions: { item: "3" } }),
    ).toBe("MARPP|3|19740");
    expect(def.buildSeriesId("state:18", { seasonallyAdjusted: false, dimensions: {} })).toBe(
      "SARPP|1|18",
    );
    expect(def.buildSeriesId("portion:48999", { seasonallyAdjusted: false, dimensions: {} })).toBe(
      "PARPP|1|48999",
    );
  });
});

describe("fallback: a place with no RPP series answers with its metro, or its state's nonmetro portion", () => {
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

  it("a county falls back to its metro (St. Joseph County -> South Bend-Mishawaka)", () => {
    const stJoseph = resolveOne("St. Joseph", "county", "IN");
    const fb = def.fallback?.(catalog, stJoseph);
    expect(fb).toEqual({
      geoid: "43780",
      name: "South Bend-Mishawaka, IN-MI",
      sumlevel: "310",
      code: "metro:43780",
      caveat:
        "BEA publishes regional price parities by metropolitan area: this is South Bend-Mishawaka, IN-MI's, which includes St. Joseph County.",
    });
  });

  it("a city falls back to its metro through its county (South Bend city -> South Bend-Mishawaka)", () => {
    const southBend = resolveOne("South Bend", "city", "IN");
    const fb = def.fallback?.(catalog, southBend);
    expect(fb?.code).toBe("metro:43780");
  });

  it("a county with no metro in the catalog falls back to its state's nonmetropolitan portion (Loving County, TX)", () => {
    const loving = resolveOne("Loving", "county", "TX");
    const fb = def.fallback?.(catalog, loving);
    expect(fb).toEqual({
      geoid: "48999",
      name: "Texas (Nonmetropolitan Portion)",
      sumlevel: "040",
      code: "portion:48999",
      caveat: expect.stringContaining("Texas's nonmetropolitan portion"),
    });
    expect(fb?.caveat).toContain("not resolved to a metropolitan area");
  });

  it("Cook County has no metro in this catalog either: falls back to Illinois's nonmetropolitan portion", () => {
    const cook = resolveOne("Cook", "county", "IL");
    const fb = def.fallback?.(catalog, cook);
    expect(fb?.code).toBe("portion:17999");
    expect(fb?.geoid).toBe("17999");
  });

  it("has no fallback for a metro or state (already direct)", () => {
    const denver = resolveOne("Denver", "metro");
    const colorado = resolveOne("Colorado", "state");
    expect(def.fallback?.(catalog, denver)).toBeUndefined();
    expect(def.fallback?.(catalog, colorado)).toBeUndefined();
  });
});

describe("rppFetch over recorded fixtures (verified live 2026-09-28)", () => {
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
  const fetchRpp = def.fetch;
  if (!fetchRpp) throw new Error("regional_price_parity has no fetch capability");

  it("Denver metro, all items, latest: 2024 = 105.782", async () => {
    const [result] = await fetchRpp(replay(), ["MARPP|1|19740"], { apiKey: "test-key" });
    expect(result?.observations[0]).toMatchObject({
      year: "2024",
      period: "A01",
      periodName: "2024",
      value: 105.782,
    });
  });

  it("Denver metro, rents (item picker), 2024: 146.919", async () => {
    const [result] = await fetchRpp(replay(), ["MARPP|3|19740"], {
      startYear: 2024,
      endYear: 2024,
      explicitYears: true,
      apiKey: "test-key",
    });
    expect(result?.observations).toEqual([
      { year: "2024", period: "A01", periodName: "2024", value: 146.919, footnotes: [] },
    ]);
  });

  it("Indiana state, all items, latest", async () => {
    const [result] = await fetchRpp(replay(), ["SARPP|1|18000"], { apiKey: "test-key" });
    expect(result?.observations[0]).toMatchObject({ year: "2024", value: 93.329 });
  });

  it("explicit years 2023-2024: history newest first", async () => {
    const [result] = await fetchRpp(replay(), ["MARPP|1|19740"], {
      startYear: 2023,
      endYear: 2024,
      explicitYears: true,
      apiKey: "test-key",
    });
    expect(result?.observations.map((o) => [o.year, o.value])).toEqual([
      ["2024", 105.782],
      ["2023", 105.768],
    ]);
  });

  it("South Bend metro alone, latest: 2024 = 92.858, 2023 = 91.378 further back", async () => {
    const [result] = await fetchRpp(replay(), ["MARPP|1|43780"], { apiKey: "test-key" });
    expect(result?.observations[0]).toMatchObject({ year: "2024", value: 92.858 });
    expect(result?.observations.find((o) => o.year === "2023")?.value).toBe(91.378);
  });

  it("Loving County TX -> Texas nonmetropolitan portion (PARPP), latest", async () => {
    const [result] = await fetchRpp(replay(), ["PARPP|1|48999"], { apiKey: "test-key" });
    expect(result?.observations[0]).toMatchObject({ year: "2024", value: 87.835 });
  });

  it("compare batching: two MARPP metros in one upstream call", async () => {
    const results = await fetchRpp(replay(), ["MARPP|1|19740", "MARPP|1|43780"], {
      apiKey: "test-key",
    });
    expect(results).toHaveLength(2);
    expect(results.find((r) => r.seriesId === "MARPP|1|19740")?.observations[0]?.value).toBe(
      105.782,
    );
    expect(results.find((r) => r.seriesId === "MARPP|1|43780")?.observations[0]?.value).toBe(
      92.858,
    );
  });

  it("a mixed batch (MARPP + PARPP) makes one call per table, not one per place", async () => {
    const results = await fetchRpp(replay(), ["MARPP|1|43780", "PARPP|1|17999"], {
      apiKey: "test-key",
    });
    expect(results.find((r) => r.seriesId === "MARPP|1|43780")?.observations[0]?.value).toBe(
      92.858,
    );
    expect(results.find((r) => r.seriesId === "PARPP|1|17999")?.observations[0]).toBeDefined();
  });

  it("MARPP notes carry BEA's OMB delineation text and the release vintage verbatim", async () => {
    const [result] = await fetchRpp(replay(), ["MARPP|1|19740"], { apiKey: "test-key" });
    expect(result?.notes?.join(" ")).toContain(
      "Metropolitan Areas are defined (geographically delineated) by the Office of Management and Budget",
    );
    expect(result?.notes?.join(" ")).toMatch(/BEA: Last updated:/);
  });

  it("SARPP notes carry the release vintage but not a metro-delineation note (states aren't delineated)", async () => {
    const [result] = await fetchRpp(replay(), ["SARPP|1|18000"], { apiKey: "test-key" });
    expect(result?.notes?.some((n) => /Metropolitan Areas are defined/.test(n))).toBe(false);
    expect(result?.notes?.some((n) => /^BEA: Last updated:/.test(n))).toBe(true);
  });

  it("a range entirely before 2008 fetches nothing, with a note, and makes no call", async () => {
    const [result] = await fetchRpp(replay(), ["MARPP|1|19740"], {
      startYear: 2000,
      endYear: 2005,
      explicitYears: true,
      apiKey: "test-key",
    });
    expect(result?.observations).toEqual([]);
    expect(result?.notes?.join(" ")).toContain("BEA publishes regional price parities from 2008");
  });
});

describe("sourceOf: the exact key-less GetData URL, with a readable label", () => {
  it("cites the table, line and GeoFips actually read", () => {
    const src = def.sourceOf?.("MARPP|3|19740", {
      year: "2024",
      period: "A01",
      periodName: "2024",
      value: 146.919,
      footnotes: [],
    });
    expect(src?.url).toBe(
      "https://apps.bea.gov/api/data?method=GetData&datasetname=Regional&TableName=MARPP&LineCode=3&GeoFips=19740&Year=2024&ResultFormat=JSON",
    );
    expect(src?.label).toContain("rents");
    expect(src?.label).toContain("19740");
  });
});

describe("bea_get_indicator and bea_compare_places: regional_price_parity through the mounted tools", () => {
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

  const getIndicatorTool = () => {
    const tool = build().tools.find((t) => t.name === "bea_get_indicator");
    if (!tool) throw new Error("bea_get_indicator not mounted");
    return tool;
  };
  const comparePlacesTool = () => {
    const tool = build().tools.find((t) => t.name === "bea_compare_places");
    if (!tool) throw new Error("bea_compare_places not mounted");
    return tool;
  };

  it("mounts bea_get_indicator, bea_compare_places and bea_list_indicators once RPP exists", () => {
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

  it("Denver metro, rents: value 146.919, citation carries the required sentence", async () => {
    const res = await getIndicatorTool().handler({
      place: "Denver",
      kind: "metro",
      indicator: "regional_price_parity",
      item: "3",
      startYear: 2024,
      endYear: 2024,
    });
    const data = res.data as { latest: { value: number } | null };
    expect(data.latest?.value).toBe(146.919);
    expect(res.source.citation.endsWith(BEA_REQUIRED_SENTENCE)).toBe(true);
  });

  it("St. Joseph County, IN: falls back to South Bend-Mishawaka, caveat travels as a limitation", async () => {
    const res = await getIndicatorTool().handler({
      place: "St. Joseph County",
      state: "IN",
      kind: "county",
      indicator: "regional_price_parity",
    });
    const data = res.data as { latest: { value: number } | null };
    expect(data.latest?.value).toBe(92.858);
    expect(res.limitations?.join(" ")).toContain(
      "BEA publishes regional price parities by metropolitan area",
    );
  });

  it("South Bend city: same metro fallback as its county", async () => {
    const res = await getIndicatorTool().handler({
      place: "South Bend",
      state: "IN",
      kind: "city",
      indicator: "regional_price_parity",
    });
    const data = res.data as { latest: { value: number } | null };
    expect(data.latest?.value).toBe(92.858);
  });

  it("Loving County, TX: no metro, answers with Texas's nonmetropolitan portion", async () => {
    const res = await getIndicatorTool().handler({
      place: "Loving County",
      state: "TX",
      kind: "county",
      indicator: "regional_price_parity",
    });
    const data = res.data as { latest: { value: number } | null };
    expect(data.latest?.value).toBe(87.835);
    expect(res.limitations?.join(" ")).toContain("nonmetropolitan portion");
  });

  it("Indiana: state RPP direct", async () => {
    const res = await getIndicatorTool().handler({
      place: "Indiana",
      kind: "state",
      indicator: "regional_price_parity",
    });
    const data = res.data as { latest: { value: number } | null };
    expect(data.latest?.value).toBe(93.329);
  });

  it("startYear/endYear 2023-2024: history newest first", async () => {
    const res = await getIndicatorTool().handler({
      place: "Denver",
      kind: "metro",
      indicator: "regional_price_parity",
      startYear: 2023,
      endYear: 2024,
    });
    const data = res.data as { observations: { year: string; value: number }[] };
    expect(data.observations.map((o) => [o.year, o.value])).toEqual([
      ["2024", 105.782],
      ["2023", 105.768],
    ]);
  });

  it("compare_places: Denver vs South Bend-Mishawaka metros, one upstream call", async () => {
    const res = await comparePlacesTool().handler({
      indicator: "regional_price_parity",
      places: ["Denver", "South Bend-Mishawaka"],
      kind: "metro",
    });
    const data = res.data as { rows: { query: string; value: number | null; status: string }[] };
    const denver = data.rows.find((r) => r.query === "Denver");
    const southBend = data.rows.find((r) => r.query === "South Bend-Mishawaka");
    expect(denver?.value).toBe(105.782);
    expect(denver?.status).toBe("ok");
    expect(southBend?.value).toBe(92.858);
    expect(southBend?.status).toBe("ok");
  });

  it("compare_places: St. Joseph County, IN vs Cook County, IL — honest about what each falls back to", async () => {
    const res = await comparePlacesTool().handler({
      indicator: "regional_price_parity",
      places: ["St. Joseph County, IN", "Cook County, IL"],
    });
    const data = res.data as {
      rows: { query: string; value: number | null; status: string; caveat?: string }[];
    };
    const stJoseph = data.rows.find((r) => r.query === "St. Joseph County, IN");
    const cook = data.rows.find((r) => r.query === "Cook County, IL");
    // St. Joseph County falls back to the South Bend-Mishawaka metro it actually has.
    expect(stJoseph?.status).toBe("fallback");
    expect(stJoseph?.value).toBe(92.858);
    expect(stJoseph?.caveat).toContain("South Bend-Mishawaka");
    // Cook County has no metro in this fixture catalog: it falls back to Illinois's
    // nonmetropolitan portion, honestly caveated rather than reported as Chicago's own number.
    expect(cook?.status).toBe("fallback");
    expect(cook?.caveat).toContain("not resolved to a metropolitan area");
  });
});
