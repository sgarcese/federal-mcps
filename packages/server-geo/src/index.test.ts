import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { GeographyCatalog } from "@federal-mcps/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFixtureCatalog } from "./__fixtures__/build-fixture.js";
import { createGeoServer, describeGeoSource, setCatalogForTest } from "./index.js";

let path: string;
let catalog: GeographyCatalog;
beforeAll(() => {
  path = buildFixtureCatalog();
  catalog = new GeographyCatalog(path);
  setCatalogForTest(catalog); // so createGeoServer needs no bundled file
});
afterAll(() => {
  catalog.close();
  rmSync(dirname(path), { recursive: true, force: true });
});

describe("@federal-mcps/server-geo entry point", () => {
  it("re-exports describeGeoSource over the bundled catalog", () => {
    expect(describeGeoSource(catalog).agency).toBe("geo");
  });

  it("createGeoServer builds the shell's server from the geo definition", () => {
    const server: McpServer = createGeoServer();
    expect(server).toBeDefined();
  });

  it("createGeoServer accepts createServer's options (e.g. an injectable clock)", () => {
    const now = () => new Date("2026-09-09T00:00:00.000Z");
    expect(createGeoServer({ now })).toBeDefined();
  });
});
