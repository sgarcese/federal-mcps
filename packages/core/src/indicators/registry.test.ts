import { describe, expect, it } from "vitest";
import {
  createIndicatorRegistry,
  type IndicatorDefinition,
  resolveDimensions,
} from "./registry.js";

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

describe("resolveDimensions (M7.1 seam, #149)", () => {
  const withItem: IndicatorDefinition = {
    ...stub("cpi"),
    dimensions: [
      {
        argument: "item",
        description: "Expenditure group.",
        default: "SA0",
        vocabulary: [
          { code: "SA0", label: "All items" },
          { code: "SAF1", label: "Food" },
        ],
      },
    ],
  };

  it("fills every declared dimension with its default when no argument is given", () => {
    expect(resolveDimensions(withItem, {})).toEqual({ ok: true, selection: { item: "SA0" } });
  });

  it("accepts a code from the vocabulary", () => {
    expect(resolveDimensions(withItem, { item: "SAF1" })).toEqual({
      ok: true,
      selection: { item: "SAF1" },
    });
  });

  it("rejects a code outside the vocabulary, listing what is accepted", () => {
    const r = resolveDimensions(withItem, { item: "nope" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/item.*"nope".*SA0.*SAF1/s);
  });

  it("rejects an argument the indicator does not declare, naming what it does accept", () => {
    const r = resolveDimensions(withItem, { occupation: "110000" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/occupation.*cpi.*item/s);
  });

  it("an indicator with no dimensions rejects any dimension argument", () => {
    const r = resolveDimensions(stub("plain"), { item: "SA0" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/plain.*no dimension/s);
    expect(resolveDimensions(stub("plain"), {})).toEqual({ ok: true, selection: {} });
  });
});
