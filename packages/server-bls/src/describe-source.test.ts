import { describe, expect, it } from "vitest";
import { describeSource } from "./describe-source.js";

describe("BLS describeSource()", () => {
  it("names the agency for citations", () => {
    const d = describeSource();
    expect(d.agency).toBe("bls");
    expect(d.agencyName).toBe("U.S. Bureau of Labor Statistics");
    expect(d.homepage).toBe("https://www.bls.gov");
  });

  it("lists all six architecture-doc programs, every one still planned in M1", () => {
    const d = describeSource();
    const codes = d.programs.map((p) => p.code).sort();
    expect(codes).toEqual(["CPI", "JOLTS", "LAUS", "OEWS", "QCEW", "SM"].sort());
    for (const program of d.programs) {
      expect(program.status).toBe("planned");
      expect(program.granularity.length).toBeGreaterThan(0);
      expect(program.cadence.length).toBeGreaterThan(0);
    }
  });

  it("states the public API quota", () => {
    const d = describeSource();
    expect(d.quota).toContain("500");
    expect(d.quota).toContain("day");
  });

  it("caveats the LAUS threshold, missing local CPI, and QCEW's CSV client", () => {
    const d = describeSource();
    const text = d.caveats.join(" ").toLowerCase();
    expect(text).toContain("25,000");
    expect(text).toContain("cpi");
    expect(text).toContain("csv");
    expect(text).toContain("preliminary");
  });

  it("gives a citation format", () => {
    const d = describeSource();
    expect(d.citationFormat.length).toBeGreaterThan(0);
  });
});
