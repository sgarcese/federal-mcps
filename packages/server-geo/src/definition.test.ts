import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { GeographyCatalog } from "@federal-mcps/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFixtureCatalog } from "./__fixtures__/build-fixture.js";
import { buildGeoDefinition } from "./definition.js";

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

describe("geography ServerDefinition", () => {
  it("names the server and agency per ADR-004/ADR-008", () => {
    const d = buildGeoDefinition(catalog);
    expect(d.name).toBe("federal-mcps-geo");
    expect(d.agency).toBe("geo");
    expect(d.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("mounts all five shared resolver tools, prefixed geo_", () => {
    const names = buildGeoDefinition(catalog).tools.map((t) => t.name);
    expect(names).toEqual([
      "geo_resolve_place",
      "geo_get_containment",
      "geo_get_overlap",
      "geo_get_lineage",
      "geo_list_availability",
    ]);
  });

  it("marks every tool fromCore so the contract harness allows resolve_place", () => {
    for (const tool of buildGeoDefinition(catalog).tools) {
      expect(tool.fromCore).toBe(true);
    }
  });

  it("serves the geography guide resource", () => {
    const resources = buildGeoDefinition(catalog).resources ?? [];
    expect(resources.map((r) => r.uri)).toContain("geography://guide");
  });

  it("drafts instructions that teach the city/county/metro distinction and structured flags", () => {
    const text = buildGeoDefinition(catalog).instructions.toLowerCase();
    expect(text).toContain("county");
    expect(text).toContain("metro");
    expect(text).toContain("ambiguous");
    expect(text).toContain("below_threshold");
  });

  it("exposes describeSource() backing the auto-registered tool", () => {
    const d = buildGeoDefinition(catalog);
    expect(typeof d.describeSource).toBe("function");
    expect(d.describeSource().agency).toBe("geo");
  });
});
