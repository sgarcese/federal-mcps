import { describe, expect, it } from "vitest";
import { CENSUS_API_ENDPOINT, describeSource } from "./describe-source.js";

describe("Census describeSource()", () => {
  it("names the agency and homepage", () => {
    const d = describeSource();
    expect(d.agency).toBe("census");
    expect(d.agencyName).toBe("U.S. Census Bureau");
    expect(d.homepage).toBe("https://www.census.gov");
    expect(CENSUS_API_ENDPOINT).toBe("https://api.census.gov/data");
  });

  it("lists ACS 1-year, ACS 5-year and decennial as planned until M8.4 lands", () => {
    const d = describeSource();
    const byCode = Object.fromEntries(d.programs.map((p) => [p.code, p]));
    for (const code of ["ACS1", "ACS5", "DEC"]) {
      expect(byCode[code]?.status).toBe("planned");
      expect(byCode[code]?.granularity.length).toBeGreaterThan(0);
    }
    expect(byCode.ACS1?.granularity).toContain("65,000");
  });

  it("states that a key is required and carries the required Census sentence", () => {
    const d = describeSource();
    expect(d.quota).toContain("key");
    expect(d.caveats.join(" ")).toContain(
      "This product uses the Census Bureau Data API but is not endorsed or certified by the Census Bureau.",
    );
    expect(d.caveats.join(" ").toLowerCase()).toContain("margin of error");
  });
});
