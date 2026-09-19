import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { GeographyCatalog } from "@federal-mcps/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFixtureCatalog } from "./__fixtures__/build-fixture.js";
import { stubHttpClient } from "./__fixtures__/stub-client.js";
import { buildCensusDefinition } from "./definition.js";

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

const build = () => buildCensusDefinition({ catalog, httpClient: stubHttpClient() });

describe("Census ServerDefinition (M8.1, ADR-014)", () => {
  it("names the server and agency", () => {
    const d = build();
    expect(d.name).toBe("federal-mcps-census");
    expect(d.agency).toBe("census");
    expect(d.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("mounts census_resolve_place from the shared resolver plus the generic indicator tools (M8.4) and census_get_raw", () => {
    const tools = build().tools;
    expect(tools.map((t) => t.name)).toEqual([
      "census_resolve_place",
      "census_get_indicator",
      "census_compare_places",
      "census_list_indicators",
      "census_get_raw",
    ]);
    expect(tools[0]?.fromCore).toBe(true);
  });

  it("census_get_raw has a title and a get_raw-shaped input", () => {
    const tool = build().tools.find((t) => t.name === "census_get_raw");
    expect(tool?.title).toBe("Get raw table");
    expect(tool?.fromCore).toBeFalsy();
  });

  it("instructions cover the 65,000 rule, margins of error, and the required Census sentence", () => {
    const text = build().instructions;
    expect(text).toContain("65,000");
    expect(text.toLowerCase()).toContain("margin of error");
    expect(text).toContain("census_resolve_place");
    expect(text).toContain("census_get_indicator");
    expect(text).toContain(
      "This product uses the Census Bureau Data API but is not endorsed or certified by the Census Bureau.",
    );
    const words = text.trim().split(/\s+/).length;
    expect(words).toBeGreaterThan(150);
    expect(words).toBeLessThan(600);
  });

  it("exposes describeSource() backing census_describe_source", () => {
    expect(build().describeSource().agency).toBe("census");
  });
});
