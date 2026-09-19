import type { HttpClient } from "@federal-mcps/core";
import { describe, expect, it } from "vitest";
import { lausCodeOf, lausIndicatorDefinitions } from "./laus-indicators.js";
import { buildLausSeriesId, LAUS_MEASURES } from "./laus.js";
import {
  createIndicatorRegistry,
  fetchStrategyOf,
  type IndicatorDefinition,
  resolveDimensions,
} from "@federal-mcps/core";
import { type IndicatorFetch, timeseriesFetch } from "./series-fetch.js";

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

describe("fetchStrategyOf (fetch capability seam, #123)", () => {
  it("falls back to the timeseries default when a definition supplies no fetch", () => {
    expect(fetchStrategyOf(stub("laus_like"), timeseriesFetch)).toBe(timeseriesFetch);
  });

  it("uses a definition's own capability — a non-timeseries program fetches its own way", async () => {
    // A stub CSV-style capability: no HTTP, treats the "series id" as an opaque program key.
    const csvFetch: IndicatorFetch = async (_client, keys) =>
      keys.map((k) => ({
        seriesId: k,
        observations: [
          { year: "2024", period: "Q01", periodName: "1st Quarter", value: 42, footnotes: [] },
        ],
      }));
    const def: IndicatorDefinition = { ...stub("qcew_like", "QCEW"), fetch: csvFetch };

    expect(fetchStrategyOf(def, timeseriesFetch)).toBe(csvFetch);
    const noClient = undefined as unknown as HttpClient;
    const [result] = await fetchStrategyOf(def, timeseriesFetch)(noClient, ["08031"], {});
    expect(result?.seriesId).toBe("08031");
    expect(result?.observations[0]?.value).toBe(42);
  });

  it("every registered LAUS indicator uses the shared timeseries default (no behaviour change)", () => {
    for (const def of lausIndicatorDefinitions) {
      expect(fetchStrategyOf(def, timeseriesFetch)).toBe(timeseriesFetch);
    }
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
