import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { GeographyCatalog } from "@federal-mcps/core";
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

describe("HUD ServerDefinition (M11 shell, ADR-018)", () => {
  it("names the server and agency", () => {
    const d = build();
    expect(d.name).toBe("federal-mcps-hud");
    expect(d.agency).toBe("hud");
    expect(d.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("mounts only hud_resolve_place from the shared resolver (no indicator tools yet)", () => {
    const tools = build().tools;
    expect(tools.map((t) => t.name)).toEqual(["hud_resolve_place"]);
    expect(tools[0]?.fromCore).toBe(true);
  });

  it("instructions cover resolving the place first and the required HUD User sentence", () => {
    const text = build().instructions;
    expect(text).toContain("hud_resolve_place");
    expect(text).toContain(
      "This product uses the HUD User Data API but is not endorsed or certified by HUD User.",
    );
  });

  it("exposes describeSource() backing hud_describe_source", () => {
    expect(build().describeSource().agency).toBe("hud");
  });
});
