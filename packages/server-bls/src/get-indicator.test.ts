import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { GeographyCatalog, type HttpClient, type HttpResult } from "@federal-mcps/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { blsIndicatorTools } from "./get-indicator.js";
import { blsIndicatorDefinitions } from "./indicators.js";
import type { IndicatorDefinition } from "@federal-mcps/core";
import { buildFixtureCatalog } from "./__fixtures__/build-fixture.js";
import { scriptedBlsClient } from "./__fixtures__/scripted-client.js";

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

const NOW = () => new Date("2025-02-01T00:00:00Z");

function tool(client = scriptedBlsClient()) {
  return blsIndicatorTools({ catalog: () => catalog, httpClient: () => client, now: NOW })[0];
}

// biome-ignore lint/suspicious/noExplicitAny: reading the envelope's untyped data in tests.
const run = (args: Record<string, unknown>) => tool().handler(args as any, {} as any);

describe("bls_get_indicator", () => {
  it("returns Denver County's unemployment rate with the series id, citation and footnotes", async () => {
    const res = await run({ place: "Denver", kind: "county", indicator: "unemployment_rate" });
    const data = res.data as {
      indicator?: string;
      measure?: string;
      latest: { period: string; value: number };
    };
    expect(res.source.ids).toEqual(["LAUCN080310000000003"]);
    expect(res.source.program).toBe("LAUS");
    expect(res.source.citation).toMatch(/Bureau of Labor Statistics.*LAUCN080310000000003/);
    expect(res.place?.geoid).toBe("08031");
    expect(data.latest).toEqual({ period: "2024-M12", value: 3.9 });
    expect(res.vintage).toBe("2024-M12");
    expect(res.footnotes?.[0]).toMatchObject({ code: "P", flags: ["preliminary"] });
  });

  it("dispatches CES payroll_employment to the statewide SM series (Colorado)", async () => {
    const res = await run({ place: "Colorado", indicator: "payroll_employment" });
    expect(res.source.ids).toEqual(["SMU08000000000000001"]);
    expect(res.source.program).toBe("SM");
    expect(res.source.citation).toMatch(/Bureau of Labor Statistics.*SMU08000000000000001/);
    expect(res.place?.geoid).toBe("08");
    const data = res.data as { measure: string; latest: { value: number } | null };
    expect(data.measure).toBe("payroll_employment");
  });

  it("dispatches CES payroll_employment to a single-state metro's SM series (Denver, #110)", async () => {
    const res = await run({ place: "Denver", kind: "metro", indicator: "payroll_employment" });
    expect(res.source.ids).toEqual(["SMU08197400000000001"]); // state 08 + CBSA 19740
    expect(res.source.program).toBe("SM");
    expect(res.place?.geoid).toBe("19740");
  });

  it("dispatches CPI cpi_all_items for a published metro to its CU series (Denver)", async () => {
    const res = await run({ place: "Denver", kind: "metro", indicator: "cpi_all_items" });
    expect(res.source.ids).toEqual(["CUURS48BSA0"]);
    expect(res.source.program).toBe("CPI");
    expect(res.place?.geoid).toBe("19740");
    expect(res.limitations ?? []).toEqual([]); // Denver is published — no "no local CPI" caveat
  });

  it("falls back up the CPI ladder with a caveat where CPI is not published (county → Mountain division, #154)", async () => {
    const res = await run({ place: "Denver", kind: "county", indicator: "cpi_all_items" });
    expect(res.source.ids).toEqual(["CUUR0480SA0"]);
    expect(res.source.program).toBe("CPI");
    expect(res.limitations?.join(" ")).toMatch(
      /not published for Denver County.*Mountain division/is,
    );
  });

  it("dispatches OEWS occupational_wage to the statewide OE series (Colorado)", async () => {
    const res = await run({ place: "Colorado", indicator: "occupational_wage" });
    expect(res.source.ids).toEqual(["OEUS080000000000000000004"]);
    expect(res.source.program).toBe("OEWS");
    expect(res.source.citation).toMatch(/Bureau of Labor Statistics.*OEUS080000000000000000004/);
    expect(res.place?.geoid).toBe("08");
    const data = res.data as { measure: string; latest: { value: number } | null };
    expect(data.measure).toBe("occupational_wage");
  });

  it("dispatches JOLTS job_openings to the statewide JT series (Colorado)", async () => {
    const res = await run({ place: "Colorado", indicator: "job_openings" });
    expect(res.source.ids).toEqual(["JTU000000080000000JOL"]);
    expect(res.source.program).toBe("JOLTS");
    expect(res.place?.geoid).toBe("08");
    const data = res.data as { measure: string; latest: { value: number } | null };
    expect(data.measure).toBe("job_openings");
  });

  it("dispatches QCEW covered_employment via the CSV client (Denver County)", async () => {
    const csv = [
      '"area_fips","own_code","industry_code","agglvl_code","size_code","year","qtr","disclosure_code","qtrly_estabs","month1_emplvl","month2_emplvl","month3_emplvl","total_qtrly_wages","taxable_qtrly_wages","qtrly_contributions","avg_wkly_wage"',
      '"08031","0","10","70","0","2024","1","",45970,559807,561820,561041,15497545518,7590975514,149132980,2125',
    ].join("\n");
    const notUsed = () => {
      throw new Error("only getText");
    };
    const qcewClient: HttpClient = {
      getJson: notUsed,
      postJson: notUsed,
      async getText(): Promise<HttpResult<string>> {
        return { value: csv, status: 200, cache: { hit: false } };
      },
    };
    const getIndicator = blsIndicatorTools({
      catalog: () => catalog,
      httpClient: () => qcewClient,
      now: NOW,
    })[0];
    const res = await call(getIndicator, {
      place: "Denver",
      kind: "county",
      indicator: "covered_employment",
    });
    expect(res.source.program).toBe("QCEW");
    // the QCEW key is area|ownership|industry; covered_employment defaults to total-covered/all-industries (#151)
    expect(res.source.ids).toEqual(["08031|0|10"]);
    const data = res.data as { measure: string; latest: { period: string; value: number } | null };
    expect(data.measure).toBe("covered_employment");
    expect(data.latest).toEqual({ period: "2024-Q01", value: 560889 });
  });

  it("builds the right series id per indicator and seasonal flag", async () => {
    const emp = await run({ place: "Denver", kind: "county", indicator: "employment" });
    expect(emp.source.ids).toEqual(["LAUCN080310000000005"]); // measure 05 = employment
    const sa = await run({
      place: "Denver",
      kind: "county",
      indicator: "unemployment_rate",
      seasonallyAdjusted: true,
    });
    expect(sa.source.ids).toEqual(["LASCN080310000000003"]); // S = seasonally adjusted
  });

  it("falls back to the county for a below-threshold city, with an explicit caveat", async () => {
    const res = await run({ place: "Smallburg", kind: "city", indicator: "unemployment_rate" });
    expect(res.place?.geoid).toBe("08031"); // reported as the county
    expect(res.source.ids).toEqual(["LAUCN080310000000003"]); // county's LAUS series
    expect(res.limitations?.join(" ")).toMatch(/below the LAUS 25,000 city threshold/);
    expect(res.limitations?.join(" ")).toMatch(/Denver County/);
  });

  it("stops as ambiguous when a bare name means several kinds", async () => {
    const res = await run({ place: "Denver", indicator: "unemployment_rate" });
    const data = res.data as { status: string };
    expect(data.status).toBe("ambiguous");
    expect(res.source.ids).toEqual([]);
  });

  it("returns not_found for a name that resolves to nothing", async () => {
    const res = await run({ place: "Nowheresville", indicator: "unemployment_rate" });
    expect((res.data as { status: string }).status).toBe("not_found");
  });
});

