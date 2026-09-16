import { describe, expect, it } from "vitest";
import { describeSource } from "./describe-source.js";

describe("BLS describeSource()", () => {
  it("names the agency for citations", () => {
    const d = describeSource();
    expect(d.agency).toBe("bls");
    expect(d.agencyName).toBe("U.S. Bureau of Labor Statistics");
    expect(d.homepage).toBe("https://www.bls.gov");
  });

  it("lists all six architecture-doc programs; LAUS+CES+OEWS+CPI+JOLTS available, QCEW planned", () => {
    const d = describeSource();
    const codes = d.programs.map((p) => p.code).sort();
    expect(codes).toEqual(["CPI", "JOLTS", "LAUS", "OEWS", "QCEW", "SM"].sort());
    const byCode = Object.fromEntries(d.programs.map((p) => [p.code, p]));
    for (const code of ["LAUS", "SM", "OEWS", "CPI", "JOLTS"]) {
      expect(byCode[code]?.status).toBe("available");
    }
    expect(byCode.QCEW?.status).toBe("planned");
    for (const program of d.programs) {
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

  it("notes that place resolution is available now (#59)", () => {
    const text = describeSource().caveats.join(" ").toLowerCase();
    expect(text).toContain("bls_resolve_place");
    expect(text).toContain("below_threshold");
  });

  it("gives a citation format", () => {
    const d = describeSource();
    expect(d.citationFormat.length).toBeGreaterThan(0);
  });
});
