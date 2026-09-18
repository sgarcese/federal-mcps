import type { HttpClient, HttpResult } from "@federal-mcps/core";
import { describe, expect, it } from "vitest";
import { blsIndicatorDefinitions } from "./indicators.js";
import { qcewAreaCodeOf, qcewIndicatorDefinitions } from "./qcew-indicators.js";
import type { DimensionSelection } from "./registry.js";

const HEADER =
  '"area_fips","own_code","industry_code","agglvl_code","size_code","year","qtr","disclosure_code","qtrly_estabs","month1_emplvl","month2_emplvl","month3_emplvl","total_qtrly_wages","taxable_qtrly_wages","qtrly_contributions","avg_wkly_wage"';
const DENVER_TOTAL =
  '"08031","0","10","70","0","2024","1","",45970,559807,561820,561041,15497545518,7590975514,149132980,2125';
const DENVER_CONSTRUCTION_PRIVATE =
  '"08031","5","23","74","0","2024","1","",2131,21963,22241,22192,515298275,382512168,9375302,1791';
const DENVER = [HEADER, DENVER_TOTAL, DENVER_CONSTRUCTION_PRIVATE].join("\n");
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
const headlineKey = (area: string) => `${area}|0|10`;

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
  it("reads a metro's QCEW C-code off the catalog's agency codes (#153); undefined without one, or for a city", () => {
    const denver = {
      ...place("310", "19740"),
      agencyCodes: [{ agency: "bls", program: "QCEW", code: "C1974" }],
    };
    expect(qcewAreaCodeOf(denver)).toBe("C1974");
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
    const result = await runFetch("covered_employment", getTextClient(DENVER), [
      headlineKey("08031"),
    ]);
    expect(result?.seriesId).toBe("08031|0|10");
    expect(result?.observations[0]?.value).toBe(560889); // round((559807+561820+561041)/3)
    expect(result?.observations[0]?.period).toBe("Q01");
  });

  it("average_weekly_wage returns the wage field", async () => {
    const result = await runFetch("average_weekly_wage", getTextClient(DENVER), [
      headlineKey("08031"),
    ]);
    expect(result?.observations[0]?.value).toBe(2125);
  });

  it("carries a null value + disclosure footnote for a suppressed area — never fabricated", async () => {
    const result = await runFetch("covered_employment", getTextClient(SUPPRESSED), [
      headlineKey("99999"),
    ]);
    expect(result?.observations[0]?.value).toBeNull();
    expect(result?.observations[0]?.footnotes[0]?.text).toMatch(/confidential/i);
  });
});

describe("QCEW NAICS industry + ownership pickers (#151)", () => {
  it("both indicators declare industry and ownership dimensions with their defaults", () => {
    for (const name of ["covered_employment", "average_weekly_wage"]) {
      const dims = def(name)?.dimensions ?? [];
      const industry = dims.find((d) => d.argument === "industry");
      const ownership = dims.find((d) => d.argument === "ownership");
      expect(industry?.default).toBe("10");
      expect(ownership?.default).toBe("0");
      expect(industry?.vocabulary.map((v) => v.code)).toEqual(
        expect.arrayContaining(["10", "23", "31-33", "44-45", "48-49"]),
      );
      expect(ownership?.vocabulary.map((v) => v.code)).toEqual(
        expect.arrayContaining(["0", "5", "1", "2", "3"]),
      );
    }
  });

  it("buildSeriesId encodes the area, ownership and industry into the opaque key", () => {
    const dimensions: DimensionSelection = { ownership: "5", industry: "23" };
    const key = def("covered_employment")?.buildSeriesId("08031", {
      seasonallyAdjusted: false,
      dimensions,
    });
    expect(key).toBe("08031|5|23");
  });

  it("buildSeriesId defaults to the headline key when dimensions are the defaults", () => {
    const dimensions: DimensionSelection = { ownership: "0", industry: "10" };
    const key = def("covered_employment")?.buildSeriesId("08031", {
      seasonallyAdjusted: false,
      dimensions,
    });
    expect(key).toBe("08031|0|10");
  });

  it("the fetch capability parses the key and picks the row by own_code/industry_code/agglvl_code", async () => {
    const result = await runFetch("average_weekly_wage", getTextClient(DENVER), ["08031|5|23"]);
    expect(result?.seriesId).toBe("08031|5|23");
    expect(result?.observations[0]?.value).toBe(1791);
  });

  it("returns no observation (not a fabricated value) when the picked row has no match", async () => {
    // No total-ownership row exists at the sector level in this fixture.
    const result = await runFetch("average_weekly_wage", getTextClient(DENVER), ["08031|0|23"]);
    expect(result?.observations).toEqual([]);
  });
});

describe("QCEW sector detail needs an ownership (#151)", () => {
  it("rejects a sector with the default total ownership, naming the ownership codes that publish it", () => {
    const def = qcewIndicatorDefinitions[0];
    expect(() =>
      def?.buildSeriesId("08031", { seasonallyAdjusted: false, dimensions: { industry: "23", ownership: "0" } }),
    ).toThrow(/sector.*ownership.*5/s);
    expect(
      def?.buildSeriesId("08031", { seasonallyAdjusted: false, dimensions: { industry: "10", ownership: "0" } }),
    ).toBe("08031|0|10");
  });
});
