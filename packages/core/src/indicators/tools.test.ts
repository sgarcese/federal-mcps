import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GeographyCatalog } from "../geography/catalog.js";
import type { HttpClient } from "../http/index.js";
import { buildFixtureCatalog } from "../geography/__fixtures__/build-fixture.js";
import { DIMENSION_ARGUMENTS, type IndicatorDefinition, type IndicatorFetch } from "./registry.js";
import { indicatorTools } from "./tools.js";

/**
 * The generic indicator tools over a made-up agency ("demo"), proving the factory carries no BLS
 * assumptions: names, source block, default fetch, dimensions, national scope and fallback all
 * come from the options and the definitions (M8.2, ADR-014).
 */
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

const noClient = {} as HttpClient;
/** A fetch capability that answers every key with one observation whose value is the key's length. */
const echoFetch: IndicatorFetch = async (_client, ids) =>
  ids.map((seriesId) => ({
    seriesId,
    observations: [
      { year: "2024", period: "A01", periodName: "2024", value: seriesId.length, footnotes: [] },
    ],
  }));

const countyThing: IndicatorDefinition = {
  name: "county_thing",
  program: "DEMO",
  description: "a thing counties have",
  defaultSeasonallyAdjusted: false,
  agencyCodeOf: (place) => (place.kind.sumlevel === "050" ? `C:${place.geoid}` : undefined),
  buildSeriesId: (code, { dimensions }) => `${code}/${dimensions.item ?? "x"}`,
  dimensions: [
    {
      argument: "item",
      description: "which thing",
      default: "a",
      vocabulary: [
        { code: "a", label: "A" },
        { code: "bb", label: "BB" },
      ],
    },
  ],
};
const nationalThing: IndicatorDefinition = {
  name: "national_thing",
  program: "DEMO",
  description: "a national-only thing",
  defaultSeasonallyAdjusted: false,
  scope: "national",
  agencyCodeOf: () => "US",
  buildSeriesId: () => "NATIONAL",
};

const tools = indicatorTools({
  agency: "demo",
  definitions: [countyThing, nationalThing],
  catalog: () => catalog,
  httpClient: () => noClient,
  now: () => new Date("2025-02-01T00:00:00Z"),
  defaultFetch: echoFetch,
  sourceUrl: "https://example.invalid/api",
  descriptions: { getIndicator: "get", comparePlaces: "compare", listIndicators: "list" },
  examples: {
    getIndicator: [
      { title: "x", input: { place: "Denver", kind: "county", indicator: "county_thing" } },
    ],
    comparePlaces: [
      {
        title: "y",
        input: { indicator: "county_thing", places: ["Denver County", "Fairfield County"] },
      },
    ],
    listIndicators: [{ title: "z", input: {} }],
  },
});
const named = (n: string) => {
  const t = tools.find((x) => x.name === n);
  if (!t) throw new Error(n);
  return t;
};
// biome-ignore lint/suspicious/noExplicitAny: reading the envelope's untyped data in tests.
const go = (n: string, args: Record<string, unknown>) => named(n).handler(args as any, {} as any);

describe("indicatorTools (agency-neutral, #171)", () => {
  it("names the three tools after the agency and reads the source URL from options", async () => {
    expect(tools.map((t) => t.name)).toEqual([
      "demo_get_indicator",
      "demo_compare_places",
      "demo_list_indicators",
    ]);
    const res = await go("demo_get_indicator", {
      place: "Denver",
      kind: "county",
      indicator: "county_thing",
    });
    expect(res.source).toMatchObject({
      agency: "demo",
      program: "DEMO",
      url: "https://example.invalid/api",
    });
    expect(res.source.ids).toEqual(["C:08031/a"]);
    expect(res.place?.geoid).toBe("08031");
  });

  it("uses the default fetch capability and applies dimensions", async () => {
    const res = await go("demo_get_indicator", {
      place: "Denver",
      kind: "county",
      indicator: "county_thing",
      item: "bb",
    });
    expect(res.source.ids).toEqual(["C:08031/bb"]);
    expect((res.data as { latest: { value: number } }).latest.value).toBe("C:08031/bb".length);
  });

  it("answers a national-scope indicator without a place and declines to compare it", async () => {
    const res = await go("demo_get_indicator", { indicator: "national_thing" });
    expect(res.place?.name).toBe("United States");
    await expect(
      go("demo_compare_places", { indicator: "national_thing", places: ["a", "b"] }),
    ).rejects.toThrow(/demo_get_indicator/);
  });

  it("reports unavailable for a place the program does not cover, never a fabricated value", async () => {
    const res = await go("demo_get_indicator", {
      place: "Colorado",
      kind: "state",
      indicator: "county_thing",
    });
    expect((res.data as { status: string }).status).toBe("unavailable");
    expect(res.source.ids).toEqual([]);
  });

  it("lists indicators with scope and vocabularies", async () => {
    const res = await go("demo_list_indicators", {});
    const data = res.data as {
      indicators: { indicator: string; scope?: string; dimensions?: unknown[] }[];
    };
    expect(data.indicators.map((i) => i.indicator)).toEqual(["county_thing", "national_thing"]);
    expect(data.indicators[1]?.scope).toBe("national");
    expect(data.indicators[0]?.dimensions).toHaveLength(1);
  });
});

