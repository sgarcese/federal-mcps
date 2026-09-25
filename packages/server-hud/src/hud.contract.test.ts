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
import { buildHudDefinition } from "./definition.js";

/** The family contract suite for the HUD server (M11 shell): the shell over an in-memory transport. */
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

const FIXTURES = fileURLToPath(new URL("../fixtures", import.meta.url));
const replay = () =>
  createHttpClient({
    source: "hud",
    budget: new MemoryBudgetStore(1000),
    cache: new MemoryCacheStore(),
    fixtures: { mode: "replay", dir: FIXTURES },
  });
// The indicator tools replay recorded fixtures; the token is a placeholder (never sent).
const definition = () =>
  buildHudDefinition({ catalog, httpClient: replay(), token: () => "test-token" });

it("meets the family contract", () => assertFamilyContract(definition()));

it("does not call agencies directly", () => assertServerSources(new URL("./", import.meta.url)));

describe("the live HUD server (createServer + InMemoryTransport)", () => {
  it("lists hud_resolve_place and hud_describe_source with titles and the family annotations", async () => {
    const server = createServer(definition());
    const client = new Client({ name: "contract-test-client", version: "0.0.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(ct), server.connect(st)]);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual(
        expect.arrayContaining(["hud_describe_source", "hud_resolve_place"]),
      );
      for (const tool of tools) {
        expect(tool.title).toMatch(/\S/);
        expect(tool.annotations).toMatchObject({
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: true,
        });
      }
      const res = await client.callTool({ name: "hud_describe_source", arguments: {} });
      expect(JSON.stringify(res.structuredContent)).toContain("not endorsed or certified");
    } finally {
      await client.close();
    }
  });
});
