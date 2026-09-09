import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { GeographyCatalog } from "@federal-mcps/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFixtureCatalog } from "./__fixtures__/build-fixture.js";
import { buildBlsDefinition } from "./definition.js";
import { stubHttpClient } from "./__fixtures__/stub-client.js";

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

describe("BLS ServerDefinition", () => {
  it("names the server and agency per ADR-001/ADR-004", () => {
    const definition = buildBlsDefinition({ catalog, httpClient: stubHttpClient() });
    expect(definition.name).toBe("federal-mcps-bls");
    expect(definition.agency).toBe("bls");
    expect(definition.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("mounts bls_resolve_place from the shared resolver (fromCore, no own lookup)", () => {
    const tools = buildBlsDefinition({ catalog, httpClient: stubHttpClient() }).tools;
    expect(tools.map((t) => t.name)).toEqual(["bls_resolve_place", "bls_get_indicator"]);
    expect(tools[0]?.fromCore).toBe(true);
  });

  it("drafts instructions from the geography spike's city/county/metro guidance", () => {
    const text = buildBlsDefinition({
      catalog,
      httpClient: stubHttpClient(),
    }).instructions.toLowerCase();
    expect(text).toContain("county");
    expect(text).toContain("metro");
    expect(text).toContain("denver");
    expect(text).toContain("25,000");
    expect(text).toContain("provenance");
    expect(text).toContain("bls_resolve_place");
  });

  it("keeps instructions to a model-sized paragraph or two", () => {
    const wordCount = buildBlsDefinition({ catalog, httpClient: stubHttpClient() })
      .instructions.trim()
      .split(/\s+/).length;
    expect(wordCount).toBeGreaterThan(200);
    expect(wordCount).toBeLessThan(600);
  });

  it("exposes describeSource() backing the auto-registered tool", () => {
    const definition = buildBlsDefinition({ catalog, httpClient: stubHttpClient() });
    expect(typeof definition.describeSource).toBe("function");
    expect(definition.describeSource().agency).toBe("bls");
  });
});
