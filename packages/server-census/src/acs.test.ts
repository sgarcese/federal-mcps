import { fileURLToPath } from "node:url";
import { createHttpClient, MemoryBudgetStore, MemoryCacheStore } from "@federal-mcps/core";
import { describe, expect, it } from "vitest";
import {
  ACS_VINTAGE,
  acsFetch,
  buildAcsQueryUrl,
  buildAcsSeriesKey,
  chooseProduct,
  parseAcsSeriesKey,
  parseAcsResponse,
  reliabilityOf,
} from "./acs.js";

const FIXTURES = fileURLToPath(new URL("../fixtures", import.meta.url));
const replay = () =>
  createHttpClient({
    source: "census",
    budget: new MemoryBudgetStore(100),
    cache: new MemoryCacheStore(),
    fixtures: { mode: "replay", dir: FIXTURES },
  });

describe("buildAcsQueryUrl (must match scripts/record-acs-fixtures.mts exactly)", () => {
  it("asks for E, M, EA and MA of one variable by ucgid", () => {
    expect(
      buildAcsQueryUrl({
        vintage: "2024",
        product: "5-year",
        family: "subject",
        variable: "S1701_C03_001",
        ucgid: "0500000US08031",
      }),
    ).toBe(
      "https://api.census.gov/data/2024/acs/acs5/subject?get=NAME,S1701_C03_001E,S1701_C03_001M,S1701_C03_001EA,S1701_C03_001MA&ucgid=0500000US08031",
    );
    expect(
      buildAcsQueryUrl({
        vintage: "2024",
        product: "1-year",
        family: "detailed",
        variable: "B01003_001",
        ucgid: "1600000US0820000",
      }),
    ).toBe(
      "https://api.census.gov/data/2024/acs/acs1?get=NAME,B01003_001E,B01003_001M,B01003_001EA,B01003_001MA&ucgid=1600000US0820000",
    );
  });
});

describe("chooseProduct (ADR-014 §2)", () => {
  it("picks 1-year at 65,000+ and 5-year below, tracts and ZCTAs always 5-year", () => {
    expect(chooseProduct({ population: 729_019, sumlevel: "160" })).toEqual({
      product: "1-year",
      reason: "population 729,019 is at or above the ACS 1-year threshold of 65,000",
    });
    expect(chooseProduct({ population: 9_777, sumlevel: "160" }).product).toBe("5-year");
    expect(chooseProduct({ population: 9_000_000, sumlevel: "140" }).product).toBe("5-year");
    expect(chooseProduct({ population: null, sumlevel: "050" }).product).toBe("5-year");
  });
  it("honours an explicit 5-year request, and answers a 1-year request below the threshold with 5-year plus a reason", () => {
    expect(
      chooseProduct({ population: 729_019, sumlevel: "160", requested: "5-year" }).product,
    ).toBe("5-year");
    const r = chooseProduct({ population: 9_777, sumlevel: "160", requested: "1-year" });
    expect(r.product).toBe("5-year");
    expect(r.reason).toMatch(/1-year.*65,000/);
  });
});

describe("parseAcsResponse: sentinels, annotations, open-ended medians (ADR-014 §4)", () => {
  const row = (e: string | null, m: string | null, ea: string | null, ma: string | null) =>
    JSON.stringify([
      ["NAME", "B19013_001E", "B19013_001M", "B19013_001EA", "B19013_001MA", "ucgid"],
      ["X", e, m, ea, ma, "u"],
    ]);
  it("reads a plain estimate and margin", () => {
    expect(parseAcsResponse(row("73738", "12737", null, null), "B19013_001")).toMatchObject({
      value: 73738,
      marginOfError: 12737,
      caveats: [],
    });
  });
  it("maps -666666666 to null with the Census meaning", () => {
    const r = parseAcsResponse(row("-666666666", "-222222222", "-", "**"), "B19013_001");
    expect(r.value).toBeNull();
    expect(r.marginOfError).toBeNull();
    expect(r.caveats.join(" ")).toMatch(/could not be computed/);
  });
  it("keeps a controlled estimate's value with a null margin and a note", () => {
    const r = parseAcsResponse(row("729019", "-555555555", null, "*****"), "B19013_001");
    expect(r.value).toBe(729019);
    expect(r.marginOfError).toBeNull();
    expect(r.caveats.join(" ")).toMatch(/controlled/);
  });
  it("turns an open-ended median into its bound plus a caveat", () => {
    const r = parseAcsResponse(row("250001", "-333333333", "+", "***"), "B19013_001");
    expect(r.value).toBe(250001);
    expect(r.caveats.join(" ")).toMatch(/at or above/);
  });
  it("treats an empty body (HTTP 204) as no row", () => {
    expect(parseAcsResponse("", "B01003_001")).toBeNull();
  });
});

