import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { GeographyCatalog } from "@federal-mcps/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cpiAreaOf, cpiIndicatorDefinitions } from "./cpi-indicators.js";
import { blsIndicatorTools } from "./get-indicator.js";
import { blsIndicatorDefinitions } from "./indicators.js";
import { buildFixtureCatalog } from "./__fixtures__/build-fixture.js";
import { scriptedBlsClient } from "./__fixtures__/scripted-client.js";

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

  it("mentions that an item can be chosen in its description", () => {
    expect(def?.description).toMatch(/item/i);
  });

  it("declares an item dimension defaulting to all items (SA0)", () => {
    const item = def?.dimensions?.find((d) => d.argument === "item");
    expect(item?.default).toBe("SA0");
    const codes = item?.vocabulary.map((v) => v.code) ?? [];
    expect(codes).toEqual([
      "SA0",
      "SAF1",
      "SAF11",
      "SAH",
      "SAH1",
      "SA0E",
      "SETB01",
      "SAM",
      "SAT",
      "SAA",
    ]);
  });

  it("builds the series id from the resolved item dimension", () => {
    const id = def?.buildSeriesId("S48B", {
      seasonallyAdjusted: false,
      dimensions: { item: "SAF1" },
    });
    expect(id).toBe("CUURS48BSAF1");
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

describe("cpi_all_items end to end via bls_get_indicator (#150)", () => {
  let path: string;
  let catalog: GeographyCatalog;
  beforeAll(() => {
    path = buildFixtureCatalog();
    catalog = new GeographyCatalog(path);
  });
  afterAll(() => {
    catalog.close();
    rmSync(dirname(path), { recursive: true, force: true });
  });

  const NOW = () => new Date("2025-02-01T00:00:00Z");

  function tool(client = scriptedBlsClient()) {
    return blsIndicatorTools({ catalog: () => catalog, httpClient: () => client, now: NOW })[0];
  }
  const run = (args: Record<string, unknown>, client?: ReturnType<typeof scriptedBlsClient>) =>
    // biome-ignore lint/suspicious/noExplicitAny: reading the envelope's untyped data in tests.
    tool(client).handler(args as any, {} as any);

  it("picks a CPI metro's food item series and reports the dimension", async () => {
    const res = await run({
      place: "Denver",
      kind: "metro",
      indicator: "cpi_all_items",
      item: "SAF1",
    });
    expect(res.source.ids).toEqual(["CUURS48BSAF1"]);
    expect((res.data as { dimensions: unknown }).dimensions).toEqual({ item: "SAF1" });
  });

  it("rejects a bad item code and lists the vocabulary", async () => {
    await expect(
      run({ place: "Denver", kind: "metro", indicator: "cpi_all_items", item: "ZZZZZZ" }),
    ).rejects.toThrow(/item.*"ZZZZZZ".*SA0.*SAF1/s);
  });
});