function toolNamed(name: string, client = scriptedBlsClient()) {
  const t = blsIndicatorTools({ catalog: () => catalog, httpClient: () => client, now: NOW }).find(
    (x) => x.name === name,
  );
  if (!t) throw new Error(`no tool named ${name}`);
  return t;
}
function listTool(client = scriptedBlsClient()) {
  return toolNamed("bls_list_indicators", client);
}
function rawTool(client = scriptedBlsClient()) {
  return toolNamed("bls_get_raw", client);
}
function compareTool(client = scriptedBlsClient()) {
  return toolNamed("bls_compare_places", client);
}
const call = (t: ReturnType<typeof listTool>, args: Record<string, unknown>) =>
  // biome-ignore lint/suspicious/noExplicitAny: reading the envelope's untyped data in tests.
  t.handler(args as any, {} as any);

describe("bls_list_indicators", () => {
  it("lists the registered indicators with descriptions (LAUS + CES payroll + OEWS wage)", async () => {
    const res = await call(listTool(), {});
    const data = res.data as { indicators: { indicator: string; description: string }[] };
    expect(data.indicators.map((i) => i.indicator)).toEqual([
      "unemployment_rate",
      "unemployment",
      "employment",
      "labor_force",
      "payroll_employment",
      "cpi_all_items",
      "occupational_wage",
      "job_openings",
      "hires",
      "quits",
      "layoffs",
      "covered_employment",
      "average_weekly_wage",
      "producer_price_index",
    ]);
    expect(data.indicators[0]?.description.length).toBeGreaterThan(0);
  });

  type IndicatorAvailability = {
    indicator: string;
    program: string;
    publishedAtLevel: boolean;
    fallbackTo?: string;
  };

  it("reports per-indicator availability at a county: LAUS at its own level, CPI via fallback", async () => {
    const res = await call(listTool(), { place: "Denver", kind: "county" });
    const data = res.data as { indicators: IndicatorAvailability[] };
    const laus = data.indicators.find((i) => i.indicator === "unemployment_rate");
    expect(laus).toMatchObject({ program: "LAUS", publishedAtLevel: true });
    // CPI does not publish for a county, so it reports its Census-division fallback (#154).
    const cpi = data.indicators.find((i) => i.indicator === "cpi_all_items");
    expect(cpi).toMatchObject({ program: "CPI", publishedAtLevel: false });
    expect(cpi?.fallbackTo).toBe("Mountain division");
    expect(res.place?.geoid).toBe("08031");
  });

  it("flags a below-threshold city's LAUS indicator as falling back to its county", async () => {
    const res = await call(listTool(), { place: "Smallburg", kind: "city" });
    const data = res.data as { indicators: IndicatorAvailability[] };
    const laus = data.indicators.find((i) => i.indicator === "unemployment_rate");
    expect(laus?.publishedAtLevel).toBe(false);
    expect(laus?.fallbackTo).toBe("Denver County");
  });

  it("carries the program on each indicator when no place is given", async () => {
    const res = await call(listTool(), {});
    const data = res.data as { indicators: { indicator: string; program: string }[] };
    const programs = new Set(data.indicators.map((i) => i.program));
    expect(programs).toEqual(new Set(["LAUS", "SM", "CPI", "OEWS", "JOLTS", "QCEW", "PPI"]));
  });
});

