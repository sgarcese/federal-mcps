import type { HttpClient, HttpResult } from "@federal-mcps/core";
import { describe, expect, it, vi } from "vitest";
import { createHttpClient, MemoryBudgetStore, MemoryCacheStore } from "@federal-mcps/core";
import {
  fetchQcewHeadline,
  latestPublishedQuarter,
  parseQcewHeadline,
  qcewAreaUrl,
  qcewDisclosureText,
} from "./qcew.js";

const HEADER =
  '"area_fips","own_code","industry_code","agglvl_code","size_code","year","qtr","disclosure_code","qtrly_estabs","month1_emplvl","month2_emplvl","month3_emplvl","total_qtrly_wages","taxable_qtrly_wages","qtrly_contributions","avg_wkly_wage"';
// Denver County 2024 Q1, verified against the live QCEW API (avg wkly wage $2,125).
const DENVER_HEADLINE =
  '"08031","0","10","70","0","2024","1","",45970,559807,561820,561041,15497545518,7590975514,149132980,2125';
// A private-ownership detail row (own_code 1) that must be skipped.
const DENVER_PRIVATE =
  '"08031","1","10","71","0","2024","1","",42000,500000,501000,502000,14000000000,0,0,2100';
const DENVER_CSV = [HEADER, DENVER_HEADLINE, DENVER_PRIVATE].join("\n");

// A suppressed total row (disclosure code "N").
const SUPPRESSED_CSV = [HEADER, '"99999","0","10","70","0","2024","1","N",0,0,0,0,0,0,0,0'].join(
  "\n",
);

function stubTextClient(csv: string): HttpClient {
  const notUsed = () => {
    throw new Error("qcew stub: only getText is supported");
  };
  return {
    getJson: notUsed,
    postJson: notUsed,
    async getText(): Promise<HttpResult<string>> {
      return { value: csv, status: 200, cache: { hit: false } };
    },
  };
}

describe("parseQcewHeadline", () => {
  it("selects the total-covered all-industries row and averages the three monthly employment levels", () => {
    const h = parseQcewHeadline(DENVER_CSV);
    expect(h?.areaFips).toBe("08031");
    expect(h?.year).toBe(2024);
    expect(h?.quarter).toBe(1);
    // round((559807 + 561820 + 561041) / 3) = 560889
    expect(h?.employment).toBe(560889);
    expect(h?.averageWeeklyWage).toBe(2125);
    expect(h?.establishments).toBe(45970);
    expect(h?.disclosureCode).toBe("");
  });

  it("returns null measures with the disclosure code for a suppressed row — never a fabricated value", () => {
    const h = parseQcewHeadline(SUPPRESSED_CSV);
    expect(h?.disclosureCode).toBe("N");
    expect(h?.employment).toBeNull();
    expect(h?.averageWeeklyWage).toBeNull();
    expect(h?.establishments).toBeNull();
    expect(qcewDisclosureText("N")).toMatch(/confidential/i);
    expect(qcewDisclosureText("")).toBeUndefined();
  });

  it("returns undefined when there is no total-covered all-industries row", () => {
    expect(parseQcewHeadline([HEADER, DENVER_PRIVATE].join("\n"))).toBeUndefined();
    expect(parseQcewHeadline("")).toBeUndefined();
  });
});

describe("qcewAreaUrl + latestPublishedQuarter", () => {
  it("builds the CSV slice url", () => {
    expect(qcewAreaUrl("08031", { year: 2024, quarter: 1 })).toBe(
      "https://data.bls.gov/cew/data/api/2024/1/area/08031.csv",
    );
  });

  it("steps back ~2 quarters from now for the latest published quarter", () => {
    // Sept 2026 → minus 6 months → March 2026 → Q1 2026.
    expect(latestPublishedQuarter(new Date("2026-09-15T00:00:00Z"))).toEqual({
      year: 2026,
      quarter: 1,
    });
    // Jan 2026 → minus 6 months → July 2025 → Q3 2025.
    expect(latestPublishedQuarter(new Date("2026-01-10T00:00:00Z"))).toEqual({
      year: 2025,
      quarter: 3,
    });
  });
});

describe("fetchQcewHeadline", () => {
  it("fetches via the client's getText and parses the headline", async () => {
    const h = await fetchQcewHeadline(stubTextClient(DENVER_CSV), "08031", {
      year: 2024,
      quarter: 1,
    });
    expect(h?.employment).toBe(560889);
    expect(h?.averageWeeklyWage).toBe(2125);
  });

  it("returns undefined for an empty slice (quarter not yet published)", async () => {
    const h = await fetchQcewHeadline(stubTextClient(""), "08031", { year: 2099, quarter: 1 });
    expect(h).toBeUndefined();
  });

  it("goes through getText with the given cache TTL", async () => {
    const getText = vi.fn(async () => ({ value: DENVER_CSV, status: 200, cache: { hit: false } }));
    const client = { getText } as unknown as HttpClient;
    await fetchQcewHeadline(
      client,
      "08031",
      { year: 2024, quarter: 1 },
      { freshTtlSeconds: 86400 },
    );
    expect(getText).toHaveBeenCalledWith(
      "https://data.bls.gov/cew/data/api/2024/1/area/08031.csv",
      { freshTtlSeconds: 86400 },
    );
  });
});

describe.runIf(process.env.LIVE_TESTS === "1")("fetchQcewHeadline LIVE", () => {
  it("reads Denver County 2024 Q1 from the real QCEW API", async () => {
    const client = createHttpClient({
      source: "bls",
      budget: new MemoryBudgetStore(1000),
      cache: new MemoryCacheStore(),
      fixtures: { mode: "off" },
    });
    const h = await fetchQcewHeadline(client, "08031", { year: 2024, quarter: 1 });
    expect(h?.averageWeeklyWage).toBe(2125);
    expect(h?.employment).toBeGreaterThan(500000);
  });
});
