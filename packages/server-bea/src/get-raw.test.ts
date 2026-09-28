import { fileURLToPath } from "node:url";
import {
  createHttpClient,
  MemoryBudgetStore,
  MemoryCacheStore,
  RAW_TEXT_BUDGET,
  renderText,
} from "@federal-mcps/core";
import { describe, expect, it } from "vitest";
import { beaBodyError, sanitizeBeaBody } from "./bea-api.js";
import { BEA_REQUIRED_SENTENCE } from "./describe-source.js";
import { beaGetRawTool, renderBeaRaw } from "./get-raw.js";

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
const NOW = new Date("2026-09-28T12:00:00Z");
const tool = () => beaGetRawTool({ httpClient: replay, apiKey: () => "test-key", now: () => NOW });
// biome-ignore lint/suspicious/noExplicitAny: handler args and envelope data are untyped in tests.
type AnyArgs = any;
const call = (args: Record<string, unknown>) => tool().handler(args as AnyArgs, {} as AnyArgs);

describe("bea_get_raw input (#262, ADR-019 §9)", () => {
  it.each([
    ["a malformed table", { table: "cainc1; drop", lineCode: 1, ids: ["18141"] }],
    ["a malformed GeoFips", { table: "CAINC1", lineCode: 1, ids: ["1814"] }],
    [
      "LineCode ALL with more than one place",
      { table: "CAINC1", lineCode: "ALL", ids: ["18141", "17031"] },
    ],
    [
      "two bulk parameters at once (all counties, all years)",
      { table: "CAINC1", lineCode: 1, ids: ["COUNTY"], span: "ALL" },
    ],
    [
      "years and a span together",
      { table: "CAINC1", lineCode: 1, ids: ["18141"], years: [2024], span: "LAST5" },
    ],
    ["no ids", { table: "CAINC1", lineCode: 1, ids: [] }],
  ])("rejects %s", async (_label, args) => {
    await expect(call(args)).rejects.toThrow();
  });
});

describe("bea_get_raw against recorded responses", () => {
  it("returns BEA's rows unchanged, cites the key-less URL with BEA's sentence", async () => {
    const res = await call({
      table: "CAINC1",
      lineCode: 3,
      ids: ["18141"],
      years: [2021, 2022, 2023, 2024],
    });
    const data = res.data as AnyArgs;
    expect(data.rows.map((r: AnyArgs) => r.DataValue)).toEqual([
      "55841",
      "56225",
      "56869",
      "59030",
    ]);
    expect(data.statistic).toBe("Per capita personal income");
    expect(res.source.ids).toEqual([
      "https://apps.bea.gov/api/data?method=GetData&datasetname=Regional&TableName=CAINC1&LineCode=3&GeoFips=18141&Year=2021,2022,2023,2024&ResultFormat=JSON",
    ]);
    expect(res.source.citation).toMatch(/^U\.S\. Bureau of Economic Analysis, CAINC1/);
    expect(res.source.citation.endsWith(BEA_REQUIRED_SENTENCE)).toBe(true);
    expect((res.limitations ?? []).join(" ")).toMatch(/Last updated/);
  });

  it("flags a suppressed cell: BEA's 0 with (D) is not zero", async () => {
    const res = await call({ table: "CAGDP9", lineCode: 11, ids: ["48301"] });
    expect((res.limitations ?? []).join(" ")).toMatch(/\(D\).*not a zero/);
  });

  it("several places in one call", async () => {
    const res = await call({ table: "MARPP", lineCode: 1, ids: ["43780", "16980"] });
    const geos = new Set((res.data as AnyArgs).rows.map((r: AnyArgs) => r.GeoFips));
    expect([...geos].sort()).toEqual(["16980", "43780"]);
  });
});

describe("renderBeaRaw (ADR-017)", () => {
  it("prints the statistic and unit once, then one CSV line per row, cut to the raw budget", async () => {
    const res = await call({ table: "MARPP", lineCode: 1, ids: ["43780", "16980"] });
    const r = renderBeaRaw(res.data);
    expect(r?.unit).toBe("rows");
    expect(r?.head[0]).toMatch(/^MARPP line 1: /);
    expect(r?.head).toContain("columns: GeoFips,GeoName,TimePeriod,DataValue,NoteRef");
    expect(r?.items.length).toBeGreaterThan(1);
    const text = renderText(
      { footnotes: [], limitations: [], ...res, retrievedAt: NOW.toISOString() } as AnyArgs,
      { renderData: renderBeaRaw, textBudget: RAW_TEXT_BUDGET },
    );
    expect(text.length).toBeLessThan(RAW_TEXT_BUDGET);
  });
});
