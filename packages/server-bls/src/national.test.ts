import { readFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createHttpClient,
  GeographyCatalog,
  type HttpClient,
  type HttpResult,
  MemoryBudgetStore,
  MemoryCacheStore,
} from "@federal-mcps/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildFixtureCatalog } from "./__fixtures__/build-fixture.js";
import { scriptedBlsClient } from "./__fixtures__/scripted-client.js";
import { blsIndicatorTools } from "./get-indicator.js";

/**
 * The United States as a place (#290): every BLS program answers the nation with its own national
 * series, or says plainly that it has none. LAUS publishes no national figure, so the nation's
 * labor force comes from CPS — and the answer says so.
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

const NOW = () => new Date("2026-09-30T00:00:00Z");
const tools = (client: HttpClient = scriptedBlsClient()) =>
  blsIndicatorTools({ catalog: () => catalog, httpClient: () => client, now: NOW });
// biome-ignore lint/suspicious/noExplicitAny: reading the envelope's untyped data in tests.
type AnyArgs = any;
const call = (name: string, args: Record<string, unknown>, client?: HttpClient) =>
  tools(client)
    .find((t) => t.name === name)
    ?.handler(args as AnyArgs, {} as AnyArgs) as Promise<{
    data: Record<string, unknown>;
    source: { program: string; ids: string[]; citation: string; url: string };
    place?: { geoid: string; ucgid: string; dcid: string; name: string };
    limitations?: string[];
  }>;
const get = (args: Record<string, unknown>, client?: HttpClient) =>
  call("bls_get_indicator", args, client);

const FIXTURE_DIR = fileURLToPath(new URL("../fixtures", import.meta.url));

describe("the nation's labor force comes from CPS, not LAUS (#290)", () => {
  it.each([
    ["unemployment_rate", "LNU04000000", "LNS14000000"],
    ["unemployment", "LNU03000000", "LNS13000000"],
    ["employment", "LNU02000000", "LNS12000000"],
    ["labor_force", "LNU01000000", "LNS11000000"],
  ])("%s → %s (NSA, LAUS's default) or %s (SA)", async (indicator, nsa, sa) => {
    const res = await get({ place: "United States", indicator });
    expect(res.source.ids).toEqual([nsa]);
    expect(res.source.program).toBe("CPS");
    expect(res.source.citation).toMatch(new RegExp(`, CPS, series ${nsa}`));
    expect(res.place).toMatchObject({ geoid: "US", ucgid: "0100000US", dcid: "country/USA" });
    expect(res.limitations?.join(" ")).toMatch(/Current Population Survey.*not LAUS/i);
    const adjusted = await get({ place: "US", indicator, seasonallyAdjusted: true });
    expect(adjusted.source.ids).toEqual([sa]);
  });

  it("replays the recorded national unemployment rate end to end", async () => {
    const replay = createHttpClient({
      source: "bls",
      budget: new MemoryBudgetStore(500),
      cache: new MemoryCacheStore(),
      fetch: vi.fn(() => {
        throw new Error("replay must not hit the network");
      }) as unknown as typeof fetch,
      fixtures: { mode: "replay", dir: FIXTURE_DIR },
    });
    const res = await get(
      { place: "United States", indicator: "unemployment_rate", startYear: 2024, endYear: 2025 },
      replay,
    );
    expect(res.data.latest).toEqual({ period: "2025-M12", value: 4.1 });
    expect(res.source.program).toBe("CPS");
  });

  it("a state keeps its LAUS series and no CPS caveat", async () => {
    // Colorado has no LAUS code in this fixture, so assert on a county instead.
    const res = await get({ place: "Denver", kind: "county", indicator: "unemployment_rate" });
    expect(res.source.program).toBe("LAUS");
    expect(res.source.ids).toEqual(["LAUCN080310000000003"]);
    expect(res.limitations ?? []).toEqual([]);
  });
});

describe("the other programs answer the nation with their national series (#290)", () => {
  it("CES: national payroll employment is the CE series, labelled CES", async () => {
    const res = await get({ place: "United States", indicator: "payroll_employment" });
    expect(res.source.ids).toEqual(["CEU0000000001"]);
    expect(res.source.program).toBe("CES");
    expect(res.limitations?.join(" ")).toMatch(/national.*not the sum of the states/i);
    const colorado = await get({ place: "Colorado", indicator: "payroll_employment" });
    expect(colorado.source.program).toBe("SM");
  });

  it("JOLTS: the national estimate (state code 00)", async () => {
    const res = await get({ place: "United States", indicator: "job_openings" });
    expect(res.source.ids).toEqual(["JTU000000000000000JOL"]);
    expect(res.source.program).toBe("JOLTS");
    const quits = await get({ place: "US", indicator: "quits" });
    expect(quits.source.ids).toEqual(["JTU000000000000000QUL"]);
  });

  it("OEWS: the national mean annual wage (area type N)", async () => {
    const res = await get({ place: "United States", indicator: "occupational_wage" });
    expect(res.source.ids).toEqual(["OEUN000000000000000000004"]);
    const construction = await get({
      place: "United States",
      indicator: "occupational_wage",
      occupation: "470000",
    });
    expect(construction.source.ids).toEqual(["OEUN000000000000047000004"]);
  });

  it("CPI: the U.S. city average directly, with no 'not published' fallback caveat", async () => {
    const res = await get({ place: "United States", indicator: "cpi_all_items" });
    expect(res.source.ids).toEqual(["CUUR0000SA0"]);
    expect(res.limitations ?? []).toEqual([]);
    expect(res.place?.geoid).toBe("US");
  });

  it("QCEW: the U.S. total (area US000) from its CSV slice", async () => {
    const csv = readFileSync(`${FIXTURE_DIR}/qcew/US000-2026-Q1.csv`, "utf8");
    const urls: string[] = [];
    const notUsed = () => {
      throw new Error("only getText");
    };
    const qcew: HttpClient = {
      getJson: notUsed,
      postJson: notUsed,
      async getText(url: string): Promise<HttpResult<string>> {
        urls.push(url);
        return { value: url.includes("/2026/1/") ? csv : "", status: 200, cache: { hit: false } };
      },
    };
    const wage = await get({ place: "United States", indicator: "average_weekly_wage" }, qcew);
    expect(wage.source.ids).toEqual(["US000|0|10"]);
    expect(urls.every((u) => u.endsWith("/area/US000.csv"))).toBe(true);
    expect(wage.data.latest).toEqual({ period: "2026-Q01", value: 1654 });
    const construction = await get(
      { place: "US", indicator: "covered_employment", industry: "23", ownership: "5" },
      qcew,
    );
    expect(construction.data.latest).toEqual({
      period: "2026-Q01",
      value: Math.round((8008425 + 8000703 + 8113824) / 3),
    });
  });

  it("PPI: asking for the United States is the national series, with no 'not a local figure' caveat", async () => {
    const res = await get({ place: "United States", indicator: "producer_price_index" });
    expect(res.limitations ?? []).toEqual([]);
    const local = await get({ place: "Colorado", indicator: "producer_price_index" });
    expect(local.limitations?.join(" ")).toMatch(/nationally only; this is not a Colorado figure/);
  });
});

describe("the nation beside local places (#290)", () => {
  it("compare_places puts the national benchmark beside a county, each from its own program", async () => {
    const res = await call("bls_compare_places", {
      indicator: "unemployment_rate",
      places: ["United States", "Denver County"],
    });
    expect(res.source.ids.sort()).toEqual(["LAUCN080310000000003", "LNU04000000"].sort());
    expect(res.source.citation).toMatch(/LNU04000000 \(Current Population Survey\)/);
    const rows = res.data.rows as { query: string; seriesId: string; caveat?: string }[];
    const us = rows.find((r) => r.query === "United States");
    expect(us?.seriesId).toBe("LNU04000000");
    expect(us?.caveat).toMatch(/Current Population Survey.*not LAUS/i);
    expect(rows.find((r) => r.query === "Denver County")?.caveat).toBeUndefined();
  });

  it("list_indicators says every program but PPI's local ones publishes at the nation's level", async () => {
    const res = await call("bls_list_indicators", { place: "United States" });
    const rows = res.data.indicators as { indicator: string; publishedAtLevel: boolean }[];
    const unpublished = rows.filter((r) => !r.publishedAtLevel).map((r) => r.indicator);
    expect(unpublished).toEqual([]);
  });

  it("bls_resolve_place-style resolution finds the nation by its short alias", async () => {
    const res = await get({ place: "US", indicator: "unemployment_rate" });
    expect(res.place?.name).toBe("United States");
  });
});
