import { describe, expect, it } from "vitest";
import { loadTableIndex, rankTables, searchTables, type TableIndexRow } from "./table-index.js";

/** A small in-memory slice for the ranking unit tests — never the whole vendored file here. */
const SLICE: readonly TableIndexRow[] = [
  {
    id: "B19013",
    label: "MEDIAN HOUSEHOLD INCOME IN THE PAST 12 MONTHS (IN 2019 INFLATION-ADJUSTED DOLLARS)",
    endpoint: "acs/acs5",
    years: [2019, 2020, 2021, 2022, 2023, 2024],
  },
  {
    id: "B19013",
    label: "MEDIAN HOUSEHOLD INCOME IN THE PAST 12 MONTHS (IN 2023 INFLATION-ADJUSTED DOLLARS)",
    endpoint: "acs/acs1",
    years: [2019, 2021, 2022, 2023, 2024],
  },
  {
    id: "B19001",
    label: "HOUSEHOLD INCOME IN THE PAST 12 MONTHS (IN 2023 INFLATION-ADJUSTED DOLLARS)",
    endpoint: "acs/acs5",
    years: [2019, 2020, 2021, 2022, 2023, 2024],
  },
  {
    id: "C16001",
    label: "LANGUAGE SPOKEN AT HOME FOR THE POPULATION 5 YEARS AND OVER",
    endpoint: "acs/acs5",
    years: [2019, 2020, 2021, 2022, 2023, 2024],
  },
  {
    id: "S1601",
    label: "LANGUAGE SPOKEN AT HOME",
    endpoint: "acs/acs5/subject",
    years: [2019, 2020, 2021, 2022, 2023],
  },
  {
    id: "P1",
    label: "RACE",
    endpoint: "dec/pl",
    years: [2020],
  },
];

describe("rankTables (pure, on an in-memory slice)", () => {
  it("puts an exact id match first", () => {
    const results = rankTables(SLICE, { query: "B19001" });
    expect(results[0]?.id).toBe("B19001");
  });

  it("ranks an id prefix match above unrelated label matches", () => {
    const results = rankTables(SLICE, { query: "B190" });
    expect(results.map((r) => r.id)).toEqual(["B19013", "B19013", "B19001"]);
  });

  it("ranks a label match where all query tokens are present above a partial match", () => {
    const results = rankTables(SLICE, { query: "language spoken home" });
    expect(results.map((r) => r.id)).toEqual(["C16001", "S1601"]);
  });

  it("finds median household income by topic, not just id", () => {
    const results = rankTables(SLICE, { query: "median household income" });
    expect(results[0]?.id).toBe("B19013");
    expect(results.map((r) => r.id)).not.toContain("P1");
  });

  it("tie-breaks equal-tier matches by newest year first", () => {
    const results = rankTables(SLICE, { query: "median household income" });
    expect(results.slice(0, 2).map((r) => r.endpoint)).toEqual(["acs/acs5", "acs/acs1"]);
  });

  it("filters by endpoint when given", () => {
    const results = rankTables(SLICE, { query: "language", endpoint: "acs/acs5/subject" });
    expect(results.map((r) => r.id)).toEqual(["S1601"]);
  });

  it("respects the limit", () => {
    const results = rankTables(SLICE, { query: "income", limit: 1 });
    expect(results).toHaveLength(1);
  });

  it("returns no matches for a query with no id or label hits", () => {
    const results = rankTables(SLICE, { query: "zzz_no_such_topic" });
    expect(results).toEqual([]);
  });

  it("defaults the limit to 20", () => {
    const many: TableIndexRow[] = Array.from({ length: 30 }, (_, i) => ({
      id: `Z${i}`,
      label: "income tables for testing the default limit",
      endpoint: "acs/acs5",
      years: [2024],
    }));
    expect(rankTables(many, { query: "income" })).toHaveLength(20);
  });
});

describe("loadTableIndex (opens the vendored file)", () => {
  it("has more than 1000 rows shaped as expected", () => {
    const rows = loadTableIndex();
    expect(rows.length).toBeGreaterThan(1000);
    const sample = rows[0];
    expect(sample).toMatchObject({
      id: expect.any(String),
      label: expect.any(String),
      endpoint: expect.any(String),
      years: expect.any(Array),
    });
    expect(sample?.years.every((y) => typeof y === "number")).toBe(true);
  });

  it("is memoized (same reference on a second call)", () => {
    expect(loadTableIndex()).toBe(loadTableIndex());
  });

  it("finds B19013 for median household income end to end via searchTables", () => {
    const { matches } = searchTables({ query: "median household income" });
    expect(matches.some((m) => m.id === "B19013")).toBe(true);
  });
});