describe("bls_get_raw", () => {
  it("returns the unprocessed BLS response for valid series ids, with the ids in the source", async () => {
    const res = await call(rawTool(), { ids: ["LAUCN080310000000003"] });
    const data = res.data as { ids: string[]; responses: { status: string }[] };
    expect(data.ids).toEqual(["LAUCN080310000000003"]);
    expect(data.responses[0]?.status).toBe("REQUEST_SUCCEEDED");
    expect(res.source.ids).toEqual(["LAUCN080310000000003"]);
    expect(res.source.citation).toMatch(/LAUCN080310000000003/);
  });

  it("rejects ids that are not BLS timeseries ids", async () => {
    await expect(call(rawTool(), { ids: ["not-a-series"] })).rejects.toThrow(
      /not BLS timeseries ids/,
    );
  });
});

describe("bls_compare_places", () => {
  it("compares one indicator across places, aligned on the latest common period", async () => {
    const res = await call(compareTool(), {
      indicator: "unemployment_rate",
      places: ["Denver County", "Fairfield County"],
    });
    const data = res.data as {
      indicator: string;
      period: string | null;
      rows: { query: string; status: string; value: number | null; seriesId?: string }[];
    };
    expect(data.indicator).toBe("unemployment_rate");
    expect(data.period).toBe("2024-M12");
    expect(data.rows).toHaveLength(2);
    expect(data.rows.every((r) => r.status === "ok" && r.value === 3.9)).toBe(true);
    expect(res.source.ids).toEqual(["LAUCN080310000000003", "LAUCN090010000000003"]);
    expect(res.source.citation).toMatch(/Bureau of Labor Statistics/);
  });

  it("labels a below-threshold fallback and keeps an unmatched place as a row, never dropped", async () => {
    const res = await call(compareTool(), {
      indicator: "unemployment_rate",
      places: ["Smallburg", "Nowheresville"],
    });
    const data = res.data as {
      rows: { query: string; status: string; value: number | null; caveat?: string }[];
    };
    expect(data.rows).toHaveLength(2);
    const smallburg = data.rows.find((r) => r.query === "Smallburg");
    expect(smallburg?.status).toBe("fallback");
    expect(smallburg?.value).toBe(3.9);
    expect(smallburg?.caveat).toMatch(/below the LAUS 25,000 city threshold/);
    const missing = data.rows.find((r) => r.query === "Nowheresville");
    expect(missing?.status).toBe("not_found");
    expect(missing?.value).toBeNull();
  });

  it("rejects fewer than 2 or more than 20 places", async () => {
    await expect(call(compareTool(), { places: ["Denver County"] })).rejects.toThrow();
    const many = Array.from({ length: 21 }, (_, i) => `Place ${i}`);
    await expect(call(compareTool(), { places: many })).rejects.toThrow();
  });
});

