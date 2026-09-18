import { describe, expect, it } from "vitest";
import { cesCodeOf, cesIndicatorDefinitions } from "./ces-indicators.js";
import { blsIndicatorDefinitions } from "./indicators.js";

// Minimal PlaceCandidate stand-ins.
// biome-ignore lint/suspicious/noExplicitAny: only the read fields matter here.
const state = (geoid: string): any => ({ geoid, kind: { sumlevel: "040" }, agencyCodes: [] });
// biome-ignore lint/suspicious/noExplicitAny: only the read fields matter here.
const metro = (geoid: string, codes: unknown[] = []): any => ({
  geoid,
  kind: { sumlevel: "310" },
  agencyCodes: codes,
});
// biome-ignore lint/suspicious/noExplicitAny: only the read fields matter here.
const county = (geoid: string): any => ({ geoid, kind: { sumlevel: "050" }, agencyCodes: [] });

describe("cesCodeOf", () => {
  it("returns a statewide 7-char key for a state (FIPS + 00000)", () => {
    expect(cesCodeOf(state("08"))).toBe("0800000");
  });

  it("returns the catalog state+area key for a metro that carries an SM code", () => {
    expect(cesCodeOf(metro("19740", [{ agency: "bls", program: "SM", code: "0819740" }]))).toBe(
      "0819740",
    );
  });

  it("returns undefined for a metro with no SM code (e.g. multi-state), or a county/city", () => {
    expect(cesCodeOf(metro("16980", []))).toBeUndefined();
    expect(cesCodeOf(county("08031"))).toBeUndefined();
  });
});

describe("cesIndicatorDefinitions", () => {
  const def = cesIndicatorDefinitions.find((d) => d.name === "payroll_employment");

  it("registers payroll_employment over the SM program, NSA by default", () => {
    expect(def?.program).toBe("SM");
    expect(def?.defaultSeasonallyAdjusted).toBe(false);
    expect(def?.description.length).toBeGreaterThan(0);
  });

  it("builds the SM series id from a state+area key", () => {
    expect(def?.buildSeriesId("0800000", { seasonallyAdjusted: false })).toBe(
      "SMU08000000000000001",
    );
    expect(def?.buildSeriesId("0819740", { seasonallyAdjusted: false })).toBe(
      "SMU08197400000000001",
    );
  });

  it("is included in the aggregate blsIndicatorDefinitions seam", () => {
    expect(blsIndicatorDefinitions.map((d) => d.name)).toContain("payroll_employment");
  });
});

describe("CES multi-state metro caveat (#153)", () => {
  it("caveatOf returns the SM code's note so the envelope carries it", () => {
    const def = cesIndicatorDefinitions[0];
    const chicago = metro("16980", [
      { agency: "bls", program: "SM", code: "1716980", note: "CES publishes this under IL." },
    ]);
    expect(cesCodeOf(chicago)).toBe("1716980");
    expect(def?.caveatOf?.(chicago)).toBe("CES publishes this under IL.");
    expect(def?.caveatOf?.(metro("19740", [{ agency: "bls", program: "SM", code: "0819740" }]))).toBeUndefined();
  });
});
