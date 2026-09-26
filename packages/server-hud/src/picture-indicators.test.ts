import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  createHttpClient,
  GeographyCatalog,
  MemoryBudgetStore,
  MemoryCacheStore,
  type PlaceCandidate,
} from "@federal-mcps/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFixtureCatalog } from "./__fixtures__/build-fixture.js";
import { buildHudDefinition } from "./definition.js";
import { pictureIndicatorDefinitions } from "./picture-indicators.js";

/** A resolved-place stand-in: only the fields pictureEntityOf/agencyCodeOf read. */
const place = (sumlevel: string, geoid: string, stateFips: string | null): PlaceCandidate =>
  ({ geoid, kind: { sumlevel, label: "" }, stateFips }) as unknown as PlaceCandidate;

const ST_JOSEPH = place("050", "18141", "18");
const SOUTH_BEND = place("160", "1871000", "18");
const SOUTH_BEND_METRO = place("310", "43780", null);
const TRACT = place("140", "18141011300", "18");
const BLOCK = place("101", "180000000000000", "18");

const byName = (name: string) => {
  const def = pictureIndicatorDefinitions.find((d) => d.name === name);
  if (!def) throw new Error(`no picture indicator named "${name}"`);
  return def;
};

describe("picture indicator definitions (#236, ADR-018 §3)", () => {
  it("registers the five Picture indicators, program PICTURE", () => {
    expect(pictureIndicatorDefinitions.map((d) => d.name).sort()).toEqual(
      [
        "average_household_income",
        "months_waiting",
        "share_below_30_ami",
        "subsidized_people",
        "subsidized_units",
      ].sort(),
    );
    for (const def of pictureIndicatorDefinitions) expect(def.program).toBe("PICTURE");
  });

  it("declares a program dimension defaulting to Summary of All HUD Programs", () => {
    const def = byName("subsidized_units");
    const dim = def.dimensions?.find((d) => d.argument === "program");
    expect(dim?.default).toBe("1");
    const codes = dim?.vocabulary.map((v) => v.code).sort();
    expect(codes).toEqual(["1", "2", "3", "5", "8", "9"]);
    expect(dim?.vocabulary.find((v) => v.code === "3")?.label).toBe("Housing Choice Vouchers");
  });

  it("agencyCodeOf covers state/county/city/tract/CBSA and refuses anything pictureEntityOf refuses", () => {
    const def = byName("subsidized_units");
    expect(def.agencyCodeOf(ST_JOSEPH)).toBeDefined();
    expect(def.agencyCodeOf(SOUTH_BEND)).toBeDefined();
    expect(def.agencyCodeOf(SOUTH_BEND_METRO)).toBeDefined();
    expect(def.agencyCodeOf(TRACT)).toBeDefined();
    expect(def.agencyCodeOf(BLOCK)).toBeUndefined();
  });

  it("builds a series id that changes with the program dimension (same place, different codes)", () => {
    const def = byName("subsidized_units");
    const code = def.agencyCodeOf(ST_JOSEPH);
    if (!code) throw new Error("expected a code for St. Joseph County");
    const summary = def.buildSeriesId(code, { seasonallyAdjusted: false, dimensions: {} });
    const vouchers = def.buildSeriesId(code, {
      seasonallyAdjusted: false,
      dimensions: { program: "3" },
    });
    expect(summary).not.toBe(vouchers);
  });
});

