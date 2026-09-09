import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertFamilyContract } from "../testing/index.js";
import { createServer } from "../server/index.js";
import { GeographyCatalog } from "./catalog.js";
import { buildFixtureCatalog } from "./__fixtures__/build-fixture.js";
import { GEOGRAPHY_GUIDE_URI, geographyGuideResource } from "./guide.js";
import { geographyTools } from "./tools.js";
import type { ServerDefinition } from "../server/definition.js";

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

function geoServer(): ServerDefinition {
  return {
    name: "federal-mcps-geo",
    version: "0.0.0",
    agency: "geo",
    instructions: "Geography resolver for the federal-mcps family.",
    tools: geographyTools({
      agency: "geo",
      catalog: () => catalog,
      include: ["resolve_place", "get_containment", "get_overlap", "get_lineage"],
    }),
    resources: [geographyGuideResource()],
    describeSource: () => ({
      agency: "geo",
      agencyName: "U.S. Census Bureau (geography)",
      homepage: "https://www.census.gov",
      programs: [
        {
          code: "GEO",
          name: "Geographic reference",
          granularity: "state to tract",
          cadence: "annual",
          status: "available",
        },
      ],
      caveats: [],
      citationFormat: "U.S. Census Bureau geographic reference files",
    }),
  };
}

async function connect(definition: ServerDefinition): Promise<Client> {
  const server = createServer(definition);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

describe("geographyTools", () => {
  it("passes the family contract (resolve_place is allowed because it is fromCore)", () => {
    expect(() => assertFamilyContract(geoServer())).not.toThrow();
  });

  it("lists the geo tools with read-only annotations", async () => {
    const client = await connect(geoServer());
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("geo_resolve_place");
    expect(names).toContain("geo_get_overlap");
    expect(names).toContain("geo_describe_source");
    const resolve = (await client.listTools()).tools.find((t) => t.name === "geo_resolve_place");
    expect(resolve?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    await client.close();
  });

  it("resolves a place, returning flags in data and identifiers in the envelope place", async () => {
    const client = await connect(geoServer());
    const res = await client.callTool({
      name: "geo_resolve_place",
      arguments: { query: "Denver", kind: "county" },
    });
    const env = res.structuredContent as {
      data: { status: string; candidates: { geoid: string; flags: string[] }[] };
      place?: { geoid: string; dcid: string };
    };
    expect(env.data.status).toBe("ok");
    expect(env.data.candidates[0]?.geoid).toBe("08031");
    expect(env.place?.dcid).toBe("geoId/08031");
    await client.close();
  });

  it("surfaces ambiguity for a bare name", async () => {
    const client = await connect(geoServer());
    const res = await client.callTool({
      name: "geo_resolve_place",
      arguments: { query: "Denver" },
    });
    const env = res.structuredContent as { data: { status: string } };
    expect(env.data.status).toBe("ambiguous");
    await client.close();
  });

  it("serves the geography guide resource", async () => {
    const client = await connect(geoServer());
    const read = await client.readResource({ uri: GEOGRAPHY_GUIDE_URI });
    expect(read.contents[0]?.text).toMatch(/does not nest|structured flags|ZCTA is not a ZIP/);
    await client.close();
  });
});
