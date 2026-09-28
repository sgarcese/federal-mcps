import { describe, expect, it } from "vitest";
import { BEA_API_ENDPOINT, BEA_REQUIRED_SENTENCE, describeSource } from "./describe-source.js";

describe("BEA describeSource() (#258, ADR-019)", () => {
  it("names the agency and homepage", () => {
    const d = describeSource();
    expect(d.agency).toBe("bea");
    expect(d.agencyName).toBe("U.S. Bureau of Economic Analysis");
    expect(d.homepage).toBe("https://www.bea.gov");
    expect(BEA_API_ENDPOINT).toBe("https://apps.bea.gov/api/data");
  });

  it("lists personal income, GDP and regional price parities, planned in the shell", () => {
    const byCode = Object.fromEntries(describeSource().programs.map((p) => [p.code, p]));
    for (const code of ["PI", "GDP", "RPP"]) expect(byCode[code]?.status).toBe("planned");
    expect(byCode.RPP?.granularity).toContain("metropolitan");
  });

  it("states the key, BEA's per-minute limits, and carries BEA's required sentence", () => {
    const d = describeSource();
    expect(d.quota).toContain("BEA_API_KEY");
    expect(d.quota).toContain("30 errors a minute");
    expect(BEA_REQUIRED_SENTENCE).toBe(
      "This product uses the Bureau of Economic Analysis (BEA) Data API but is not endorsed or certified by BEA.",
    );
    expect(d.caveats.join(" ")).toContain(BEA_REQUIRED_SENTENCE);
    expect(d.caveats.join(" ")).toMatch(/never as zero/);
  });
});
