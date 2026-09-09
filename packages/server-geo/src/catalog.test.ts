import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { GeographyCatalog } from "@federal-mcps/core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildFixtureCatalog } from "./__fixtures__/build-fixture.js";
import { openBundledCatalog, setCatalogForTest } from "./catalog.js";

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
afterEach(() => {
  delete process.env.GEO_CATALOG_PATH;
});

describe("openBundledCatalog", () => {
  it("throws a pointed error when GEO_CATALOG_PATH is unset", () => {
    setCatalogForTest(undefined as unknown as GeographyCatalog);
    delete process.env.GEO_CATALOG_PATH;
    expect(() => openBundledCatalog()).toThrow(/GEO_CATALOG_PATH/);
  });

  it("opens the catalog at GEO_CATALOG_PATH and caches one connection", () => {
    setCatalogForTest(undefined as unknown as GeographyCatalog);
    process.env.GEO_CATALOG_PATH = path;
    const first = openBundledCatalog();
    const second = openBundledCatalog();
    expect(first.vintage()).toBe("test");
    expect(second).toBe(first);
    first.close();
  });

  it("setCatalogForTest injects a catalog so the server needs no bundled file", () => {
    setCatalogForTest(catalog);
    expect(openBundledCatalog()).toBe(catalog);
  });
});
