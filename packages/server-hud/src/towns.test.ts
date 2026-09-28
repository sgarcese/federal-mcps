import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
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
import { fmrEntityOf, fmrUrl, ilUrl, mtspUrl } from "./hud-api.js";

/**
 * New England towns and other county subdivisions (#241). HUD publishes FMR and Income Limits by
 * town in New England; its town id is the Census county-subdivision GEOID, and Connecticut's
 * changed with the 2022 planning regions (FMR takes the new id from FY2026, IL and MTSP from
 * FY2025; verified through hud_get_raw 2026-09-28). Fixtures: scripts/record-hud-fixtures-via-server.mts.
 */

const place = (sumlevel: string, geoid: string, codes: { program: string; code: string }[] = []) =>
  ({
    geoid,
    kind: { sumlevel, label: "" },
    agencyCodes: codes.map((c) => ({ agency: "census", ...c })),
  }) as unknown as PlaceCandidate;

describe("fmrEntityOf: towns (#241)", () => {
  it("a New England town is its county-subdivision GEOID", () => {
    expect(fmrEntityOf(place("060", "2502507000"))).toBe("2502507000");
  });

  it("a recoded Connecticut town carries its 2020 id too", () => {
    expect(
      fmrEntityOf(place("060", "0911037070", [{ program: "GEOID2020", code: "0900337070" }])),
    ).toBe("0911037070~0900337070");
  });

  it("a New England county, and a county subdivision outside New England, have no entity of their own", () => {
    expect(fmrEntityOf(place("050", "25025"))).toBeUndefined();
    expect(fmrEntityOf(place("060", "4201916920"))).toBeUndefined();
  });
});

describe("URL builders pick a Connecticut town's id by fiscal year (#241)", () => {
  const HARTFORD = "0911037070~0900337070";
  const base = "https://www.huduser.gov/hudapi/public";

  it("FMR: the new id for the latest and FY2026 on, the 2020 id through FY2025", () => {
    expect(fmrUrl(HARTFORD)).toBe(`${base}/fmr/data/0911037070`);
    expect(fmrUrl(HARTFORD, 2026)).toBe(`${base}/fmr/data/0911037070?year=2026`);
    expect(fmrUrl(HARTFORD, 2025)).toBe(`${base}/fmr/data/0900337070?year=2025`);
  });

  it("Income Limits and MTSP: the new id from FY2025, the 2020 id through FY2024", () => {
    expect(ilUrl(HARTFORD)).toBe(`${base}/il/data/0911037070`);
    expect(ilUrl(HARTFORD, 2025)).toBe(`${base}/il/data/0911037070?year=2025`);
    expect(ilUrl(HARTFORD, 2024)).toBe(`${base}/il/data/0900337070?year=2024`);
    expect(mtspUrl(HARTFORD, 2024)).toBe(`${base}/mtspil/data/0900337070?year=2024`);
  });

  it("a plain id is untouched", () => {
    expect(fmrUrl("1814199999", 2025)).toBe(`${base}/fmr/data/1814199999?year=2025`);
  });
});

describe("hud_get_indicator for towns (#241)", () => {
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
  const get = (input: Record<string, unknown>) => {
    const tool = buildHudDefinition({
      catalog,
      httpClient: createHttpClient({
        source: "hud",
        budget: new MemoryBudgetStore(100),
        cache: new MemoryCacheStore(),
        fixtures: { mode: "replay", dir: FIXTURES },
      }),
      token: () => "test-token",
      now: () => new Date("2026-09-28"),
    }).tools.find((t) => t.name === "hud_get_indicator");
    if (!tool) throw new Error("hud_get_indicator not mounted");
    // biome-ignore lint/suspicious/noExplicitAny: handler args are untyped in tests.
    return tool.handler(input as any, {} as any);
  };
  type Answer = {
    status?: string;
    latest?: { year: string; value: number | null } | null;
    observations?: { year: string; value: number | null }[];
  };

  it("Boston (the city) answers with Boston's town FMR, saying HUD publishes by town", async () => {
    const res = await get({ place: "Boston, MA", indicator: "fair_market_rent" });
    expect((res.data as Answer).latest?.value).toBe(3008);
    expect((res.limitations ?? []).join(" ")).toMatch(/by town/);
  });

  it("a Vermont town: Burlington", async () => {
    const res = await get({ place: "Burlington", state: "VT", indicator: "fair_market_rent" });
    expect((res.data as Answer).latest?.value).toBe(2165);
  });

  it("a Connecticut town across HUD's id change: FY2026 on the new id, FY2025 on the 2020 id", async () => {
    const res = await get({
      place: "Hartford",
      state: "CT",
      kind: "township",
      indicator: "fair_market_rent",
      startYear: 2025,
      endYear: 2026,
    });
    expect((res.data as Answer).observations?.map((o) => [o.year, o.value])).toEqual([
      ["2026", 1865],
      ["2025", 1653],
    ]);
  });

  it("the latest Connecticut FMR (FY2027) on the new id", async () => {
    const res = await get({
      place: "Hartford",
      state: "CT",
      kind: "township",
      indicator: "fair_market_rent",
    });
    expect((res.data as Answer).latest?.value).toBe(1933);
  });

  it("a New England county is unavailable, and says HUD publishes there by town", async () => {
    const res = await get({
      place: "Suffolk County",
      state: "MA",
      kind: "county",
      indicator: "fair_market_rent",
    });
    expect((res.data as Answer).status).toBe("unavailable");
    expect((res.limitations ?? []).join(" ")).toMatch(/New England.*by town/);
  });

  it("a township outside New England answers with its county's FMR area", async () => {
    const res = await get({
      place: "Cranberry",
      state: "PA",
      kind: "township",
      indicator: "fair_market_rent",
    });
    expect((res.data as Answer).latest?.value).toBe(1389);
    expect((res.limitations ?? []).join(" ")).toMatch(/Butler County/);
  });

  it("Income Limits by town: Boston (latest) and Hartford FY2024 on the 2020 id", async () => {
    const boston = await get({ place: "Boston, MA", indicator: "income_limit" });
    expect((boston.data as Answer).latest?.value).toBe(137100);
    const hartford = await get({
      place: "Hartford",
      state: "CT",
      kind: "township",
      indicator: "income_limit",
      startYear: 2024,
      endYear: 2024,
    });
    expect((hartford.data as Answer).observations?.map((o) => [o.year, o.value])).toEqual([
      ["2024", 97450],
    ]);
  });
});