describe("tool descriptions match what the server actually serves (#138)", () => {
  const tools = blsIndicatorTools({ catalog: () => catalog, httpClient: () => client, now: NOW });
  const byName = new Map(tools.map((t) => [t.name, t]));

  for (const name of ["bls_get_indicator", "bls_list_indicators"]) {
    it(`${name} names all six programs`, () => {
      const description = byName.get(name)?.description ?? "";
      for (const program of ["LAUS", "CES", "OEWS", "CPI", "JOLTS", "QCEW"]) {
        expect(description, `${name} omits ${program}`).toContain(program);
      }
    });
  }

  it("bls_get_raw is not described as LAUS-only", () => {
    expect(byName.get("bls_get_raw")?.description).not.toMatch(/LAUS series ids/);
  });

  it("every tool carries a title", () => {
    for (const tool of tools) expect(tool.title, `${tool.name}`).toMatch(/\S/);
  });
});

describe("dimension seam (#149): named picker arguments on the tools", () => {
  /** A stub indicator that declares an `item` dimension and encodes the chosen code in its id. */
  const itemStub: IndicatorDefinition = {
    name: "stub_item",
    program: "LAUS",
    description: "stub with an item dimension",
    defaultSeasonallyAdjusted: false,
    agencyCodeOf: (place) =>
      place.agencyCodes.find((c) => c.agency === "bls" && c.program === "LAUS")?.code,
    buildSeriesId: (code, { dimensions }) => `LAU${code}${dimensions.item}`,
    dimensions: [
      {
        argument: "item",
        description: "Which item.",
        default: "03",
        vocabulary: [
          { code: "03", label: "rate" },
          { code: "04", label: "level" },
        ],
      },
    ],
  };
  const tools = blsIndicatorTools({
    catalog: () => catalog,
    httpClient: () => scriptedBlsClient(),
    now: NOW,
    definitions: [...blsIndicatorDefinitions, itemStub],
  });
  const named = (n: string) => {
    const t = tools.find((x) => x.name === n);
    if (!t) throw new Error(n);
    return t;
  };
  // biome-ignore lint/suspicious/noExplicitAny: reading the envelope's untyped data in tests.
  const go = (n: string, args: Record<string, unknown>) => named(n).handler(args as any, {} as any);

  it("applies the dimension default and reports the selection", async () => {
    const res = await go("bls_get_indicator", {
      place: "Denver",
      kind: "county",
      indicator: "stub_item",
    });
    expect(res.source.ids).toEqual(["LAUCN080310000000003"]);
    expect((res.data as { dimensions: unknown }).dimensions).toEqual({ item: "03" });
  });

  it("passes an explicit dimension code to the series-id builder", async () => {
    const res = await go("bls_get_indicator", {
      place: "Denver",
      kind: "county",
      indicator: "stub_item",
      item: "04",
    });
    expect(res.source.ids).toEqual(["LAUCN080310000000004"]);
  });

  it("rejects a code outside the vocabulary with the accepted list", async () => {
    await expect(
      go("bls_get_indicator", {
        place: "Denver",
        kind: "county",
        indicator: "stub_item",
        item: "99",
      }),
    ).rejects.toThrow(/item.*"99".*03.*04/s);
  });

  it("rejects a dimension argument on an indicator that declares none", async () => {
    await expect(
      go("bls_get_indicator", {
        place: "Denver",
        kind: "county",
        indicator: "unemployment_rate",
        occupation: "110000",
      }),
    ).rejects.toThrow(/unemployment_rate.*no dimension/s);
  });

  it("bls_list_indicators publishes each indicator's dimensions and vocabulary", async () => {
    const res = await go("bls_list_indicators", {});
    const data = res.data as {
      indicators: {
        indicator: string;
        dimensions?: { argument: string; vocabulary: unknown[] }[];
      }[];
    };
    const stub = data.indicators.find((i) => i.indicator === "stub_item");
    expect(stub?.dimensions?.[0]?.argument).toBe("item");
    expect(stub?.dimensions?.[0]?.vocabulary).toHaveLength(2);
    expect(
      data.indicators.find((i) => i.indicator === "unemployment_rate")?.dimensions,
    ).toBeUndefined();
  });

  it("bls_compare_places carries the same dimension to every place", async () => {
    const res = await go("bls_compare_places", {
      indicator: "stub_item",
      places: ["Colorado", "Denver County"],
      item: "04",
    });
    expect(res.source.ids.every((id) => id.endsWith("04"))).toBe(true);
    expect((res.data as { dimensions: unknown }).dimensions).toEqual({ item: "04" });
  });
});

