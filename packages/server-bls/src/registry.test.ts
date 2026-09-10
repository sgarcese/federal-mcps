import { describe, expect, it } from "vitest";
import { lausCodeOf, lausIndicatorDefinitions } from "./laus-indicators.js";
import { buildLausSeriesId, LAUS_MEASURES } from "./laus.js";
import { createIndicatorRegistry, type IndicatorDefinition } from "./registry.js";

const stub = (name: string, program = "TEST"): IndicatorDefinition => ({
  name,
  program,
  description: `${name} desc`,
  defaultSeasonallyAdjusted: false,
  agencyCodeOf: () => undefined,
  buildSeriesId: () => "X",
});

describe("createIndicatorRegistry", () => {
  it("looks up by name, and lists names and definitions", () => {
    const reg = createIndicatorRegistry([stub("a"), stub("b")]);
    expect(reg.get("a")?.name).toBe("a");
    expect(reg.get("missing")).toBeUndefined();
    expect(reg.names()).toEqual(["a", "b"]);
    expect(reg.list().map((d) => d.name)).toEqual(["a", "b"]);
  });

  it("lets a later duplicate win", () => {
    const reg = createIndicatorRegistry([stub("a", "P1"), stub("a", "P2")]);
    expect(reg.get("a")?.program).toBe("P2");
    expect(reg.names()).toEqual(["a"]);
  });
});

describe("lausIndicatorDefinitions (LAUS on the registry)", () => {
  it("registers exactly the four LAUS measures, all over the LAUS program, NSA by default", () => {
    expect(lausIndicatorDefinitions.map((d) => d.name)).toEqual([...LAUS_MEASURES]);
    for (const def of lausIndicatorDefinitions) {
      expect(def.program).toBe("LAUS");
      expect(def.defaultSeasonallyAdjusted).toBe(false);
      expect(def.description.length).toBeGreaterThan(0);
    }
  });

  it("builds the same series id as the LAUS builder (Denver County unemployment rate)", () => {
    const reg = createIndicatorRegistry(lausIndicatorDefinitions);
    const rate = reg.get("unemployment_rate");
    expect(rate).toBeDefined();
    const built = rate?.buildSeriesId("CN0803100000000", { seasonallyAdjusted: false });
    expect(built).toBe("LAUCN080310000000003");
    expect(built).toBe(
      buildLausSeriesId("CN0803100000000", "unemployment_rate", { seasonallyAdjusted: false }),
    );
  });

  it("reads the LAUS agency code off a resolved place, or undefined when absent", () => {
    const reg = createIndicatorRegistry(lausIndicatorDefinitions);
    const def = reg.get("employment");
    const withCode = {
      agencyCodes: [{ agency: "bls", program: "LAUS", code: "CN0803100000000" }],
    };
    const withoutCode = { agencyCodes: [{ agency: "bls", program: "QCEW", code: "X" }] };
    expect(def?.agencyCodeOf(withCode)).toBe("CN0803100000000");
    expect(def?.agencyCodeOf(withoutCode)).toBeUndefined();
    // The exported helper agrees with the definition.
    expect(lausCodeOf(withCode)).toBe("CN0803100000000");
  });
});
