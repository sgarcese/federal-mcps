import { describe, expect, it } from "vitest";
import { cpiAreaOf, cpiIndicatorDefinitions } from "./cpi-indicators.js";
import { blsIndicatorDefinitions } from "./indicators.js";

// biome-ignore lint/suspicious/noExplicitAny: only the agencyCodes/name fields matter here.
const place = (agencyCodes: unknown[], name = "Somewhere"): any => ({ name, agencyCodes });

describe("cpiAreaOf", () => {
  it("returns the CPI area code for a published metro", () => {
    const p = place([{ agency: "bls", program: "CPI", code: "S48B" }]);
    expect(cpiAreaOf(p)).toBe("S48B");
  });

  it("returns undefined for a place with no CPI code", () => {
    expect(cpiAreaOf(place([{ agency: "bls", program: "LAUS", code: "X" }]))).toBeUndefined();
  });
});

describe("cpiIndicatorDefinitions", () => {
  const def = cpiIndicatorDefinitions.find((d) => d.name === "cpi_all_items");

  it("registers cpi_all_items over the CPI program, NSA by default", () => {
    expect(def?.program).toBe("CPI");
    expect(def?.defaultSeasonallyAdjusted).toBe(false);
    expect(def?.description.length).toBeGreaterThan(0);
  });

  it("falls back to the U.S. city average with a 'no local CPI' caveat", () => {
    // biome-ignore lint/suspicious/noExplicitAny: fallback reads only place.name.
    const fb = def?.fallback?.({} as any, { name: "Boise" } as any);
    expect(fb?.code).toBe("0000");
    expect(fb?.name).toBe("U.S. city average");
    expect(fb?.caveat).toMatch(/not published for Boise/i);
  });

  it("is included in the aggregate blsIndicatorDefinitions seam", () => {
    expect(blsIndicatorDefinitions.map((d) => d.name)).toContain("cpi_all_items");
  });
});