describe("multi-state metro CES (#153)", () => {
  it("serves Chicago payroll employment under the first state, with the caveat in limitations", async () => {
    const res = await run({ place: "Chicago", kind: "metro", indicator: "payroll_employment" });
    expect(res.source.ids).toEqual(["SMU17169800000000001"]);
    expect(res.place?.geoid).toBe("16980");
    expect(res.limitations?.join(" ")).toMatch(/multi-state.*Illinois/);
  });
});

describe("OEWS occupation picker + metro coverage (#152)", () => {
  it("dispatches occupational_wage to the Denver metro OE series (kind: metro), all occupations by default", async () => {
    const res = await run({ place: "Denver", kind: "metro", indicator: "occupational_wage" });
    expect(res.source.ids).toEqual(["OEUM001974000000000000004"]);
    expect(res.source.program).toBe("OEWS");
    expect(res.place?.geoid).toBe("19740");
    const data = res.data as { measure: string; dimensions: unknown };
    expect(data.measure).toBe("occupational_wage");
    expect(data.dimensions).toEqual({ occupation: "000000" });
  });

  it("passes an explicit occupation code to the Colorado statewide OE series", async () => {
    const res = await run({
      place: "Colorado",
      indicator: "occupational_wage",
      occupation: "470000",
    });
    expect(res.source.ids).toEqual(["OEUS080000000000047000004"]);
    expect(res.source.program).toBe("OEWS");
    const data = res.data as { dimensions: unknown };
    expect(data.dimensions).toEqual({ occupation: "470000" });
  });

  it("rejects an occupation code outside the vocabulary, listing the accepted codes", async () => {
    await expect(
      run({ place: "Colorado", indicator: "occupational_wage", occupation: "999999" }),
    ).rejects.toThrow(/occupation.*"999999".*000000.*470000/s);
  });
});

