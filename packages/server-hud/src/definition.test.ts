import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { GeographyCatalog, type HttpClient } from "@federal-mcps/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFixtureCatalog } from "./__fixtures__/build-fixture.js";
import { buildHudDefinition } from "./definition.js";

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

const build = () => buildHudDefinition({ catalog });

describe("HUD ServerDefinition (M11, ADR-018)", () => {
  it("names the server and agency", () => {
    const d = build();
    expect(d.name).toBe("federal-mcps-hud");
    expect(d.agency).toBe("hud");
    expect(d.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("without an HTTP client mounts only hud_resolve_place (no upstream calls possible)", () => {
    const tools = build().tools;
    expect(tools.map((t) => t.name)).toEqual(["hud_resolve_place"]);
    expect(tools[0]?.fromCore).toBe(true);
  });

  it("with a client mounts the indicator tools and hud_get_raw (#237)", () => {
    const tools = buildHudDefinition({
      catalog,
      httpClient: {} as HttpClient,
      token: () => "t",
    }).tools;
    expect(tools.map((t) => t.name)).toEqual([
      "hud_resolve_place",
      "hud_get_indicator",
      "hud_compare_places",
      "hud_list_indicators",
      "hud_get_raw",
    ]);
  });

  it("instructions name the indicator tools and the raw tool, and carry the required HUD User sentence", () => {
    const text = build().instructions;
    expect(text).toContain("hud_resolve_place");
    expect(text).toContain("hud_get_indicator");
    expect(text).toContain("hud_get_raw");
    expect(text).not.toMatch(/shell only/);
    expect(text).toContain(
      "This product uses the HUD User Data API but is not endorsed or certified by HUD User.",
    );
  });

  it("exposes describeSource() backing hud_describe_source", () => {
    expect(build().describeSource().agency).toBe("hud");
  });
});
