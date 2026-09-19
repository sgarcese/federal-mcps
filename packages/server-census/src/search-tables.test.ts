import { describe, expect, it } from "vitest";
import { searchTablesTool } from "./search-tables.js";

const now = () => new Date("2026-09-19T00:00:00Z");

describe("census_search_tables tool (#175, ADR-014 §7)", () => {
  it("is named, titled and read-only-shaped", () => {
    expect(searchTablesTool.name).toBe("census_search_tables");
    expect(searchTablesTool.title).toMatch(/\S/);
    expect(searchTablesTool.description.length).toBeGreaterThan(0);
    expect(searchTablesTool.description.length).toBeLessThanOrEqual(1000);
    expect(searchTablesTool.examples.length).toBeGreaterThan(0);
  });

  it("rejects a query shorter than 2 characters", () => {
    expect(() => searchTablesTool.input.parse({ query: "a" })).toThrow();
  });

  it("finds B19013 for median household income, with data and source shaped per the envelope", async () => {
    const result = await searchTablesTool.handler({ query: "median household income" }, { now });
    expect(result.data.query).toBe("median household income");
    expect(result.data.matches.length).toBeGreaterThan(0);
    expect(result.data.matches.some((m) => m.id === "B19013")).toBe(true);
    for (const m of result.data.matches) {
      expect(m).toMatchObject({
        id: expect.any(String),
        label: expect.any(String),
        endpoint: expect.any(String),
        years: expect.any(Array),
      });
    }
    expect(result.source).toMatchObject({
      agency: "census",
      program: "TABLES",
      ids: [],
      url: "https://api.census.gov/data.json",
    });
    expect(result.source.citation).toContain("api.census.gov/data.json");
    expect(result.source.citation).toContain("2026-09-19");
  });

  it("respects limit and endpoint filters", async () => {
    const result = await searchTablesTool.handler(
      { query: "income", limit: 3, endpoint: "acs/acs5" },
      { now },
    );
    expect(result.data.matches.length).toBeLessThanOrEqual(3);
    for (const m of result.data.matches) {
      expect(m.endpoint).toBe("acs/acs5");
    }
  });

  it("runs the worked example", async () => {
    const example = searchTablesTool.examples[0];
    const result = await searchTablesTool.handler(example.input, { now });
    expect(result.data.matches.length).toBeGreaterThan(0);
  });
});
