import { describe, expect, it } from "vitest";
import { describeSource } from "./describe-source.js";

describe("BLS describeSource()", () => {
  it("names the agency for citations", () => {
    const d = describeSource();
    expect(d.agency).toBe("bls");
    expect(d.agencyName).toBe("U.S. Bureau of Labor Statistics");
    expect(d.homepage).toBe("https://www.bls.gov");
  });

  it("lists all seven programs, every one available (LAUS/CES/OEWS/CPI/JOLTS/QCEW/PPI)", () => {
    const d = describeSource();
    const codes = d.programs.map((p) => p.code).sort();
    expect(codes).toEqual(["CPI", "JOLTS", "LAUS", "OEWS", "PPI", "QCEW", "SM"].sort());
    const byCode = Object.fromEntries(d.programs.map((p) => [p.code, p]));
    for (const code of ["LAUS", "SM", "OEWS", "CPI", "JOLTS", "QCEW", "PPI"]) {
      expect(byCode[code]?.status).toBe("available");
    }
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

describe("BLS terms of service (docs/licensing.md)", () => {
  it("carries the required 'cannot vouch' sentence in the caveats", () => {
    expect(describeSource().caveats.join(" ")).toContain(
      "BLS.gov cannot vouch for the data or analyses derived from these data after the data have been retrieved from BLS.gov",
    );
  });
});

describe("OEWS: detailed occupations and the one-year API horizon are documented (#214)", () => {
  const d = describeSource();
  const text = JSON.stringify(d);

  it("explains the OEWS series-id layout with a worked detailed-occupation example", () => {
    expect(text).toMatch(/OEUM004378000000047203113/);
    expect(text).toMatch(/6-digit SOC/);
    expect(text).toMatch(/01 employment/);
    expect(text).toMatch(/04 annual mean/);
    expect(text).toMatch(/08 hourly median/);
    expect(text).toMatch(/13 annual median/);
  });

  it("says the API carries only the current OEWS year", () => {
    expect(text).toMatch(/only the (current|latest) OEWS year/i);
  });

  it("the OEWS program entry points to bls_get_raw for detailed occupations", () => {
    const oews = d.programs.find((p) => p.code === "OEWS");
    expect(oews?.granularity).toMatch(/bls_get_raw/);
  });
});
