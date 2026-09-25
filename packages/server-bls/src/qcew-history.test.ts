import type { HttpClient, HttpResult } from "@federal-mcps/core";
import { HttpError, resolveDimensions } from "@federal-mcps/core";
import { describe, expect, it } from "vitest";
import { qcewIndicatorDefinitions } from "./qcew-indicators.js";

/**
 * QCEW history and detailed industries (#213, ADR-017 §4). The stub answers per URL: a quarterly
 * slice carries its own year/quarter; quarters after 2026 Q1 and 2026 annual are unpublished
 * (header only, as BLS serves them); an annual file uses the annual columns.
 */
const QH =
  '"area_fips","own_code","industry_code","agglvl_code","size_code","year","qtr","disclosure_code","qtrly_estabs","month1_emplvl","month2_emplvl","month3_emplvl","total_qtrly_wages","taxable_qtrly_wages","qtrly_contributions","avg_wkly_wage"';
const AH =
  '"area_fips","own_code","industry_code","agglvl_code","size_code","year","qtr","disclosure_code","annual_avg_estabs","annual_avg_emplvl","total_annual_wages","taxable_annual_wages","annual_contributions","annual_avg_wkly_wage","avg_annual_pay"';

function quarterCsv(year: number, q: number): string {
  const wage = 1500 + (year - 2014) * 20 + q; // distinct per quarter
  return [
    QH,
    `"18141","0","10","70","0","${year}","${q}","",1,1,1,1,1,1,1,999`,
    `"18141","5","23","74","0","${year}","${q}","",1,6500,6540,6580,1,1,1,${wage}`,
    `"18141","5","236","75","0","${year}","${q}","",1,2000,2010,2020,1,1,1,${wage + 100}`,
    `"18141","5","2361","76","0","${year}","${q}","N",0,0,0,0,0,0,0,0`,
  ].join("\n");
}
function annualCsv(year: number): string {
  return [
    AH,
    `"18141","5","23","74","0","${year}","A","",1,6400,1,1,1,${1400 + year - 2014},1`,
  ].join("\n");
}

const requested: string[] = [];
const client: HttpClient = {
  getJson: () => {
    throw new Error("only getText");
  },
  postJson: () => {
    throw new Error("only getText");
  },
  async getText(url: string): Promise<HttpResult<string>> {
    requested.push(url);
    const q = /\/api\/(\d{4})\/(\d)\/area\//.exec(url);
    const a = /\/api\/(\d{4})\/a\/area\//.exec(url);
    let value = QH;
    if (q) {
      const year = Number(q[1]);
      const quarter = Number(q[2]);
      if (year < 2026 || (year === 2026 && quarter === 1)) value = quarterCsv(year, quarter);
    } else if (a) {
      const year = Number(a[1]);
      // BLS answers an unpublished annual file with HTTP 404 (verified live 2026-09-24).
      if (year > 2025) throw new HttpError({ source: "bls", status: 404, url, attempts: 1 });
      value = annualCsv(year);
    }
    return { value, status: 200, cache: { hit: false } };
  },
};

const def = (name: string) => qcewIndicatorDefinitions.find((d) => d.name === name);
async function fetchWage(key: string, opts: Record<string, unknown>) {
  requested.length = 0;
  const f = def("average_weekly_wage")?.fetch;
  if (!f) throw new Error("no fetch");
  const [r] = await f(client, [key], opts);
  return r;
}

