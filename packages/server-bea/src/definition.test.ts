import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { GeographyCatalog } from "@federal-mcps/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFixtureCatalog } from "./__fixtures__/build-fixture.js";
import { buildBeaDefinition } from "./definition.js";

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

const build = () => buildBeaDefinition({ catalog });

describe("BEA ServerDefinition (M14 shell, ADR-019)", () => {
  it("names the server and agency", () => {
    const d = build();
    expect(d.name).toBe("federal-mcps-bea");
    expect(d.agency).toBe("bea");
    expect(d.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("mounts only bea_resolve_place from the shared resolver (no indicator tools yet)", () => {
    const tools = build().tools;
    expect(tools.map((t) => t.name)).toEqual(["bea_resolve_place"]);
    expect(tools[0]?.fromCore).toBe(true);
  });

  it("instructions cover resolving the place first and BEA's required sentence", () => {
    const text = build().instructions;
    expect(text).toContain("bea_resolve_place");
    expect(text).toContain(
      "This product uses the Bureau of Economic Analysis (BEA) Data API but is not endorsed or certified by BEA.",
    );
  });

  it("exposes describeSource() backing bea_describe_source", () => {
    expect(build().describeSource().agency).toBe("bea");
  });
});