describe("reliabilityOf (coefficient of variation)", () => {
  it("grades high < 12%, medium to 40%, low above", () => {
    expect(reliabilityOf(92504, 3897)).toEqual({ grade: "high", cv: 3897 / 1.645 / 92504 });
    expect(reliabilityOf(100, 30).grade).toBe("medium");
    expect(reliabilityOf(121379, 82893).grade).toBe("low");
    expect(reliabilityOf(0, 5)).toBeUndefined();
  });
});

describe("acsFetch over recorded fixtures", () => {
  const key = (
    p: "1-year" | "5-year",
    family: "detailed" | "subject",
    variable: string,
    ucgid: string,
  ) => buildAcsSeriesKey({ vintage: ACS_VINTAGE, product: p, family, variable, ucgid });

  it("round-trips a series key", () => {
    const k = key("5-year", "subject", "S1701_C03_001", "0500000US08031");
    expect(parseAcsSeriesKey(k)).toEqual({
      vintage: "2024",
      product: "5-year",
      family: "subject",
      variable: "S1701_C03_001",
      ucgid: "0500000US08031",
    });
  });

  it("returns Denver city's 1-year population with the controlled-estimate note and no margin", async () => {
    const [r] = await acsFetch(
      replay(),
      [key("1-year", "detailed", "B01003_001", "1600000US0820000")],
      {},
    );
    expect(r?.observations[0]).toMatchObject({
      year: "2024",
      period: "A01",
      value: 729019,
      marginOfError: null,
    });
    expect(r?.observations[0]?.footnotes.map((f) => f.text).join(" ")).toMatch(/controlled/);
  });

  it("returns Denver city's 1-year median income with margin and a high reliability grade", async () => {
    const [r] = await acsFetch(
      replay(),
      [key("1-year", "detailed", "B19013_001", "1600000US0820000")],
      {},
    );
    expect(r?.observations[0]).toMatchObject({
      value: 92504,
      marginOfError: 3897,
      reliability: "high",
    });
  });

  it("falls to the 5-year product when the 1-year query answers 204, and says so", async () => {
    const [r] = await acsFetch(
      replay(),
      [key("1-year", "detailed", "B01003_001", "1600000US0465350")],
      {},
    );
    expect(r?.observations[0]).toMatchObject({
      value: 9777,
      period: "5Y",
      periodName: "2020–2024",
    });
    expect(r?.observations[0]?.footnotes.map((f) => f.text).join(" ")).toMatch(
      /1-year.*not published/i,
    );
  });

  it("returns a percent from a subject table and a low-reliability tract with its grade", async () => {
    const [pct] = await acsFetch(
      replay(),
      [key("5-year", "subject", "S1701_C03_001", "0500000US08031")],
      {},
    );
    expect(pct?.observations[0]).toMatchObject({
      value: 11.2,
      marginOfError: 0.5,
      reliability: "high",
    });
    const [low] = await acsFetch(
      replay(),
      [key("5-year", "detailed", "B19013_001", "1400000US08031000503")],
      {},
    );
    expect(low?.observations[0]).toMatchObject({
      value: 121379,
      marginOfError: 82893,
      reliability: "low",
    });
  });

  it("returns null plus the Census meaning for an uncomputable tract median", async () => {
    const [r] = await acsFetch(
      replay(),
      [key("5-year", "detailed", "B19013_001", "1400000US08031980001")],
      {},
    );
    expect(r?.observations[0]?.value).toBeNull();
    expect(r?.observations[0]?.footnotes.map((f) => f.text).join(" ")).toMatch(
      /could not be computed/,
    );
  });
});
