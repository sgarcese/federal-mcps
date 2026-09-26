import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createHttpClient,
  GeographyCatalog,
  MemoryBudgetStore,
  MemoryCacheStore,
  type ToolDefinition,
  type ToolHandlerResult,
} from "@federal-mcps/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFixtureCatalog } from "./__fixtures__/build-fixture.js";
import { buildHudDefinition } from "./definition.js";
import { ilIndicatorDefinitions } from "./il-indicators.js";

const NOW = () => new Date("2026-09-24");

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
    budget: new MemoryBudgetStore(1000),
    cache: new MemoryCacheStore(),
    fixtures: { mode: "replay", dir: FIXTURES },
  });

const build = () =>
  buildHudDefinition({ catalog, httpClient: replay(), token: () => "test-token", now: NOW });

function toolNamed(name: string): ToolDefinition {
  const tool = build().tools.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool named ${name}`);
  return tool;
}

async function getIndicator(input: Record<string, unknown>): Promise<ToolHandlerResult> {
  return toolNamed("hud_get_indicator").handler(input, { now: NOW });
}

describe("ilIndicatorDefinitions (#234)", () => {
  it("registers income_limit (program IL), area_median_income (program IL) and mtsp_limit (program MTSP)", () => {
    const byName = new Map(ilIndicatorDefinitions.map((d) => [d.name, d]));
    expect(byName.get("income_limit")?.program).toBe("IL");
    expect(byName.get("area_median_income")?.program).toBe("IL");
    expect(byName.get("mtsp_limit")?.program).toBe("MTSP");
  });
});

describe("hud_get_indicator: income_limit (St. Joseph County, IN)", () => {
  it("defaults to level 80, household_size 4 — FY2026 low income limit for 4 people", async () => {
    const result = await getIndicator({ place: "St. Joseph County", state: "IN", indicator: "income_limit" });
    const data = result.data as { dimensions: { level: string; household_size: string }; latest: { value: number } };
    expect(data.dimensions).toEqual({ level: "80", household_size: "4" });
    expect(data.latest.value).toBe(70500);
    expect(result.vintage).toBe("2026-A01");
    expect(result.limitations?.some((l) => l.includes("South Bend-Mishawaka, IN HUD Metro FMR Area"))).toBe(true);
  });

  it("level 50 (very low), household_size 3", async () => {
    const result = await getIndicator({
      place: "St. Joseph County",
      state: "IN",
      indicator: "income_limit",
      level: "50",
      household_size: "3",
    });
    const data = result.data as { latest: { value: number } };
    expect(data.latest.value).toBe(39650);
  });

  it("rejects a level outside the vocabulary, naming what is accepted", async () => {
    await expect(getIndicator({ place: "St. Joseph County", state: "IN", indicator: "income_limit", level: "60" }))
      .rejects.toThrow(/income_limit's vocabulary/);
  });
});

describe("hud_get_indicator: area_median_income", () => {
  it("St. Joseph County, IN, FY2026", async () => {
    const result = await getIndicator({ place: "St. Joseph County", state: "IN", indicator: "area_median_income" });
    const data = result.data as { latest: { value: number } };
    expect(data.latest.value).toBe(88100);
    expect(result.vintage).toBe("2026-A01");
  });
});

describe("hud_get_indicator: mtsp_limit (St. Joseph County, IN)", () => {
  it("defaults to level 60, household_size 4", async () => {
    const result = await getIndicator({ place: "St. Joseph County", state: "IN", indicator: "mtsp_limit" });
    const data = result.data as { dimensions: { level: string; household_size: string }; latest: { value: number } };
    expect(data.dimensions).toEqual({ level: "60", household_size: "4" });
    expect(data.latest.value).toBe(52860);
  });

  it("a HERA special band", async () => {
    const result = await getIndicator({
      place: "St. Joseph County",
      state: "IN",
      indicator: "mtsp_limit",
      level: "hera_special_50",
      household_size: "1",
    });
    const data = result.data as { latest: { value: number } };
    expect(data.latest.value).toBe(31150);
  });
});

describe("hud_get_indicator: South Bend city falls back to St. Joseph County", () => {
  it("carries a caveat naming the county substitution", async () => {
    const result = await getIndicator({ place: "South Bend", state: "IN", indicator: "income_limit" });
    const data = result.data as { latest: { value: number } };
    expect(data.latest.value).toBe(70500);
    expect(result.place?.name).toBe("St. Joseph County");
    expect(
      result.limitations?.some((l) => l.includes("HUD publishes Income Limits and MTSP limits per income-limit area")),
    ).toBe(true);
  });
});

describe("hud_get_indicator: the metro has no Income Limits/MTSP entity", () => {
  it("reports unavailable rather than guessing a county", async () => {
    const result = await getIndicator({ place: "South Bend-Mishawaka", indicator: "income_limit" });
    const data = result.data as { status: string };
    expect(data.status).toBe("unavailable");
  });
});

describe("hud_get_indicator: an explicit FY2025–FY2026 history", () => {
  it("returns both fiscal years, newest first", async () => {
    const result = await getIndicator({
      place: "St. Joseph County",
      state: "IN",
      indicator: "income_limit",
      startYear: 2025,
      endYear: 2026,
    });
    const data = result.data as {
      observations: { year: string; period: string; periodName: string; value: number }[];
    };
    expect(data.observations.map((o) => [o.year, o.value])).toEqual([
      ["2026", 70500],
      ["2025", 70400],
    ]);
    expect(data.observations.every((o) => o.period === "A01")).toBe(true);
    expect(data.observations[0]?.periodName).toBe("FY2026");
  });
});

describe("hud_get_indicator: floored at FY2017", () => {
  it("a range starting before FY2017 is started there instead, with a note", async () => {
    const result = await getIndicator({
      place: "St. Joseph County",
      state: "IN",
      indicator: "income_limit",
      startYear: 2016,
      endYear: 2017,
    });
    const data = result.data as { observations: { year: string; value: number }[] };
    expect(data.observations).toEqual([{ year: "2017", value: 48800 }].map((o) => expect.objectContaining(o)));
    expect(result.limitations?.some((l) => l.includes("begin at fiscal year 2017"))).toBe(true);
  });

  it("a range entirely before FY2017 returns nothing, with a note", async () => {
    const result = await getIndicator({
      place: "St. Joseph County",
      state: "IN",
      indicator: "income_limit",
      startYear: 2015,
      endYear: 2016,
    });
    const data = result.data as { observations: unknown[] };
    expect(data.observations).toEqual([]);
    expect(result.limitations?.some((l) => l.includes("none of the requested"))).toBe(true);
  });
});
