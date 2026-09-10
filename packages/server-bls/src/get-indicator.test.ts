import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { GeographyCatalog } from "@federal-mcps/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { blsIndicatorTools } from "./get-indicator.js";
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

  it("dispatches CPI cpi_all_items for a published metro to its CU series (Denver)", async () => {
    const res = await run({ place: "Denver", kind: "metro", indicator: "cpi_all_items" });
    expect(res.source.ids).toEqual(["CUURS48BSA0"]);
    expect(res.source.program).toBe("CPI");
    expect(res.place?.geoid).toBe("19740");
    expect(res.limitations ?? []).toEqual([]); // Denver is published — no "no local CPI" caveat
  });

  it("falls back to the U.S. city average with a caveat where CPI is not published", async () => {
    const res = await run({ place: "Denver", kind: "county", indicator: "cpi_all_items" });
    expect(res.source.ids).toEqual(["CUUR0000SA0"]);
    expect(res.source.program).toBe("CPI");
    expect(res.limitations?.join(" ")).toMatch(/not published for Denver County/i);
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

function listTool(client = scriptedBlsClient()) {
  return blsIndicatorTools({ catalog: () => catalog, httpClient: () => client, now: NOW })[1];
}
function rawTool(client = scriptedBlsClient()) {
  return blsIndicatorTools({ catalog: () => catalog, httpClient: () => client, now: NOW })[2];
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
    ]);
    expect(data.indicators[0]?.description.length).toBeGreaterThan(0);
  });

  it("reports a county publishes LAUS at its own level", async () => {
    const res = await call(listTool(), { place: "Denver", kind: "county" });
    const data = res.data as { publishedAtLevel: boolean };
    expect(data.publishedAtLevel).toBe(true);
    expect(res.place?.geoid).toBe("08031");
  });

  it("flags a below-threshold city as falling back to its county", async () => {
    const res = await call(listTool(), { place: "Smallburg", kind: "city" });
    const data = res.data as { publishedAtLevel: boolean; fallback?: { name: string } };
    expect(data.publishedAtLevel).toBe(false);
    expect(data.fallback?.name).toBe("Denver County");
    expect(res.limitations?.join(" ")).toMatch(/fall back to Denver County/);
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

  it("rejects ids that are not LAUS series ids", async () => {
    await expect(call(rawTool(), { ids: ["not-a-series"] })).rejects.toThrow(/not LAUS series ids/);
  });
});