describe("QCEW history (#213)", () => {
  it("without explicit years, returns only the latest published quarter (one call stays cheap)", async () => {
    const r = await fetchWage("18141|5|23", { startYear: 2025, endYear: 2026 });
    expect(r?.observations).toHaveLength(1);
    expect(r?.observations[0]).toMatchObject({ year: "2026", period: "Q01" });
  });

  it("with explicit years, returns every published quarter in range, newest first", async () => {
    const r = await fetchWage("18141|5|23", {
      startYear: 2025,
      endYear: 2026,
      explicitYears: true,
    });
    expect(r?.observations.map((o) => `${o.year}-${o.period}`)).toEqual([
      "2026-Q01",
      "2025-Q04",
      "2025-Q03",
      "2025-Q02",
      "2025-Q01",
    ]);
    expect(r?.observations[1]?.value).toBe(1500 + 11 * 20 + 4);
  });

  it("caps a long quarterly range at 5 years (20 quarters) and says so", async () => {
    const r = await fetchWage("18141|5|23", {
      startYear: 2014,
      endYear: 2026,
      explicitYears: true,
    });
    expect(r?.observations).toHaveLength(20);
    expect(r?.observations.at(-1)).toMatchObject({ year: "2021", period: "Q02" });
    expect(r?.notes?.join(" ")).toMatch(/at most 5 years|20 quarters/);
  });

  it("clamps years before 2014 (where the open data slices begin) and says so", async () => {
    const r = await fetchWage("18141|5|23", {
      startYear: 2012,
      endYear: 2014,
      explicitYears: true,
    });
    expect(r?.observations.every((o) => Number(o.year) >= 2014)).toBe(true);
    expect(r?.notes?.join(" ")).toMatch(/2014/);
  });

  it("frequency annual reads the annual files (annual_avg_wkly_wage), skipping the unpublished year", async () => {
    const r = await fetchWage("18141|5|23|a", {
      startYear: 2023,
      endYear: 2026,
      explicitYears: true,
    });
    expect(r?.observations.map((o) => `${o.year}-${o.period}`)).toEqual([
      "2025-A01",
      "2024-A01",
      "2023-A01",
    ]);
    expect(r?.observations[0]?.value).toBe(1411);
    expect(requested.some((u) => u.includes("/2025/a/area/18141.csv"))).toBe(true);
  });

  it("QCEW now serves history (no longer declared latest-only) and declares a frequency dimension", () => {
    const d = def("average_weekly_wage");
    expect(d?.servesHistory).not.toBe(false);
    const freq = d?.dimensions?.find((x) => x.argument === "frequency");
    expect(freq?.default).toBe("quarterly");
    expect(freq?.vocabulary.map((v) => v.code)).toEqual(["quarterly", "annual"]);
  });

  it("cites the annual file for an annual answer", async () => {
    const r = await fetchWage("18141|5|23|a", {
      startYear: 2025,
      endYear: 2025,
      explicitYears: true,
    });
    const src = def("average_weekly_wage")?.sourceOf?.("18141|5|23|a", r?.observations[0]);
    expect(src?.url).toMatch(/\/2025\/a\/area\/18141\.csv$/);
    expect(src?.label).toMatch(/annual/);
  });
});

describe("QCEW detailed industries (#213)", () => {
  it("accepts a 3- to 6-digit NAICS code beyond the curated sector vocabulary", () => {
    const d = def("average_weekly_wage");
    if (!d) throw new Error("no def");
    const ok = resolveDimensions(d, { industry: "236", ownership: "5" });
    expect(ok.ok).toBe(true);
    const bad = resolveDimensions(d, { industry: "23a", ownership: "5" });
    expect(bad.ok).toBe(false);
    const tooLong = resolveDimensions(d, { industry: "2361181", ownership: "5" });
    expect(tooLong.ok).toBe(false);
  });

  it("picks the 3-digit row by its aggregation level (county 75)", async () => {
    const r = await fetchWage("18141|5|236", {});
    expect(r?.observations[0]?.value).toBe(1500 + 12 * 20 + 1 + 100);
  });

  it("a suppressed detailed row comes back null with its disclosure footnote — never fabricated", async () => {
    const r = await fetchWage("18141|5|2361", {});
    expect(r?.observations[0]?.value).toBeNull();
    expect(r?.observations[0]?.footnotes[0]?.code).toBe("N");
  });

  it("a code not in the file returns no observation and a note saying it is not published for that area", async () => {
    const r = await fetchWage("18141|5|999", {});
    expect(r?.observations).toHaveLength(0);
    expect(r?.notes?.join(" ")).toMatch(/NAICS 999.*not published/);
  });
});