describe("picture indicators over recorded fixtures, via the mounted HUD tools (#236)", () => {
  const FIXTURES = fileURLToPath(new URL("../fixtures", import.meta.url));
  let catalogPath: string;
  let catalog: GeographyCatalog;

  beforeAll(() => {
    catalogPath = buildFixtureCatalog();
    catalog = new GeographyCatalog(catalogPath);
  });
  afterAll(() => {
    catalog.close();
    rmSync(dirname(catalogPath), { recursive: true, force: true });
  });

  const server = (now = () => new Date("2026-09-24")) =>
    buildHudDefinition({
      catalog,
      httpClient: createHttpClient({
        source: "hud",
        budget: new MemoryBudgetStore(1000),
        cache: new MemoryCacheStore(),
        fixtures: { mode: "replay", dir: FIXTURES },
      }),
      token: () => "test-token",
      now,
    });

  const getIndicator = (def = server()) => {
    const tool = def.tools.find((t) => t.name === "hud_get_indicator");
    if (!tool) throw new Error("hud_get_indicator not mounted");
    return tool;
  };

  it("St. Joseph County summary units: no year given defaults to the latest published (2025)", async () => {
    const res = await getIndicator().handler({
      place: "St. Joseph County",
      state: "IN",
      kind: "county",
      indicator: "subsidized_units",
    });
    const data = res.data as { latest: { period: string; value: number } | null };
    expect(data.latest).toEqual({ period: "2025-A01", value: 5978 });
    expect(res.source.citation).toMatch(/HUD/);
  });

  it("St. Joseph County, program 3 (Housing Choice Vouchers), 2024: the total row, not a sub-program row", async () => {
    const res = await getIndicator().handler({
      place: "St. Joseph County",
      state: "IN",
      kind: "county",
      indicator: "subsidized_units",
      program: "3",
      startYear: 2024,
      endYear: 2024,
    });
    const data = res.data as { latest: { period: string; value: number } | null };
    expect(data.latest).toEqual({ period: "2024-A01", value: 3075 });
  });

  it("South Bend city, 2024: subsidized people for the program summary", async () => {
    const res = await getIndicator().handler({
      place: "South Bend",
      state: "IN",
      kind: "city",
      indicator: "subsidized_people",
      startYear: 2024,
      endYear: 2024,
    });
    const data = res.data as { latest: { period: string; value: number } | null };
    expect(data.latest).toEqual({ period: "2024-A01", value: 8350 });
  });

  it("South Bend-Mishawaka CBSA, 2024: average household income for the program summary", async () => {
    const res = await getIndicator().handler({
      place: "South Bend",
      kind: "metro",
      indicator: "average_household_income",
      startYear: 2024,
      endYear: 2024,
    });
    const data = res.data as { latest: { period: string; value: number } | null };
    expect(data.latest).toEqual({ period: "2024-A01", value: 14537 });
  });

  it("St. Joseph County, 2012: string-typed numbers parse, and the census caveat names the 2010 vintage", async () => {
    const res = await getIndicator().handler({
      place: "St. Joseph County",
      state: "IN",
      kind: "county",
      indicator: "subsidized_units",
      startYear: 2012,
      endYear: 2012,
    });
    const data = res.data as { latest: { period: string; value: number } | null };
    expect(data.latest).toEqual({ period: "2012-A01", value: 6068 });
    expect((res.limitations ?? []).join(" ")).toMatch(/2010 census vintage/);
  });

  it("months_waiting for a program that HUD did not report (sentinel -1) comes back null with a footnote", async () => {
    const res = await getIndicator().handler({
      place: "St. Joseph County",
      state: "IN",
      kind: "county",
      indicator: "months_waiting",
      program: "5",
      startYear: 2024,
      endYear: 2024,
    });
    const data = res.data as { latest: { period: string; value: number | null } | null };
    expect(data.latest).toEqual({ period: "2024-A01", value: null });
    expect(res.footnotes?.[0]?.code).toBe("-1");
    expect(res.footnotes?.[0]?.text).toMatch(/not reported/);
  });

  it("share below 30% AMI, St. Joseph County, no year: latest published carries the 2020 census note", async () => {
    const res = await getIndicator().handler({
      place: "St. Joseph County",
      state: "IN",
      kind: "county",
      indicator: "share_below_30_ami",
    });
    const data = res.data as { latest: { period: string; value: number } | null };
    expect(data.latest).toEqual({ period: "2025-A01", value: 75 });
    expect((res.limitations ?? []).join(" ")).toMatch(/2020 census vintage/);
  });
});
