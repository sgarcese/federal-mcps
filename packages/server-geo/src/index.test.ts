import { rmSync } from "node:fs";
import { dirname } from "node:path";
import type { Limiter } from "@federal-mcps/core";
import { GeographyCatalog } from "@federal-mcps/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
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

describe("createGeoServer: the limiter (#322)", () => {
  it("hands options.limiter to the shell, which counts each tool call", async () => {
    const calls: unknown[] = [];
    const limiter: Limiter = {
      beginToolCall: async (caller) => {
        calls.push(caller);
      },
      beforeUpstream: async () => undefined,
      usage: async () => undefined,
    };
    const server = createGeoServer({ limiter });
    const client = new Client({ name: "t", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(b), client.connect(a)]);
    try {
      await client.callTool({
        name: "geo_resolve_place",
        arguments: { query: "Denver", kind: "county" },
      });
      expect(calls).toEqual([undefined]);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
