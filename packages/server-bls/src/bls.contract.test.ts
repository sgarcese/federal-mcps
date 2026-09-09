import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { createServer, EnvelopeSchema, GeographyCatalog } from "@federal-mcps/core";
import { assertFamilyContract, assertServerSources } from "@federal-mcps/core/testing";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFixtureCatalog } from "./__fixtures__/build-fixture.js";
import { buildBlsDefinition } from "./definition.js";
import { scriptedBlsClient } from "./__fixtures__/scripted-client.js";

/**
 * The family contract suite (issue #7) for the BLS server, picked up by
 * `npm run test:contract`. `assertFamilyContract` and `assertServerSources` read the
 * definition/source files; the live block builds a real server with `createServer` (#6)
 * over an in-memory transport and asserts what a host sees on the wire — tool annotations,
 * `bls_describe_source`, and (since #59) `bls_resolve_place` resolving off the catalog.
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
  const server = createServer(buildBlsDefinition({ catalog, httpClient: scriptedBlsClient() }));
  const client = new Client({ name: "contract-test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

it("meets the family contract", () =>
  assertFamilyContract(buildBlsDefinition({ catalog, httpClient: scriptedBlsClient() })));

it("does not call agencies directly", () => assertServerSources(new URL("./", import.meta.url)));

describe("the live BLS server (createServer + InMemoryTransport)", () => {
  it("lists bls_resolve_place and bls_describe_source with the family annotations", async () => {
    const client = await connect();
    try {
      const { tools } = await client.listTools();
      const names = tools.map((tool) => tool.name);
      expect(names).toContain("bls_resolve_place");
      expect(names).toContain("bls_describe_source");
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

  it("bls_resolve_place resolves Denver to candidates with a BLS LAUS code", async () => {
    const client = await connect();
    try {
      const res = await client.callTool({
        name: "bls_resolve_place",
        arguments: { query: "Denver", kind: "county" },
      });
      const env = EnvelopeSchema.parse(res.structuredContent);
      const data = env.data as {
        status: string;
        candidates: { geoid: string; agencyCodes: { program: string; code: string }[] }[];
      };
      expect(data.status).toBe("ok");
      const denver = data.candidates[0];
      expect(denver?.geoid).toBe("08031");
      expect(denver?.agencyCodes.some((c) => c.program === "LAUS")).toBe(true);
      expect(env.place?.dcid).toBe("geoId/08031");
    } finally {
      await client.close();
    }
  });

  it("flags a below-25k place below_threshold with no LAUS code of its own", async () => {
    const client = await connect();
    try {
      const res = await client.callTool({
        name: "bls_resolve_place",
        arguments: { query: "Smallburg", kind: "city" },
      });
      const env = EnvelopeSchema.parse(res.structuredContent);
      const data = env.data as {
        candidates: {
          flags: string[];
          agencyCodes: { program: string }[];
          availableAt: { program: string; hasCode: boolean }[];
        }[];
      };
      const town = data.candidates[0];
      expect(town?.flags).toContain("below_threshold");
      // No LAUS code of its own: the correct answer falls back to its county.
      expect(town?.agencyCodes.some((c) => c.program === "LAUS")).toBe(false);
      expect(town?.availableAt.find((a) => a.program === "LAUS")?.hasCode).toBe(false);
    } finally {
      await client.close();
    }
  });

  it("bls_describe_source returns an envelope: LAUS available, the other five planned", async () => {
    const client = await connect();
    try {
      const result = await client.callTool({ name: "bls_describe_source", arguments: {} });
      const envelope = EnvelopeSchema.parse(result.structuredContent);
      const data = envelope.data as { programs: { code: string; status: string }[] };
      expect(data.programs).toHaveLength(6);
      for (const program of data.programs) {
        expect(program.status).toBe(program.code === "LAUS" ? "available" : "planned");
      }
    } finally {
      await client.close();
    }
  });
});