describe("every dimension argument reaches the indicator (#213, ADR-018 §3)", () => {
  // One indicator per dimension argument: its series key echoes the chosen code, so a dropped
  // argument shows up as the default instead of the caller's value.
  const perArgument = DIMENSION_ARGUMENTS.map(
    (arg): IndicatorDefinition => ({
      name: `thing_by_${arg}`,
      program: "DEMO",
      description: `a thing keyed by ${arg}`,
      defaultSeasonallyAdjusted: false,
      agencyCodeOf: (place) => (place.kind.sumlevel === "050" ? `C:${place.geoid}` : undefined),
      buildSeriesId: (code, { dimensions }) => `${code}/${dimensions[arg] ?? "missing"}`,
      dimensions: [
        {
          argument: arg,
          description: arg,
          default: "d",
          vocabulary: [
            { code: "d", label: "default" },
            { code: "picked", label: "picked" },
          ],
        },
      ],
    }),
  );
  const all = indicatorTools({
    agency: "demo",
    definitions: perArgument,
    catalog: () => catalog,
    httpClient: () => noClient,
    now: () => new Date("2025-02-01T00:00:00Z"),
    defaultFetch: echoFetch,
    sourceUrl: "https://example.invalid/api",
    descriptions: { getIndicator: "get", comparePlaces: "compare", listIndicators: "list" },
    examples: {
      getIndicator: [{ title: "x", input: { place: "Denver", kind: "county" } }],
      comparePlaces: [{ title: "y", input: { places: ["Denver County", "Fairfield County"] } }],
      listIndicators: [{ title: "z", input: {} }],
    },
  });
  // biome-ignore lint/suspicious/noExplicitAny: handler args are untyped in tests.
  type AnyArgs = any;
  const get = all.find((t) => t.name === "demo_get_indicator");
  const compare = all.find((t) => t.name === "demo_compare_places");

  it.each([...DIMENSION_ARGUMENTS])("get_indicator passes %s through", async (arg) => {
    const res = await get?.handler(
      { place: "Denver", kind: "county", indicator: `thing_by_${arg}`, [arg]: "picked" } as AnyArgs,
      {} as AnyArgs,
    );
    expect(res?.source.ids).toEqual(["C:08031/picked"]);
  });

  it.each([...DIMENSION_ARGUMENTS])("compare_places passes %s through", async (arg) => {
    const res = await compare?.handler(
      {
        indicator: `thing_by_${arg}`,
        places: ["Denver County", "Fairfield County"],
        [arg]: "picked",
      } as AnyArgs,
      {} as AnyArgs,
    );
    expect(res?.source.ids).toContain("C:08031/picked");
    expect((res?.source.ids ?? []).every((id: string) => id.endsWith("/picked"))).toBe(true);
  });
});

describe("citationSuffix (#237): an attribution the agency's terms require rides every citation", () => {
  const attributed = indicatorTools({
    agency: "demo",
    definitions: [countyThing],
    catalog: () => catalog,
    httpClient: () => noClient,
    now: () => new Date("2025-02-01T00:00:00Z"),
    defaultFetch: echoFetch,
    sourceUrl: "https://example.invalid/api",
    citationSuffix: "Uses the Demo API; not endorsed by Demo.",
    descriptions: { getIndicator: "get", comparePlaces: "compare", listIndicators: "list" },
    examples: {
      getIndicator: [{ title: "x", input: { place: "Denver", kind: "county" } }],
      comparePlaces: [{ title: "y", input: { places: ["Denver County", "Fairfield County"] } }],
      listIndicators: [{ title: "z", input: {} }],
    },
  });
  // biome-ignore lint/suspicious/noExplicitAny: handler args are untyped in tests.
  type AnyArgs = any;
  const run = (n: string, args: Record<string, unknown>) =>
    attributed.find((t) => t.name === n)?.handler(args as AnyArgs, {} as AnyArgs);

  it("appends the suffix to a get_indicator citation", async () => {
    const res = await run("demo_get_indicator", { place: "Denver", kind: "county" });
    expect(res?.source.citation).toMatch(
      /Retrieved 2025-02-01 from \S+ Uses the Demo API; not endorsed by Demo\.$/,
    );
  });

  it("appends the suffix to a compare_places citation", async () => {
    const res = await run("demo_compare_places", { places: ["Denver County", "Fairfield County"] });
    expect(res?.source.citation).toMatch(/Uses the Demo API; not endorsed by Demo\.$/);
  });

  it("leaves citations unchanged without a suffix", async () => {
    const res = await go("demo_get_indicator", {
      place: "Denver",
      kind: "county",
      indicator: "county_thing",
    });
    expect(res.source.citation).toMatch(/from https:\/\/example\.invalid\/api$/);
  });
});
