import { fileURLToPath } from "node:url";
import { createHttpClient, MemoryBudgetStore, MemoryCacheStore } from "@federal-mcps/core";
import { describe, expect, it } from "vitest";
import { buildRawQueryUrl, censusGetRawTool } from "./get-raw.js";

const FIXTURES = fileURLToPath(new URL("../fixtures", import.meta.url));
const replay = () =>
  createHttpClient({
    source: "census",
    budget: new MemoryBudgetStore(100),
    cache: new MemoryCacheStore(),
    fixtures: { mode: "replay", dir: FIXTURES },
  });

const BASE = {
  dataset: "acs/acs5",
  year: 2024,
  ids: ["NAME", "B19013_001E", "B19013_001M"],
};

describe("buildRawQueryUrl (must match scripts/record-acs-fixtures.mts's hand-written fixture exactly)", () => {
  it("builds get + ucgid, ids joined by comma, no key", () => {
    expect(buildRawQueryUrl({ ...BASE, ucgid: "0500000US08031", descriptive: false })).toBe(
      "https://api.census.gov/data/2024/acs/acs5?get=NAME,B19013_001E,B19013_001M&ucgid=0500000US08031",
    );
  });

  it("builds get + for/in when ucgid is absent", () => {
    expect(
      buildRawQueryUrl({
        ...BASE,
        for: "county:031",
        in: "state:08",
        descriptive: false,
      }),
    ).toBe(
      "https://api.census.gov/data/2024/acs/acs5?get=NAME,B19013_001E,B19013_001M&for=county:031&in=state:08",
    );
  });

  it("builds for without in when in is absent", () => {
    expect(buildRawQueryUrl({ ...BASE, for: "state:*", descriptive: false })).toBe(
      "https://api.census.gov/data/2024/acs/acs5?get=NAME,B19013_001E,B19013_001M&for=state:*",
    );
  });

  it("carries a group() id in get= readably", () => {
    expect(
      buildRawQueryUrl({
        dataset: "acs/acs5",
        year: 2024,
        ids: ["group(B19013)"],
        ucgid: "0500000US08031",
        descriptive: false,
      }),
    ).toBe("https://api.census.gov/data/2024/acs/acs5?get=group(B19013)&ucgid=0500000US08031");
  });

  it("appends predicates after the geography", () => {
    expect(
      buildRawQueryUrl({
        ...BASE,
        ucgid: "0500000US08031",
        predicates: { SUMLEVEL: "050" },
        descriptive: false,
      }),
    ).toBe(
      "https://api.census.gov/data/2024/acs/acs5?get=NAME,B19013_001E,B19013_001M&ucgid=0500000US08031&SUMLEVEL=050",
    );
  });

  it("appends descriptive=true only when true", () => {
    expect(buildRawQueryUrl({ ...BASE, ucgid: "0500000US08031", descriptive: true })).toBe(
      "https://api.census.gov/data/2024/acs/acs5?get=NAME,B19013_001E,B19013_001M&ucgid=0500000US08031&descriptive=true",
    );
    expect(
      buildRawQueryUrl({ ...BASE, ucgid: "0500000US08031", descriptive: false }),
    ).not.toContain("descriptive");
  });
});

describe("census_get_raw input validation", () => {
  const tool = () => censusGetRawTool({ httpClient: replay });

  it("rejects both ucgid and for", async () => {
    await expect(
      tool().handler(
        { ...BASE, ucgid: "0500000US08031", for: "county:031" },
        {
          now: () => new Date(),
        },
      ),
    ).rejects.toThrow();
  });

  it("rejects neither ucgid nor for", async () => {
    await expect(tool().handler({ ...BASE }, { now: () => new Date() })).rejects.toThrow();
  });

  it("rejects `in` without `for`", async () => {
    await expect(
      tool().handler(
        { ...BASE, ucgid: "0500000US08031", in: "state:08" },
        {
          now: () => new Date(),
        },
      ),
    ).rejects.toThrow();
  });

  it("rejects a bad dataset", async () => {
    await expect(
      tool().handler(
        { ...BASE, dataset: "bad dataset", ucgid: "0500000US08031" },
        {
          now: () => new Date(),
        },
      ),
    ).rejects.toThrow();
  });

  it("rejects a bad id", async () => {
    await expect(
      tool().handler(
        { dataset: "acs/acs5", year: 2024, ids: ["not-a-valid-id!"], ucgid: "0500000US08031" },
        { now: () => new Date() },
      ),
    ).rejects.toThrow();
  });
});

describe("census_get_raw over the hand-written fixture (Denver County median household income)", () => {
  it("returns the header and rows unchanged, with the query and citation in the source block", async () => {
    const tool = censusGetRawTool({ httpClient: replay, now: () => new Date("2026-09-19") });
    const result = await tool.handler(
      { ...BASE, ucgid: "0500000US08031" },
      { now: () => new Date("2026-09-19") },
    );
    expect(result.data).toEqual({
      dataset: "acs/acs5",
      year: 2024,
      query: { ids: BASE.ids, ucgid: "0500000US08031", descriptive: false },
      header: ["NAME", "B19013_001E", "B19013_001M", "ucgid"],
      rows: [["Denver County, Colorado", "91000", "2100", "0500000US08031"]],
    });
    expect(result.source.agency).toBe("census");
    expect(result.source.program).toBe("acs/acs5");
    expect(result.source.ids).toEqual([
      "https://api.census.gov/data/2024/acs/acs5?get=NAME,B19013_001E,B19013_001M&ucgid=0500000US08031",
    ]);
    expect(result.source.citation).toContain("acs/acs5");
    // the key must never appear anywhere in the result
    const asText = JSON.stringify(result);
    expect(asText).not.toMatch(/key=/);
  });

  it("never leaks the key into source.ids or data even when apiKey is configured", async () => {
    const tool = censusGetRawTool({ httpClient: replay, apiKey: () => "SECRETKEY123" });
    const result = await tool.handler(
      { ...BASE, ucgid: "0500000US08031" },
      { now: () => new Date() },
    );
    const asText = JSON.stringify(result);
    expect(asText).not.toContain("SECRETKEY123");
  });
});

describe("census_get_raw: no rows for that geography (HTTP 204)", () => {
  it("returns empty rows with a limitation, never throws", async () => {
    const stubClient = {
      getJson: () => {
        throw new Error("unused");
      },
      getText: async () => ({ value: "", cache: { hit: false }, status: 204 }),
      postJson: () => {
        throw new Error("unused");
      },
    };
    const tool = censusGetRawTool({ httpClient: () => stubClient as never });
    const result = await tool.handler(
      { ...BASE, ucgid: "0500000US99999" },
      { now: () => new Date() },
    );
    expect(result.data).toMatchObject({ header: [], rows: [] });
    expect(result.limitations).toEqual(["no rows for that geography in acs/acs5 2024"]);
  });
});
