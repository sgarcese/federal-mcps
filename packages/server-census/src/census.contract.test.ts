import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createHttpClient,
  createServer,
  GeographyCatalog,
  MemoryBudgetStore,
  MemoryCacheStore,
} from "@federal-mcps/core";
import { assertFamilyContract, assertServerSources } from "@federal-mcps/core/testing";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFixtureCatalog } from "./__fixtures__/build-fixture.js";
import { buildCensusDefinition } from "./definition.js";

/** The family contract suite for the Census server (M8.1): the shell over an in-memory transport. */
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

/** The contract harness runs every tool's worked example, so the examples replay recorded fixtures. */
const FIXTURES = fileURLToPath(new URL("../fixtures", import.meta.url));
const replay = () =>
  createHttpClient({
    source: "census",
    budget: new MemoryBudgetStore(100),
    cache: new MemoryCacheStore(),
    fixtures: { mode: "replay", dir: FIXTURES },
  });
const definition = () => buildCensusDefinition({ catalog, httpClient: replay() });

it("meets the family contract", () => assertFamilyContract(definition()));

it("does not call agencies directly", () => assertServerSources(new URL("./", import.meta.url)));

describe("the live Census server (createServer + InMemoryTransport)", () => {
  it("lists census_resolve_place and census_describe_source with titles and the family annotations", async () => {
    const server = createServer(definition());
    const client = new Client({ name: "contract-test-client", version: "0.0.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(ct), server.connect(st)]);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([
        "census_compare_places",
        "census_describe_source",
        "census_get_indicator",
        "census_list_indicators",
        "census_resolve_place",
      ]);
      for (const tool of tools) {
        expect(tool.title).toMatch(/\S/);
        expect(tool.annotations).toMatchObject({
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: true,
        });
      }
      const res = await client.callTool({ name: "census_describe_source", arguments: {} });
      expect(JSON.stringify(res.structuredContent)).toContain("not endorsed or certified");
    } finally {
      await client.close();
    }
  });
});
