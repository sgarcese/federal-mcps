import type { HttpClient, HttpResult } from "@federal-mcps/core";
import { describe, expect, it } from "vitest";
import { blsIndicatorDefinitions } from "./indicators.js";
import { qcewAreaCodeOf, qcewIndicatorDefinitions } from "./qcew-indicators.js";

const HEADER =
  '"area_fips","own_code","industry_code","agglvl_code","size_code","year","qtr","disclosure_code","qtrly_estabs","month1_emplvl","month2_emplvl","month3_emplvl","total_qtrly_wages","taxable_qtrly_wages","qtrly_contributions","avg_wkly_wage"';
const DENVER = [
  HEADER,
  '"08031","0","10","70","0","2024","1","",45970,559807,561820,561041,15497545518,7590975514,149132980,2125',
].join("\n");
const SUPPRESSED = [HEADER, '"99999","0","10","70","0","2024","1","N",0,0,0,0,0,0,0,0'].join("\n");

function getTextClient(csv: string): HttpClient {
  const notUsed = () => {
    throw new Error("only getText");
  };
  return {
    getJson: notUsed,
    postJson: notUsed,
    async getText(): Promise<HttpResult<string>> {
      return { value: csv, status: 200, cache: { hit: false } };
    },
  };
}
// biome-ignore lint/suspicious/noExplicitAny: minimal PlaceCandidate stand-in.
const place = (sumlevel: string, geoid: string): any => ({ geoid, kind: { sumlevel } });
const def = (name: string) => qcewIndicatorDefinitions.find((d) => d.name === name);

/** Invoke a QCEW indicator's fetch capability (asserting it exists), returning its first result. */
async function runFetch(name: string, client: HttpClient, keys: string[]) {
  const fetch = def(name)?.fetch;
  if (!fetch) throw new Error(`no fetch capability for ${name}`);
  const [result] = await fetch(client, keys, {});
  return result;
}

describe("qcewAreaCodeOf", () => {
  it("derives county (5-digit FIPS) and state (SS000) area codes", () => {
    expect(qcewAreaCodeOf(place("050", "08031"))).toBe("08031");
    expect(qcewAreaCodeOf(place("040", "08"))).toBe("08000");
  });
  it("returns undefined for metro/city (QCEW MSA deferred)", () => {
    expect(qcewAreaCodeOf(place("310", "19740"))).toBeUndefined();
    expect(qcewAreaCodeOf(place("160", "0820000"))).toBeUndefined();
  });
});

describe("qcewIndicatorDefinitions", () => {
  it("registers covered_employment and average_weekly_wage over QCEW, NSA", () => {
    for (const name of ["covered_employment", "average_weekly_wage"]) {
      expect(def(name)?.program).toBe("QCEW");
      expect(def(name)?.defaultSeasonallyAdjusted).toBe(false);
      expect(def(name)?.description.length).toBeGreaterThan(0);
    }
    expect(blsIndicatorDefinitions.map((d) => d.name)).toEqual(
      expect.arrayContaining(["covered_employment", "average_weekly_wage"]),
    );
  });

  it("covered_employment fetches the latest headline and averages the three monthly levels", async () => {
    const result = await runFetch("covered_employment", getTextClient(DENVER), ["08031"]);
    expect(result?.seriesId).toBe("08031");
    expect(result?.observations[0]?.value).toBe(560889); // round((559807+561820+561041)/3)
    expect(result?.observations[0]?.period).toBe("Q01");
  });

  it("average_weekly_wage returns the wage field", async () => {
    const result = await runFetch("average_weekly_wage", getTextClient(DENVER), ["08031"]);
    expect(result?.observations[0]?.value).toBe(2125);
  });

  it("carries a null value + disclosure footnote for a suppressed area — never fabricated", async () => {
    const result = await runFetch("covered_employment", getTextClient(SUPPRESSED), ["99999"]);
    expect(result?.observations[0]?.value).toBeNull();
    expect(result?.observations[0]?.footnotes[0]?.text).toMatch(/confidential/i);
  });
});
