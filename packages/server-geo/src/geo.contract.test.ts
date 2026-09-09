import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { createServer, EnvelopeSchema, GeographyCatalog } from "@federal-mcps/core";
import { assertFamilyContract, assertServerSources } from "@federal-mcps/core/testing";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFixtureCatalog } from "./__fixtures__/build-fixture.js";
import { buildGeoDefinition } from "./definition.js";

/**
 * The family contract suite (#7) for the geography server. It mirrors server-bls's:
 * `assertFamilyContract` and `assertServerSources` read the definition and source files;
 * the live block builds a real server over an in-memory transport and asserts what a host
 * sees on the wire. The geography server is the first non-BLS server, so this is also the
 * proof that a server built entirely on core's shared tools meets the same contract.
 */
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

async function connect(): Promise<Client> {
  const server = createServer(buildGeoDefinition(catalog));
  const client = new Client({ name: "contract-test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

it("meets the family contract", () => assertFamilyContract(buildGeoDefinition(catalog)));

it("does not call agencies directly", () => assertServerSources(new URL("./", import.meta.url)));

describe("the live geography server (createServer + InMemoryTransport)", () => {
  it("lists the geo tools and describe_source with the family annotations", async () => {
    const client = await connect();
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain("geo_resolve_place");
      expect(names).toContain("geo_get_overlap");
      expect(names).toContain("geo_list_availability");
      expect(names).toContain("geo_describe_source");
      for (const tool of tools) {
        expect(tool.annotations).toMatchObject({
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: true,
        });
      }
    } finally {
      await client.close();
    }
  });

  it("resolves Denver (county) to an envelope carrying its identifiers", async () => {
    const client = await connect();
    try {
      const res = await client.callTool({
        name: "geo_resolve_place",
        arguments: { query: "Denver", kind: "county" },
      });
      const env = EnvelopeSchema.parse(res.structuredContent);
      const data = env.data as { status: string; candidates: { geoid: string }[] };
      expect(data.status).toBe("ok");
      expect(data.candidates[0]?.geoid).toBe("08031");
      expect(env.place?.dcid).toBe("geoId/08031");
    } finally {
      await client.close();
    }
  });

  it("geo_describe_source returns an envelope of available reference programs", async () => {
    const client = await connect();
    try {
      const res = await client.callTool({ name: "geo_describe_source", arguments: {} });
      const env = EnvelopeSchema.parse(res.structuredContent);
      const data = env.data as { programs: { status: string }[] };
      expect(data.programs.length).toBeGreaterThan(0);
      for (const program of data.programs) {
        expect(program.status).toBe("available");
      }
    } finally {
      await client.close();
    }
  });

  it("serves the geography guide resource", async () => {
    const client = await connect();
    try {
      const read = await client.readResource({ uri: "geography://guide" });
      expect(read.contents[0]?.text).toMatch(/does not nest|structured flags|ZCTA is not a ZIP/);
    } finally {
      await client.close();
    }
  });
});
