import { describe, expect, it } from "vitest";
import { joltsIndicatorDefinitions, joltsStateCode } from "./jt-indicators.js";
import { blsIndicatorDefinitions } from "./indicators.js";

// Minimal PlaceCandidate stand-ins: joltsStateCode reads only kind.sumlevel and geoid.
// biome-ignore lint/suspicious/noExplicitAny: only the two fields joltsStateCode reads matter here.
const place = (sumlevel: string, geoid: string): any => ({ geoid, kind: { sumlevel } });

describe("joltsStateCode", () => {
  it("returns a state's FIPS geoid", () => {
    expect(joltsStateCode(place("040", "08"))).toBe("08");
  });

  it("returns undefined for non-state places (metro, county, city) — no fabrication", () => {
    expect(joltsStateCode(place("310", "19740"))).toBeUndefined();
    expect(joltsStateCode(place("050", "08031"))).toBeUndefined();
    expect(joltsStateCode(place("160", "0820000"))).toBeUndefined();
  });
});

describe("joltsIndicatorDefinitions", () => {
  it("registers job_openings, hires, quits and layoffs over the JOLTS program, NSA by default", () => {
    for (const name of ["job_openings", "hires", "quits", "layoffs"]) {
      const def = joltsIndicatorDefinitions.find((d) => d.name === name);
      expect(def).toBeDefined();
      expect(def?.program).toBe("JOLTS");
      expect(def?.defaultSeasonallyAdjusted).toBe(false);
      expect(def?.description.length).toBeGreaterThan(0);
    }
  });

  it("builds the statewide JT series id per indicator from a state code", () => {
    const opts = { seasonallyAdjusted: false };
    const byName = (name: string) => joltsIndicatorDefinitions.find((d) => d.name === name);
    expect(byName("job_openings")?.buildSeriesId("08", opts)).toBe("JTU000000080000000JOL");
    expect(byName("hires")?.buildSeriesId("08", opts)).toBe("JTU000000080000000HIL");
    expect(byName("quits")?.buildSeriesId("08", opts)).toBe("JTU000000080000000QUL");
    expect(byName("layoffs")?.buildSeriesId("08", opts)).toBe("JTU000000080000000LDL");
  });

  it("is included in the aggregate blsIndicatorDefinitions seam", () => {
    const names = blsIndicatorDefinitions.map((d) => d.name);
    expect(names).toContain("job_openings");
    expect(names).toContain("hires");
    expect(names).toContain("quits");
    expect(names).toContain("layoffs");
  });
});
