import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { GeographyCatalog } from "@federal-mcps/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFixtureCatalog } from "./__fixtures__/build-fixture.js";
import { createBlsServer, describeSource, setCatalogForTest } from "./index.js";

let path: string;
let catalog: GeographyCatalog;
beforeAll(() => {
  path = buildFixtureCatalog();
  catalog = new GeographyCatalog(path);
  setCatalogForTest(catalog); // so createBlsServer needs no bundled file
});
afterAll(() => {
  catalog.close();
  rmSync(dirname(path), { recursive: true, force: true });
});

describe("@federal-mcps/server-bls entry point", () => {
  it("re-exports describeSource", () => {
    expect(describeSource().agency).toBe("bls");
  });

  it("createBlsServer builds the shell's server over the bundled catalog", () => {
    const server: McpServer = createBlsServer();
    expect(server).toBeDefined();
  });

  it("createBlsServer accepts createServer's options (e.g. an injectable clock)", () => {
    const now = () => new Date("2026-09-08T00:00:00.000Z");
    const server = createBlsServer({ now });
    expect(server).toBeDefined();
  });
});