describe("QCEW NAICS industry + ownership pickers, end-to-end (#151)", () => {
  const CSV = [
    '"area_fips","own_code","industry_code","agglvl_code","size_code","year","qtr","disclosure_code","qtrly_estabs","month1_emplvl","month2_emplvl","month3_emplvl","total_qtrly_wages","taxable_qtrly_wages","qtrly_contributions","avg_wkly_wage"',
    '"08031","0","10","70","0","2024","1","",45970,559807,561820,561041,15497545518,7590975514,149132980,2125',
    // Construction (NAICS 23), private ownership — verified live 2026-09-17 (agglvl 74, ADR-013 §2 / qcew.ts).
    '"08031","5","23","74","0","2024","1","",2131,21963,22241,22192,515298275,382512168,9375302,1791',
  ].join("\n");
  const notUsed = () => {
    throw new Error("only getText");
  };
  const qcewClient: HttpClient = {
    getJson: notUsed,
    postJson: notUsed,
    async getText(): Promise<HttpResult<string>> {
      return { value: CSV, status: 200, cache: { hit: false } };
    },
  };
  const getIndicator = () =>
    blsIndicatorTools({ catalog: () => catalog, httpClient: () => qcewClient, now: NOW })[0];
  // biome-ignore lint/suspicious/noExplicitAny: reading the envelope's untyped data in tests.
  const goQcew = (args: Record<string, unknown>) => getIndicator().handler(args as any, {} as any);

  it("picks the construction/private row and reports the dimensions and key", async () => {
    const res = await goQcew({
      place: "Denver",
      kind: "county",
      indicator: "average_weekly_wage",
      industry: "23",
      ownership: "5",
    });
    expect(res.source.ids).toEqual(["08031|5|23"]);
    const data = res.data as { dimensions: unknown; latest: { value: number } | null };
    expect(data.dimensions).toEqual({ industry: "23", ownership: "5" });
    expect(data.latest).toEqual({ period: "2024-Q01", value: 1791 });
  });

  it("rejects an industry code outside the vocabulary, listing what's accepted", async () => {
    await expect(
      goQcew({
        place: "Denver",
        kind: "county",
        indicator: "covered_employment",
        industry: "99",
      }),
    ).rejects.toThrow(/industry.*"99".*all industries/s);
  });
});

describe("national-scope indicators: PPI (#155, ADR-013 §7)", () => {
  it("answers with no place at all, reporting the United States", async () => {
    const res = await run({ indicator: "producer_price_index" });
    expect(res.source.ids).toEqual(["WPUFD4"]);
    expect(res.source.program).toBe("PPI");
    expect(res.place?.name).toBe("United States");
    expect(res.limitations ?? []).toEqual([]);
  });

  it("given a place, returns the national series with an explicit national-only caveat", async () => {
    const res = await run({
      place: "Denver",
      kind: "county",
      indicator: "producer_price_index",
      item: "IP2311001",
    });
    expect(res.source.ids).toEqual(["WPUIP2311001"]);
    expect(res.place?.name).toBe("United States");
    expect(res.limitations?.join(" ")).toMatch(
      /PPI is published nationally only.*not a Denver County figure/s,
    );
  });

  it("does not stop on an ambiguous place for a national indicator", async () => {
    const res = await run({ place: "Denver", indicator: "producer_price_index" });
    expect(res.source.ids).toEqual(["WPUFD4"]);
    expect(res.limitations?.join(" ")).toMatch(/nationally only/);
  });

  it("still requires a place for a place-scoped indicator", async () => {
    await expect(run({ indicator: "unemployment_rate" })).rejects.toThrow(/place is required/);
  });

  it("bls_compare_places rejects a national-only indicator with guidance", async () => {
    await expect(
      call(compareTool(), { indicator: "producer_price_index", places: ["Colorado", "Utah"] }),
    ).rejects.toThrow(/national.*bls_get_indicator/s);
  });

  it("bls_list_indicators marks the scope and reports it as published for any place", async () => {
    const res = await call(listTool(), { place: "Denver", kind: "county" });
    const data = res.data as {
      indicators: { indicator: string; scope?: string; publishedAtLevel: boolean }[];
    };
    const ppi = data.indicators.find((i) => i.indicator === "producer_price_index");
    expect(ppi).toMatchObject({ scope: "national", publishedAtLevel: true });
  });
});

describe("bls_get_raw accepts any BLS timeseries id, not only LAUS (#155)", () => {
  it("fetches a PPI and a CES id", async () => {
    const res = await call(rawTool(), { ids: ["WPUFD4", "SMU08000000000000001"] });
    expect((res.data as { ids: string[] }).ids).toEqual(["WPUFD4", "SMU08000000000000001"]);
  });
  it("still rejects an id that is not a BLS timeseries id", async () => {
    await expect(call(rawTool(), { ids: ["08031|0|10"] })).rejects.toThrow(
      /not BLS timeseries ids/,
    );
  });
});
