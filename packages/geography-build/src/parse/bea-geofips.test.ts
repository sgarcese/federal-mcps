import { ucgidOf } from "@federal-mcps/core";
import { describe, expect, it } from "vitest";
import type { EntityRow } from "../types.js";
import { parseBeaCombinations, stripBeaRequest } from "./bea-geofips.js";

const county = (geoid: string, name: string): EntityRow => ({
  ucgid: ucgidOf("050", geoid),
  geoid,
  sumlevel: "050",
  name,
  lsad: null,
  funcstat: null,
  stateFips: geoid.slice(0, 2),
  gnis: null,
  lat: null,
  lon: null,
  aland: null,
});
const ENTITIES = [
  county("51003", "Albemarle County"),
  county("51540", "Charlottesville city"),
  county("51015", "Augusta County"),
  county("51790", "Staunton city"),
  county("51820", "Waynesboro city"),
  county("51059", "Fairfax County"),
  county("51600", "Fairfax city"),
  county("51610", "Falls Church city"),
  county("51095", "James City County"),
  county("51830", "Williamsburg city"),
  county("51175", "Southampton County"),
  county("51620", "Franklin city"),
  county("51067", "Franklin County"), // the other Franklin — must not be chosen
  county("15009", "Maui County"),
  county("15005", "Kalawao County"),
  county("18141", "St. Joseph County"),
];
const LIST = (entries: [string, string][]) =>
  JSON.stringify({
    BEAAPI: { Results: { ParamValue: entries.map(([Key, Desc]) => ({ Key, Desc })) } },
  });
const code = (rows: ReturnType<typeof parseBeaCombinations>, geoid: string) =>
  rows.find((r) => r.ucgid === ucgidOf("050", geoid));

describe("parseBeaCombinations (#257, ADR-019 §6)", () => {
  const rows = parseBeaCombinations(
    LIST([
      ["51901", "Albemarle + Charlottesville, VA*"],
      ["51907", "Augusta, Staunton + Waynesboro, VA*"],
      ["51919", "Fairfax, Fairfax City + Falls Church, VA*"],
      ["51931", "James City + Williamsburg, VA*"],
      ["51949", "Southampton + Franklin, VA*"],
      ["15901", "Maui + Kalawao, HI*"],
      ["18141", "St. Joseph, IN"],
    ]),
    ENTITIES,
  );

  it("gives every component county and independent city its combination's BEA code", () => {
    for (const g of ["51003", "51540"]) expect(code(rows, g)?.code).toBe("51901");
    for (const g of ["51015", "51790", "51820"]) expect(code(rows, g)?.code).toBe("51907");
    for (const g of ["51059", "51600", "51610"]) expect(code(rows, g)?.code).toBe("51919");
    expect(code(rows, "51003")).toMatchObject({ agency: "bea", program: "GEOFIPS" });
  });

  it("reads the county first and the cities after it: James City County, and Franklin city (not Franklin County)", () => {
    expect(code(rows, "51095")?.code).toBe("51931");
    expect(code(rows, "51620")?.code).toBe("51949");
    expect(code(rows, "51067")).toBeUndefined();
  });

  it("falls back to a county for a later part with no city (Kalawao County)", () => {
    expect(code(rows, "15009")?.code).toBe("15901");
    expect(code(rows, "15005")?.code).toBe("15901");
  });

  it("names the combination in the note", () => {
    expect(code(rows, "51540")?.note).toMatch(/Albemarle \+ Charlottesville/);
  });

  it("an ordinary county gets no row", () => {
    expect(code(rows, "18141")).toBeUndefined();
  });

  it("fails loudly when a component cannot be matched — never a silent gap", () => {
    expect(() =>
      parseBeaCombinations(LIST([["51999", "Nowhere + Noplace, VA*"]]), ENTITIES),
    ).toThrow(/Nowhere/);
  });
});

describe("stripBeaRequest (#257: the key BEA echoes never reaches the download cache)", () => {
  it("drops BEAAPI.Request and keeps the results", () => {
    const body = JSON.stringify({
      BEAAPI: {
        Request: { RequestParam: [{ ParameterName: "USERID", ParameterValue: "secret-key" }] },
        Results: { ParamValue: [] },
      },
    });
    const out = stripBeaRequest(body);
    expect(out).not.toContain("secret-key");
    expect(JSON.parse(out)).toEqual({ BEAAPI: { Results: { ParamValue: [] } } });
  });
});

describe("parseBeaCombinations on hostile input (CodeQL js/polynomial-redos, #332)", () => {
  it("parses a long, repetitive name in linear time", () => {
    const started = performance.now();
    const desc = `${"a,".repeat(50_000)} + ${" + ".repeat(50_000)}, VA`;
    try {
      parseBeaCombinations(LIST([["51999", desc]]), ENTITIES);
    } catch {
      // An unmatched name may throw; only the time matters here.
    }
    expect(performance.now() - started).toBeLessThan(500);
  });
});
