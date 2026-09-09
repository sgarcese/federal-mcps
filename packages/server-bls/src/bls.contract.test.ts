import { createServer, EnvelopeSchema } from "@federal-mcps/core";
import { assertFamilyContract, assertServerSources } from "@federal-mcps/core/testing";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { definition } from "./definition.js";

/**
 * The family contract suite (issue #7) for this server, picked up by
 * `npm run test:contract` (`vitest.config.ts`'s `contract` project matches
 * every `*.contract.test.ts` file under a server package's `src`).
 *
 * The first two checks read the definition/source files directly, per the
 * harness's documented usage (`packages/core/src/testing/index.ts`). The
 * third is the live check the harness cannot do from a definition alone: it
 * builds a real server with `createServer` (#6), connects an SDK `Client`
 * over an in-memory transport pair, and asserts what a host actually sees on
 * the wire — tool annotations and `bls_describe_source`'s presence and
 * output.
 */

it("meets the family contract", () => assertFamilyContract(definition));

it("does not call agencies directly", () => assertServerSources(new URL("./", import.meta.url)));

describe("the live BLS server (createServer + InMemoryTransport)", () => {
  it("lists bls_describe_source with the family annotations on every tool", async () => {
    const server = createServer(definition);
    const client = new Client({ name: "contract-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    try {
      const { tools } = await client.listTools();
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.map((tool) => tool.name)).toContain("bls_describe_source");
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

  it("bls_describe_source returns an envelope with all six programs planned", async () => {
    const server = createServer(definition);
    const client = new Client({ name: "contract-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    try {
      const result = await client.callTool({ name: "bls_describe_source", arguments: {} });
      const envelope = EnvelopeSchema.parse(result.structuredContent);
      const data = envelope.data as { programs: { status: string }[] };
      expect(data.programs).toHaveLength(6);
      for (const program of data.programs) {
        expect(program.status).toBe("planned");
      }
    } finally {
      await client.close();
    }
  });
});
